// Video export: the canvas and the processed sound recorded in real time with MediaRecorder.
// MP4 where the browser can write it (Chrome, Edge, Safari), WebM otherwise (Firefox).

export const VIDEO_TYPES = [
    ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1.42E01E,mp4a.40.2', 'mp4'],
    ['video/mp4;codecs=avc1,opus', 'mp4'],
    ['video/mp4', 'mp4'],
    ['video/webm;codecs=vp9,opus', 'webm'],
    ['video/webm;codecs=vp8,opus', 'webm'],
    ['video/webm', 'webm'],
];

// The first container and codecs the browser can record, or null.
export function pickVideoType(isSupported = (t) => globalThis.MediaRecorder?.isTypeSupported(t)) {
    for (const [mime, ext] of VIDEO_TYPES) if (isSupported(mime)) return { mime, ext };
    return null;
}

export class VideoRecorder {
    constructor(canvas, audioStream, { mime }, fps = 30) {
        const stream = new MediaStream([...canvas.captureStream(fps).getVideoTracks(), ...audioStream.getAudioTracks()]);
        this.stream = stream;
        this.mime = mime;
        this.chunks = [];
        // Dithering is per-pixel noise to an encoder, so it gets a generous bitrate.
        this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 12e6, audioBitsPerSecond: 192e3 });
        this.recorder.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
        this.done = new Promise((resolve, reject) => {
            this.recorder.onstop = () => resolve(new Blob(this.chunks, { type: mime.split(';')[0] }));
            this.recorder.onerror = (e) => reject(e.error || e);
        });
    }

    start() {
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
