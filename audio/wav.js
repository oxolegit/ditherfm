// The nightcore version of a whole track, rendered offline through the same chain as playback
// and saved as 16-bit PCM WAV.
import { buildChain, REVERB_TAIL } from './engine.js';

// Interleaved 16-bit little-endian PCM with a canonical 44-byte header.
export function encodeWAV(channels, sampleRate) {
    const n = channels[0].length, ch = channels.length, bytes = n * ch * 2;
    const buf = new ArrayBuffer(44 + bytes), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); str(8, 'WAVE');
    str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, ch, true);
    v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * ch * 2, true);
    v.setUint16(32, ch * 2, true); v.setUint16(34, 16, true);
    str(36, 'data'); v.setUint32(40, bytes, true);
    let o = 44;
    for (let i = 0; i < n; i++) {
        for (let c = 0; c < ch; c++) {
            const x = Math.max(-1, Math.min(1, channels[c][i]));
            v.setInt16(o, x < 0 ? x * 0x8000 : x * 0x7fff, true);
            o += 2;
        }
    }
    return buf;
}

// Length in samples of the rendered track: faster is shorter, plus room for the reverb tail.
export const renderedLength = (samples, sampleRate, { rate, reverb }) =>
    Math.ceil(samples / rate) + (reverb > 0 ? Math.round(REVERB_TAIL * sampleRate) : 0);

// file → Blob (audio/wav). onProgress gets 0…1 where the browser can report it.
export async function renderTrack(file, settings, onProgress = () => {}) {
    const data = await file.arrayBuffer();
    const decoded = await new OfflineAudioContext(2, 1, 44100).decodeAudioData(data);
    const rate = decoded.sampleRate, length = renderedLength(decoded.length, rate, settings);
    const ctx = new OfflineAudioContext(2, length, rate);

    const source = ctx.createBufferSource();
    source.buffer = decoded;
    source.playbackRate.value = settings.rate;
    buildChain(ctx, source, settings).output.connect(ctx.destination);
    source.start();

    // Progress by pausing the render at fixed points; not every browser supports it.
    const total = length / rate, steps = 40;
    try {
        for (let k = 1; k < steps; k++) {
            const t = (total * k) / steps;
            ctx.suspend(Math.floor((t * rate) / 128) * 128 / rate).then(() => { onProgress(k / steps); ctx.resume(); });
        }
    } catch {}

    const out = await ctx.startRendering();
    onProgress(1);
    const channels = [];
    for (let c = 0; c < out.numberOfChannels; c++) channels.push(out.getChannelData(c));
    return new Blob([encodeWAV(channels, rate)], { type: 'audio/wav' });
}
