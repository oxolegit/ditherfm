// Video export, frame by frame: the sound is rendered offline like the WAV, the visuals are
// drawn for each frame from that sound on a canvas of their own, and both are encoded with
// WebCodecs in constant-quality mode, which compresses dithering far better than real-time
// recording, then packed into MP4. Every frame lands on time whatever the machine's speed.
import { renderAudio } from '../audio/wav.js';
import { createAnalysis } from '../audio/analysis.js';
import { createFeatures } from '../audio/features.js';
import { Pipeline } from './pipeline.js';
import { Director } from './director.js';

// Codec strings at levels that cover 1080p at 60 fps in either orientation. The quantizer is the
// constant quality: lower is better and bigger.
export const CODECS = {
    avc: { codec: 'avc1.64002a', quantizer: 22, config: { avc: { format: 'avc' } } },
    hevc: { codec: 'hvc1.1.6.L126.B0', quantizer: 24, config: { hevc: { format: 'hevc' } } },
    av1: { codec: 'av01.0.09M.08', quantizer: 30, config: {} },
};

const AUDIO_CODECS = [
    { muxer: 'aac', config: { codec: 'mp4a.40.2', bitrate: 192e3 } },
    { muxer: 'opus', config: { codec: 'opus', bitrate: 160e3 } },
];

export const SAMPLE_RATE = 48000;

export const offlineVideo = () => typeof VideoEncoder !== 'undefined' && typeof AudioEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';

// The encoder setup for a codec at a size: constant quality where the browser allows it,
// otherwise a variable bitrate.
export async function videoConfig(id, width, height, fps, bitrate) {
    const c = CODECS[id];
    if (!c || typeof VideoEncoder === 'undefined') return null;
    const base = { codec: c.codec, width, height, framerate: fps, latencyMode: 'quality', ...c.config };
    for (const config of [{ ...base, bitrateMode: 'quantizer' }, { ...base, bitrateMode: 'variable', bitrate }]) {
        try {
            const { supported } = await VideoEncoder.isConfigSupported(config);
            if (supported) return config;
        } catch {}
    }
    return null;
}

// Codecs this browser can encode at this size, in the order of CODECS.
export async function supportedCodecs(width, height, fps) {
    const out = [];
    for (const id of Object.keys(CODECS)) if (await videoConfig(id, width, height, fps, 8e6)) out.push(id);
    return out;
}

async function audioConfig(channels, sampleRate) {
    for (const a of AUDIO_CODECS) {
        const config = { ...a.config, numberOfChannels: channels, sampleRate };
        try {
            if ((await AudioEncoder.isConfigSupported(config)).supported) return { ...a, config };
        } catch {}
    }
    throw new Error('no audio encoder');
}

// A message round-trip lets the page breathe between frames without the 1 s timer clamp that
// background tabs get.
const channel = typeof MessageChannel !== 'undefined' ? new MessageChannel() : null;
const yieldToPage = () => new Promise((resolve) => {
    if (!channel) return setTimeout(resolve, 0);
    channel.port1.onmessage = () => resolve();
    channel.port2.postMessage(0);
});

const aborted = () => new DOMException('Video render cancelled', 'AbortError');

