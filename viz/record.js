// Video export: the canvas and the processed sound recorded in real time with MediaRecorder.
// MP4 where the browser can write it (Chrome, Edge, Safari), WebM otherwise (Firefox).

export const VIDEO_TYPES = [
    // High profile, level 4.2: enough for 1080p at 60 fps.
    ['video/mp4;codecs=avc1.64002a,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,opus', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
];

// Every container and codecs the browser says it can record, best first.
export function videoTypes(isSupported = (t) => globalThis.MediaRecorder?.isTypeSupported(t)) {
    return VIDEO_TYPES.filter(([mime]) => isSupported(mime)).map(([mime, ext]) => ({ mime, ext }));
}

export const pickVideoType = (isSupported) => videoTypes(isSupported)[0] || null;

// Recording sizes: the visuals are rendered straight at these, not scaled from the screen.
export const VIDEO_SIZES = [[1920, 1080], [1080, 1920], [1080, 1080], [1280, 720], [720, 1280]];
export const VIDEO_FPS = [30, 60];

// Landscape at 60 fps on a computer; on a phone, portrait at 30, easier on its encoder.
export function defaultVideo(phone) {
    return phone ? { size: '1080x1920', fps: 30 } : { size: '1920x1080', fps: 60 };
}

export const parseSize = (v) => {
    const m = /^(\d+)x(\d+)$/.exec(v || '');
    return m && VIDEO_SIZES.find(([w, h]) => w === +m[1] && h === +m[2]) || null;
};

// Dithering is per-pixel noise to an encoder, so it gets a generous bitrate.
export const videoBitrate = (w, h, fps) => Math.round(Math.min(24e6, Math.max(4e6, w * h * fps * 0.2)));

export class VideoRecorder {
    // The canvas must already be at the recording size.
    constructor(canvas, audioStream, types, fps = 30) {
        this.stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...audioStream.getAudioTracks()]);
        this.bitrate = videoBitrate(canvas.width, canvas.height, fps);
        this.types = [...types];
        this.done = new Promise((resolve, reject) => {
            this.resolve = resolve;
            this.reject = reject;
        });
        this.done.catch(() => {});
        this.open();
    }

    // Some encoders pass isTypeSupported and still fail to start: the next type is tried then.
    open() {
        const type = this.types.shift();
        if (!type) return this.reject(new Error('no video encoder'));
        this.type = type;
        this.ext = type.ext;
        this.chunks = [];
        const rec = new MediaRecorder(this.stream, { mimeType: type.mime, videoBitsPerSecond: this.bitrate, audioBitsPerSecond: 192e3 });
        this.recorder = rec;
        rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
        rec.onstop = () => rec === this.recorder && !this.failed && this.resolve(new Blob(this.chunks, { type: type.mime.split(';')[0] }));
        rec.onerror = (e) => {
            if (rec !== this.recorder) return;
            if (!this.chunks.length && this.types.length) {
                this.open();
                if (this.started) this.recorder.start(1000);
                return;
            }
            this.failed = true;
            this.reject(e.error || e);
        };
    }

    start() {
        this.started = true;
        this.recorder.start(1000);
    }

    pause() {
        if (this.recorder.state === 'recording') this.recorder.pause();
    }

    resume() {
        if (this.recorder.state === 'paused') this.recorder.resume();
    }

    // Resolves with the finished file.
    stop() {
        if (this.recorder.state !== 'inactive') this.recorder.stop();
        // Only the canvas track is ours to end; the sound keeps playing through the speakers.
        this.stream.getVideoTracks().forEach((t) => t.stop());
        return this.done;
    }
}
