// Video export: the canvas and the processed sound recorded in real time with MediaRecorder.
// MP4 where the browser can write it (Chrome, Edge, Safari), WebM otherwise (Firefox).

export const VIDEO_TYPES = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
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

// H.264 encoders refuse odd sizes and, at their usual levels, anything past 1080p: the frame is
// scaled to fit 1920×1080 and rounded down to even numbers.
export function videoSize(w, h, max = [1920, 1080]) {
    const [mw, mh] = w >= h ? max : [max[1], max[0]];
    const k = Math.min(1, mw / w, mh / h);
    return [Math.max(2, Math.floor((w * k) / 2) * 2), Math.max(2, Math.floor((h * k) / 2) * 2)];
}

export class VideoRecorder {
    constructor(canvas, audioStream, types, fps = 30) {
        this.source = canvas;
        this.frame = document.createElement('canvas');
        [this.frame.width, this.frame.height] = videoSize(canvas.width, canvas.height);
        this.paint = this.frame.getContext('2d', { alpha: false });
        this.draw();
        this.stream = new MediaStream([...this.frame.captureStream(fps).getVideoTracks(), ...audioStream.getAudioTracks()]);
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
        // Dithering is per-pixel noise to an encoder, so it gets a generous bitrate.
        const rec = new MediaRecorder(this.stream, { mimeType: type.mime, videoBitsPerSecond: 12e6, audioBitsPerSecond: 192e3 });
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

    // Copies the latest frame; called right after each render, while the WebGL buffer is intact.
    draw() {
        const { width, height } = this.frame;
        this.paint.imageSmoothingEnabled = width < this.source.width;
        this.paint.drawImage(this.source, 0, 0, width, height);
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