// job: { file, settings, look, dither, px, preset, locked, size: [w, h], fps, codec, bitrate }.
// onProgress gets 0…1; signal cancels. Resolves with an MP4 Blob.
export async function renderVideo(job, { onProgress = () => {}, signal } = {}) {
    const { Muxer, ArrayBufferTarget } = await import('../vendor/mp4-muxer.js');
    const [width, height] = job.size, fps = job.fps;

    // 1. Sound: the whole track through the chain, then encoded.
    const sound = await renderAudio(job.file, job.settings, (p) => onProgress(0.1 * p), SAMPLE_RATE);
    if (signal?.aborted) throw aborted();
    const channels = [0, 1].map((c) => sound.getChannelData(Math.min(c, sound.numberOfChannels - 1)));
    const audio = await audioConfig(2, SAMPLE_RATE);
    const video = await videoConfig(job.codec, width, height, fps, job.bitrate);
    if (!video) throw new Error(`cannot encode ${job.codec}`);

    const target = new ArrayBufferTarget();
    const muxer = new Muxer({
        target,
        video: { codec: job.codec, width, height, frameRate: fps },
        audio: { codec: audio.muxer, numberOfChannels: 2, sampleRate: SAMPLE_RATE },
        fastStart: 'in-memory',
        firstTimestampBehavior: 'offset',
    });

    let failure = null;
    const fail = (error) => (failure ??= error);
    const audioEncoder = new AudioEncoder({ output: (chunk, meta) => muxer.addAudioChunk(chunk, meta), error: fail });
    const videoEncoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: fail });
    const close = () => {
        for (const e of [audioEncoder, videoEncoder]) if (e.state !== 'closed') e.close();
    };

    // The visuals get their own canvas, director and analysis, so the page keeps playing.
    const canvas = document.createElement('canvas');
    let pipeline = null;
    try {
        audioEncoder.configure(audio.config);
        const block = 4800, total = channels[0].length;
        for (let from = 0; from < total; from += block) {
            const frames = Math.min(block, total - from), data = new Float32Array(frames * 2);
            data.set(channels[0].subarray(from, from + frames), 0);
            data.set(channels[1].subarray(from, from + frames), frames);
            const chunk = new AudioData({ format: 'f32-planar', sampleRate: SAMPLE_RATE, numberOfFrames: frames, numberOfChannels: 2, timestamp: Math.round((from * 1e6) / SAMPLE_RATE), data });
            audioEncoder.encode(chunk);
            chunk.close();
        }
        await audioEncoder.flush();

        // 2. Pictures: one per frame, from the sound at that moment.
        videoEncoder.configure(video);
        pipeline = new Pipeline(canvas);
        // At 1080p one "pixel" of the setting is two video pixels, as on a 2× screen.
        const scale = Math.min(width, height) / 540;
        pipeline.resize(width / scale, height / scale, scale, job.px);
        const director = new Director();
        director.locked = job.locked;
        director.set(job.preset, { instant: true });
        const features = createFeatures(), analysis = createAnalysis(2048);
        const look = { ...job.look, dither: job.dither };
        const count = Math.ceil((total / SAMPLE_RATE) * fps), dt = 1 / fps;
        const quantizer = video.bitrateMode === 'quantizer' ? { [job.codec]: { quantizer: CODECS[job.codec].quantizer } } : {};

        for (let i = 0; i < count; i++) {
            if (signal?.aborted) throw aborted();
            if (failure) throw failure;
            const t = i * dt;
            const { mag, waves } = analysis.at(channels, Math.round(t * SAMPLE_RATE));
            const a = features.update(mag, SAMPLE_RATE / analysis.fftSize, waves, dt);
            const { params, snippet } = director.update(dt, a, t);
            pipeline.render(params, snippet, a, t, look);
            const frame = new VideoFrame(canvas, { timestamp: Math.round(t * 1e6), duration: Math.round(1e6 / fps) });
            videoEncoder.encode(frame, { keyFrame: i % (fps * 2) === 0, ...quantizer });
            frame.close();
            // Keep the encoder's queue short, and let the page update now and then.
            while (videoEncoder.encodeQueueSize > 6) await yieldToPage();
            if (i % 8 === 0) {
                onProgress(0.1 + 0.9 * (i / count));
                await yieldToPage();
            }
        }
        await videoEncoder.flush();
        if (failure) throw failure;
        muxer.finalize();
        onProgress(1);
        return new Blob([target.buffer], { type: 'video/mp4' });
    } finally {
        close();
        pipeline?.gl.getExtension('WEBGL_lose_context')?.loseContext();
    }
}
