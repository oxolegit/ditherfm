// Checks without a browser: audio analysis, beats, presets, the director, WAV, the queue.
// Run with: node tests/run.js
import { bandEnergies, createFeatures, logSpectrum } from '../audio/features.js';
import { MODES, modeOf, semitones, clampSetting } from '../audio/engine.js';
import { encodeWAV, renderedLength } from '../audio/wav.js';
import { Playlist, trackName } from '../audio/playlist.js';
import { DEFAULT_PARAMS } from '../viz/pipeline.js';
import { PRESETS } from '../viz/presets.js';
import { makePreset } from '../viz/random.js';
import { Director } from '../viz/director.js';
import { createAnalysis } from '../audio/analysis.js';
import { pickVideoType, videoTypes, defaultVideo, parseSize, videoBitrate } from '../viz/record.js';
import { makeSong, sectionAt, hourPlan, onAir, songLength, HOUR } from '../audio/lofi.js';

let failed = 0;
const check = (name, ok, extra = '') => {
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${extra ? ' — ' + extra : ''}`);
    if (!ok) failed++;
};

const SR = 48000, FFT = 2048, BIN = SR / FFT;
const spectrumWith = (peaks, floor = 0.001) => {
    const mag = new Float32Array(FFT / 2).fill(floor);
    for (const [hz, m] of peaks) mag[Math.round(hz / BIN)] = m;
    return mag;
};
const silence = new Float32Array(FFT);

// Bands pick up the right frequencies.
{
    const low = bandEnergies(spectrumWith([[100, 0.5]]), BIN);
    const mid = bandEnergies(spectrumWith([[1000, 0.5]]), BIN);
    const high = bandEnergies(spectrumWith([[5000, 0.5]]), BIN);
    check('100 Hz lands in bass', low.bass > low.mid * 10 && low.bass > low.treb * 10);
    check('1 kHz lands in mid', mid.mid > mid.bass * 10 && mid.mid > mid.treb * 10);
    check('5 kHz lands in treb', high.treb > high.bass * 10 && high.treb > high.mid * 10);
    const sp = logSpectrum(spectrumWith([[100, 0.5]]), BIN);
    check('log spectrum stays in 0…1', sp.every((v) => v >= 0 && v <= 1));
}

// A steady signal settles near 1 with no beats; a kick every half second is heard as beats.
{
    const f = createFeatures(), mag = spectrumWith([[100, 0.2], [1000, 0.1], [5000, 0.05]]);
    let beats = 0, s;
    for (let i = 0; i < 600; i++) { s = f.update(mag, BIN, [silence, silence], 1 / 60); if (s.beat) beats++; }
    check('steady signal: bands settle near 1', Math.abs(s.bass - 1) < 0.05 && Math.abs(s.mid - 1) < 0.05 && Math.abs(s.treb - 1) < 0.05, `bass ${s.bass.toFixed(3)}`);
    check('steady signal: no beats', beats === 0, `${beats} beats`);
}
{
    const f = createFeatures();
    let beats = 0;
    for (let i = 0; i < 1200; i++) {
        const kick = i % 30 < 3;
        const s = f.update(spectrumWith([[80, kick ? 0.6 : 0.05], [1000, 0.05]]), BIN, [silence, silence], 1 / 60);
        if (s.beat) beats++;
    }
    // 20 s of kicks at 2 per second, minus the warm-up.
    check('kicks are detected as beats', beats >= 32 && beats <= 40, `${beats} beats`);
}
{
    const f = createFeatures();
    let ok = true;
    for (let i = 0; i < 300; i++) {
        const s = f.idle(1 / 60);
        if (!(s.bass > 0 && Number.isFinite(s.bass_att)) || s.wave[0].some((v) => !Number.isFinite(v))) ok = false;
    }
    check('idle signal is finite and alive', ok);
}

// Nightcore settings.
check('nightcore raises pitch by ~3.9 semitones', Math.abs(semitones(MODES.nightcore.rate) - 3.86) < 0.01);
check('modes are recognised back', Object.keys(MODES).every((id) => modeOf(MODES[id]) === id));
check('a hand-tuned mix is no mode', modeOf({ rate: 1.13, bass: 2, reverb: 0 }) === null);
check('settings are clamped', clampSetting('rate', 9) === 2 && clampSetting('bass', -3) === 0 && clampSetting('reverb', 'x') === 0);

// WAV.
{
    const n = 1000, a = new Float32Array(n).fill(0.5), b = new Float32Array(n).fill(-2);
    const buf = encodeWAV([a, b], 44100), v = new DataView(buf);
    const tag = (o) => String.fromCharCode(...new Uint8Array(buf, o, 4));
    check('WAV header', tag(0) === 'RIFF' && tag(8) === 'WAVE' && tag(36) === 'data' && v.getUint32(24, true) === 44100 && v.getUint16(22, true) === 2);
    check('WAV size', buf.byteLength === 44 + n * 2 * 2 && v.getUint32(40, true) === n * 4);
    check('WAV samples are scaled', v.getInt16(44, true) === Math.trunc(0.5 * 0x7fff));
    check('WAV clips below −1', v.getInt16(46, true) === -0x8000);
    check('faster render is shorter', renderedLength(441000, 44100, { rate: 1.25, reverb: 0 }) === 352800);
    check('reverb adds its tail', renderedLength(441000, 44100, { rate: 1, reverb: 0.3 }) > 441000);
}

// Queue.
{
    const file = (name, type = 'audio/mpeg') => ({ name, type });
    const q = new Playlist();
    check('only audio files are queued', q.add([file('a.mp3'), file('cover.jpg', 'image/jpeg'), file('b.flac', ''), file('c.ogg')]) === 3);
    check('first added track becomes current', q.current.name === 'a');
    q.step(-1);
    check('previous wraps to the end', q.current.name === 'c');
    q.step(1);
    check('next wraps to the start', q.current.name === 'a');
    q.select(1);
    q.remove(0);
    check('removing before current keeps it', q.current.name === 'b' && q.index === 0);
    q.move(0, 1);
    check('moving keeps the current track', q.current.name === 'b' && q.index === 1);
    q.repeat = false;
    check('without repeat the end stops', q.step(1) === null);
    check('track names drop the extension', trackName('02 - Song.name.mp3') === '02 - Song.name');
}

// Presets: known parameters only, finite every frame.
const audioAt = (bass, t) => ({ bass, mid: 1, treb: 1, bass_att: bass, mid_att: 1, treb_att: 1, beat: t % 1 < 0.02, beatStrength: 0.8 });
const finiteFrames = (preset) => {
    const s = {};
    for (let i = 0; i < 120; i++) {
        const p = { ...DEFAULT_PARAMS, ...preset.base };
        preset.frame?.(p, audioAt(i % 7 === 0 ? 3 : 0.5, i / 30), i / 30, s);
        if (Object.values(p).some((v) => !Number.isFinite(v))) return false;
    }
    return true;
};
const knownKeys = (preset) => Object.keys(preset.base).every((k) => k in DEFAULT_PARAMS);
{
    check('hand presets have unique ids', new Set(PRESETS.map((p) => p.id)).size === PRESETS.length, `${PRESETS.length} presets`);
    check('hand presets use known parameters', PRESETS.every(knownKeys));
    check('hand presets stay finite', PRESETS.every(finiteFrames));

    const a = makePreset('fixed'), b = makePreset('fixed'), c = makePreset('other');
    check('seeded preset is deterministic', JSON.stringify(a.base) === JSON.stringify(b.base) && a.warp === b.warp);
    check('different seeds differ', JSON.stringify(a.base) !== JSON.stringify(c.base));
    let known = true, finite = true, floats = true;
    const modes = new Set();
    for (let i = 0; i < 200; i++) {
        const p = makePreset('s' + i);
        modes.add(p.base.waveMode);
        if (!knownKeys(p)) known = false;
        if (!finiteFrames(p)) finite = false;
        // GLSL needs float literals: no bare integers next to operators.
        if (/[*+-]\s\d+(?![.\d])/.test(p.warp)) floats = false;
    }
    check('seeded presets use known parameters', known);
    check('seeded presets stay finite', finite);
    check('seeded warps use float literals', floats);
    check('seeded presets cover every wave mode', modes.size === 7, `${modes.size} modes`);
}

// Director: changes after its time, never while locked, blends smoothly.
{
    const d = new Director({ minTime: 1, maxTime: 2 });
    let changes = 0;
    d.onChange = () => changes++;
    d.set(PRESETS[0], { instant: true });
    changes = 0;
    const quiet = { ...audioAt(1, 0), beat: false };
    for (let i = 0; i < 60 * 5; i++) d.update(1 / 60, quiet, i / 60);
    check('director changes presets over time', changes >= 2, `${changes} changes`);
    d.locked = true;
    changes = 0;
    for (let i = 0; i < 60 * 5; i++) d.update(1 / 60, { ...quiet, beat: true }, i / 60);
    check('locked director holds', changes === 0);

    const e = new Director();
    e.set(PRESETS[0], { instant: true });
    const from = e.update(1 / 60, quiet, 0).params.zoom;
    e.set(PRESETS.find((p) => p.id === 'bloom'));
    const mid = e.update(1, quiet, 0).params.zoom;
    const to = e.update(1.5, quiet, 0).params.zoom;
    check('blend passes between the two presets', mid < from && mid > to, `${from.toFixed(3)} → ${mid.toFixed(3)} → ${to.toFixed(3)}`);
}

// Lo-fi FM: songs come from their seed, and the air is the same for anyone at the same moment.
{
    const a = makeSong('491234-3'), b = makeSong('491234-3'), c = makeSong('491234-4');
    check('same seed, same song', JSON.stringify(a) === JSON.stringify(b));
    check('next slot, another song', JSON.stringify(a) !== JSON.stringify(c));
    check('lo-fi tempo', a.bpm >= 70 && a.bpm <= 88, `${a.bpm} BPM`);
    check('chords sit in the keys range', a.chords.every((ch) => ch.notes.every((n) => n >= 52 && n < 64 + 12) && ch.bass >= 36 && ch.bass < 48));
    const lead = a.lead.flat().filter(Boolean);
    check('lead stays singable', lead.every((n) => n >= 60 && n <= 96), `${Math.min(...lead)}…${Math.max(...lead)}`);
    check('form adds up', a.sections.reduce((n, s) => n + s.bars, 0) === a.bars);
    check('intro has no drums', !sectionAt(a, 0).drums && sectionAt(a, 6).drums);

    const hour = 491234, plan = hourPlan(hour);
    check('the hour is covered end to end', plan[0].start === hour * HOUR && plan.at(-1).end === (hour + 1) * HOUR
        && plan.every((s, i) => i === 0 || s.start === plan[i - 1].end), `${plan.length} songs`);
    const at = hour * HOUR + 1234.5, slot = onAir(at);
    check('one song on air at a time', slot.start <= at && at < slot.end && slot === onAir(at));
    check('songs turn over into the next hour', onAir((hour + 1) * HOUR - 0.001).song.seed.startsWith(`${hour}-`)
        && onAir((hour + 1) * HOUR).song.seed === `${hour + 1}-0`);
    check('a song lasts a couple of minutes', songLength(a) > 80 && songLength(a) < 180, `${songLength(a).toFixed(0)} s`);
}

// The offline analysis matches what an AnalyserNode reports, so offline video moves like the live one.
{
    const sr = 48000, an = createAnalysis(2048), sine = (f, amp) => Float32Array.from({ length: sr }, (_, i) => amp * Math.sin((2 * Math.PI * f * i) / sr));
    const bin = sr / 2048, tone = sine(bin * 40, 0.5);
    const { mag, waves } = an.at([tone, tone], 24000);
    let peak = 0;
    for (let i = 1; i < mag.length; i++) if (mag[i] > mag[peak]) peak = i;
    check('analysis finds the tone', peak === 40);
    check('analysis uses the analyser scale', Math.abs(mag[40] - 0.5 * 0.42 / 2) < 0.002, mag[40].toFixed(4));
    check('waveform ends at the moment', waves[0][2047] === tone[23999]);
    const silence = an.at([new Float32Array(10)], 5).mag;
    check('before the start is silence', silence.every((v) => v === 0));
}

// Video export picks MP4 when the browser can write it, WebM otherwise.
{
    const only = (...ok) => (t) => ok.includes(t);
    check('video prefers mp4', pickVideoType(only('video/webm', 'video/mp4'))?.ext === 'mp4');
    check('video falls back to webm', pickVideoType(only('video/webm;codecs=vp9,opus'))?.ext === 'webm');
    check('webm stays as a fallback', videoTypes(only('video/mp4', 'video/webm')).map((v) => v.ext).join() === 'mp4,webm');
    check('computer records 1920×1080 at 60', defaultVideo(false).size === '1920x1080' && defaultVideo(false).fps === 60);
    check('phone records 1080×1920', defaultVideo(true).size === '1080x1920');
    check('only listed sizes are accepted', parseSize('1080x1920')?.join() === '1080,1920' && parseSize('999x333') === null && parseSize(undefined) === null);
    check('every size is even', ['1920x1080', '1080x1920', '1080x1080', '1280x720', '720x1280'].every((v) => parseSize(v).every((n) => n % 2 === 0)));
    check('bitrate grows with fps and stays sane', videoBitrate(1920, 1080, 60) > videoBitrate(1920, 1080, 30) && videoBitrate(1920, 1080, 60) <= 24e6 && videoBitrate(720, 1280, 30) >= 4e6);
    check('no recorder, no video', pickVideoType(() => false) === null && pickVideoType() === null);
}

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
