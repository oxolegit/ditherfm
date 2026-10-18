// Lo-fi radio: endless songs written from a seed and played by small Web Audio synths — electric
// piano, bass, boom-bap drums, a sparse lead, tape wobble and vinyl crackle. The sound goes into
// the same chain as a track, so bass, reverb, the visuals and the video apply; speed does not,
// since the station is shared and has to keep time with everyone else.
import { createRng } from '../gen/rng.js';

const NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

const CHORDS = {
    maj7: [0, 4, 7, 11], maj9: [0, 4, 7, 11, 14], m7: [0, 3, 7, 10], m9: [0, 3, 7, 10, 14],
    dom7: [0, 4, 7, 10], dom9: [0, 4, 10, 14], m11: [0, 3, 7, 10, 17],
};

// Degrees as semitones above the major key's tonic.
const PROGRESSIONS = [
    [[2, 'm9'], [7, 'dom9'], [0, 'maj9'], [9, 'm9']],
    [[0, 'maj7'], [9, 'm7'], [2, 'm7'], [7, 'dom7']],
    [[5, 'maj9'], [4, 'm7'], [9, 'm9'], [2, 'm11']],
    [[9, 'm9'], [5, 'maj7'], [0, 'maj9'], [7, 'dom9']],
    [[9, 'm11'], [2, 'm9'], [7, 'dom9'], [0, 'maj7']],
    [[0, 'maj9'], [5, 'maj9'], [0, 'maj9'], [5, 'maj9']],
    [[4, 'm7'], [9, 'm9'], [2, 'm9'], [7, 'dom7']],
];

const KICKS = [[0, 10], [0, 7, 10], [0, 3, 10], [0, 8, 11], [0, 6, 10, 13]];

// Sections in bars: which parts play.
const FORM = [
    ['intro', 4, { drums: false, bass: false, lead: false }],
    ['a', 8, { drums: true, bass: true, lead: false }],
    ['b', 8, { drums: true, bass: true, lead: true }],
    ['break', 4, { drums: false, bass: true, lead: false, muffle: true }],
    ['a', 8, { drums: true, bass: true, lead: true }],
    ['outro', 4, { drums: false, bass: false, lead: false, muffle: true }],
];

const PENTATONIC = [0, 2, 4, 7, 9];

// Octave-folds a pitch into [lo, lo + 12).
const fold = (n, lo) => lo + ((((n - lo) % 12) + 12) % 12);

// A whole song as data: same seed, same song.
export function makeSong(seed) {
    const rng = createRng(`lofi:${seed}`);
    const key = rng.int(0, 11);
    const progression = rng.pick(PROGRESSIONS);
    const chords = progression.map(([degree, type]) => {
        const root = key + degree;
        return {
            name: NAMES[root % 12] + type.replace('dom', ''),
            notes: CHORDS[type].map((i) => fold(root + i, 52)).sort((a, b) => a - b),
            bass: fold(root, 36),
            fifth: fold(root + 7, 36),
        };
    });
    const kick = rng.pick(KICKS);
    const hats16 = rng.chance(0.35);
    const lead = Array.from({ length: 4 }, () => {
        const steps = new Array(16).fill(null);
        let pos = rng.int(0, 4);
        for (let s = 0; s < 16; s += 2) {
            if (!rng.chance(0.32)) continue;
            pos = Math.max(0, Math.min(9, pos + rng.int(-2, 2)));
            steps[s + (rng.chance(0.2) ? 1 : 0)] = 72 + key % 12 + PENTATONIC[pos % 5] + 12 * Math.floor(pos / 5) - (key % 12 > 6 ? 12 : 0);
        }
        return steps;
    });
    const sections = [];
    let bar = 0;
    for (const [name, bars, parts] of FORM) {
        sections.push({ name, from: bar, bars, ...parts });
        bar += bars;
    }
    return {
        seed: String(seed),
        key: NAMES[key],
        bpm: rng.int(70, 88),
        swing: rng.range(0.12, 0.3),
        chords,
        drums: {
            kick: kick,
            snare: [4, 12],
            ghost: rng.chance(0.5) ? [rng.pick([7, 14, 15])] : [],
            hat: Array.from({ length: 16 }, (_, s) => (hats16 || s % 2 === 0 ? (s % 4 === 0 ? 1 : s % 2 === 0 ? 0.7 : 0.4) : 0)),
        },
        lead,
        sections,
        bars: bar,
    };
}

export const sectionAt = (song, bar) => song.sections.find((s) => bar >= s.from && bar < s.from + s.bars) || song.sections.at(-1);

const mtof = (m) => 440 * 2 ** ((m - 69) / 12);

// One station for everyone: the air is a function of UTC time. Each hour plays the songs
// "<hour>-0", "<hour>-1", … back to back, so two listeners hear the same bar at the same moment,
// as closely as their clocks agree. The last song of an hour is cut by the next one.
export const HOUR = 3600;
export const stepDur = (song) => 15 / song.bpm;
export const songLength = (song) => song.bars * 16 * stepDur(song);

const hours = new Map();
export function hourPlan(hour) {
    if (!hours.has(hour)) {
        const plan = [];
        for (let n = 0, start = hour * HOUR; start < (hour + 1) * HOUR; n++) {
            const song = makeSong(`${hour}-${n}`);
            plan.push({ song, start, end: Math.min(start + songLength(song), (hour + 1) * HOUR) });
            start += songLength(song);
        }
        hours.set(hour, plan);
        if (hours.size > 3) hours.delete(hours.keys().next().value);
    }
    return hours.get(hour);
}

// The slot on air at a wall-clock second.
export function onAir(wall) {
    return hourPlan(Math.floor(wall / HOUR)).find((s) => wall < s.end);
}

const wallNow = () => Date.now() / 1000;

export class LofiRadio {
    constructor(ctx, destination) {
        this.ctx = ctx;
        this.playing = false;
        this.onSong = null;
        this.onBeat = null;

        this.out = ctx.createGain();
        this.out.gain.value = 0;
        this.out.connect(destination);
        // Warm tape: soft saturation, then the lo-fi top end roll-off.
        const shaper = ctx.createWaveShaper();
        const curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) curve[i] = Math.tanh(1.6 * (i / 511.5 - 1)) / Math.tanh(1.6);
        shaper.curve = curve;
        this.tone = ctx.createBiquadFilter();
        this.tone.type = 'lowpass';
        this.tone.frequency.value = 5200;
        this.tone.Q.value = 0.5;
        this.bus = ctx.createGain();
        this.bus.gain.value = 0.8;
        this.bus.connect(shaper).connect(this.tone).connect(this.out);
        // Keys and bass duck a little under the kick.
        this.duck = ctx.createGain();
        this.duck.connect(this.bus);

        // Wow and flutter shared by every pitched voice, in cents.
        this.wow = ctx.createOscillator();
        this.wow.frequency.value = 0.55;
        this.wowDepth = ctx.createGain();
        this.wowDepth.gain.value = 7;
        this.wow.connect(this.wowDepth);
        this.wow.start();

        this.noise = this.makeNoise(2);
        this.vinyl = this.startVinyl();
        this.timer = 0;
        // On air (what is heard and shown) and the slot being planned, a little ahead of it.
        this.slot = this.plan = onAir(wallNow());
    }

    makeNoise(seconds) {
        const b = this.ctx.createBuffer(1, Math.round(this.ctx.sampleRate * seconds), this.ctx.sampleRate);
        const d = b.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        return b;
    }

    // Hiss plus sparse pops, looped under everything.
    startVinyl() {
        const ctx = this.ctx, rate = ctx.sampleRate;
        const b = ctx.createBuffer(1, rate * 4, rate);
        const d = b.getChannelData(0);
        let pink = 0;
        for (let i = 0; i < d.length; i++) {
            pink = 0.97 * pink + 0.03 * (Math.random() * 2 - 1);
            d[i] = pink * 0.5;
        }
        for (let n = 0; n < 40; n++) {
            const at = Math.floor(Math.random() * (d.length - 200)), amp = 0.2 + Math.random() * 0.5, sign = Math.random() < 0.5 ? -1 : 1;
            for (let i = 0; i < 60; i++) d[at + i] += sign * amp * Math.exp(-i / 8) * (i % 2 ? -0.5 : 1);
        }
        const src = ctx.createBufferSource();
        src.buffer = b;
        src.loop = true;
        const hp = ctx.createBiquadFilter();
        hp.type = 'highpass';
        hp.frequency.value = 700;
        const g = ctx.createGain();
        g.gain.value = 0.09;
        src.connect(hp).connect(g).connect(this.bus);
        src.start();
        return src;
    }

    get song() {
        return this.slot.song;
    }

    // Position in the song on air, in seconds.
    get time() {
        return Math.max(0, Math.min(this.duration, wallNow() - this.slot.start));
    }

    get duration() {
        return this.slot.end - this.slot.start;
    }

    play() {
        if (this.playing) return;
        this.playing = true;
        const ctx = this.ctx, now = ctx.currentTime;
        // Context time + offset = the wall-clock second at which that sound reaches the speakers.
        this.offset = wallNow() - now + (ctx.outputLatency || 0) + (ctx.baseLatency || 0);
        const wall = now + 0.05 + this.offset;
        this.plan = onAir(wall);
        this.setSlot(this.plan);
        this.step = Math.ceil((wall - this.plan.start) / stepDur(this.plan.song));
        this.out.gain.cancelScheduledValues(now);
        this.out.gain.setTargetAtTime(1, now, 0.08);
        this.timer = setInterval(() => this.tick(), 25);
        this.tick();
    }

    pause() {
        if (!this.playing) return;
        this.playing = false;
        clearInterval(this.timer);
        clearTimeout(this.songTimer);
        const now = this.ctx.currentTime;
        this.out.gain.cancelScheduledValues(now);
        this.out.gain.setTargetAtTime(0, now, 0.04);
    }

    dispose() {
        this.pause();
        setTimeout(() => {
            this.vinyl.stop();
            this.wow.stop();
            this.out.disconnect();
        }, 300);
    }

    setSlot(slot) {
        if (slot === this.slot) return;
        this.slot = slot;
        this.onSong?.(slot.song);
    }

    tick() {
        // Background tabs wake rarely, so they plan further ahead.
        const ahead = typeof document !== 'undefined' && document.hidden ? 1.5 : 0.2;
        const horizon = this.ctx.currentTime + this.offset + ahead;
        for (;;) {
            let plan = this.plan;
            if (plan.start + this.step * stepDur(plan.song) >= plan.end - 1e-6) {
                // The next song is announced when it is heard, not when it is planned.
                const next = onAir(plan.end);
                this.songTimer = setTimeout(() => this.setSlot(next), Math.max(0, (plan.end - this.offset - this.ctx.currentTime) * 1000));
                this.plan = plan = next;
                this.step = 0;
            }
            const at = plan.start + this.step * stepDur(plan.song);
            if (at >= horizon) break;
            this.schedule(plan.song, this.step, at - this.offset);
            this.step++;
        }
    }

    // Every listener plays a step the same way: its small variations come from the song's seed.
    schedule(song, index, t) {
        const r = createRng(`${song.seed}:${index}`);
        const bar = Math.floor(index / 16), s = index % 16, step = stepDur(song);
        const section = sectionAt(song, bar);
        const chord = song.chords[bar % song.chords.length];
        // Swing: every off sixteenth lands late.
        const at = t + (s % 2 ? song.swing * step : 0) + (r.next() - 0.5) * 0.008;
        const beatLen = step * 4;

        if (s === 0) {
            this.tone.frequency.setTargetAtTime(section.muffle ? 1300 : 5200, t, 0.6);
            const strum = r.chance(0.5) ? 0.012 : 0.022;
            chord.notes.forEach((n, i) => this.keys(n, at + i * strum, beatLen * 3.6, 0.07 + 0.02 * r.next()));
        }
        // A light re-hit of the top of the chord on the "and" of three.
        if (s === 10 && r.chance(0.4)) chord.notes.slice(-2).forEach((n, i) => this.keys(n, at + i * 0.015, beatLen * 1.4, 0.045));

        if (section.bass) {
            if (s === 0) this.bass(chord.bass, at, beatLen * 1.6);
            if (s === 10) this.bass(r.chance(0.6) ? chord.bass : chord.fifth, at, beatLen * 1.1);
        }
        if (section.drums) {
            const d = song.drums;
            if (d.kick.includes(s)) this.kick(at);
            if (d.snare.includes(s)) this.snare(at, 0.45);
            if (d.ghost.includes(s) && r.chance(0.7)) this.snare(at, 0.12);
            if (d.hat[s]) this.hat(at, d.hat[s] * (0.8 + 0.4 * r.next()), s === 14 && r.chance(0.15));
        }
        if (section.lead) {
            const n = song.lead[bar % song.lead.length][s];
            if (n) this.lead(n, at, beatLen * (0.6 + r.next()));
        }
        if (s % 4 === 0) this.onBeat?.();
    }

    // Electric piano: a two-operator FM tine that softens as it rings.
    keys(note, t, len, vel) {
        const ctx = this.ctx, f = mtof(note);
        const car = ctx.createOscillator(), mod = ctx.createOscillator(), idx = ctx.createGain(), amp = ctx.createGain();
        car.frequency.value = f;
        mod.frequency.value = f;
        idx.gain.setValueAtTime(f * 1.8, t);
        idx.gain.exponentialRampToValueAtTime(f * 0.15, t + 0.6);
        mod.connect(idx).connect(car.frequency);
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(vel, t + 0.008);
        amp.gain.setTargetAtTime(vel * 0.45, t + 0.01, 0.5);
        amp.gain.setTargetAtTime(0, t + len, 0.18);
        car.connect(amp).connect(this.duck);
        this.voice([car, mod], t, t + len + 1);
    }

    bass(note, t, len) {
        const ctx = this.ctx;
        const osc = ctx.createOscillator(), lp = ctx.createBiquadFilter(), amp = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = mtof(note);
        lp.type = 'lowpass';
        lp.frequency.value = 420;
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(0.42, t + 0.015);
        amp.gain.setTargetAtTime(0.28, t + 0.02, 0.25);
        amp.gain.setTargetAtTime(0, t + len, 0.06);
        osc.connect(lp).connect(amp).connect(this.duck);
        this.voice([osc], t, t + len + 0.5);
    }

    lead(note, t, len) {
        const ctx = this.ctx;
        const osc = ctx.createOscillator(), lp = ctx.createBiquadFilter(), amp = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.value = mtof(note);
        lp.type = 'lowpass';
        lp.frequency.value = 2400;
        amp.gain.setValueAtTime(0, t);
        amp.gain.linearRampToValueAtTime(0.05, t + 0.03);
        amp.gain.setTargetAtTime(0, t + len * 0.5, len * 0.3);
        osc.connect(lp).connect(amp).connect(this.duck);
        this.voice([osc], t, t + len * 2);
    }

    kick(t) {
        const ctx = this.ctx;
        const osc = ctx.createOscillator(), amp = ctx.createGain();
        osc.frequency.setValueAtTime(115, t);
        osc.frequency.exponentialRampToValueAtTime(44, t + 0.11);
        amp.gain.setValueAtTime(0.95, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.42);
        osc.connect(amp).connect(this.bus);
        osc.start(t);
        osc.stop(t + 0.45);
        osc.onended = () => amp.disconnect();
        const g = this.duck.gain;
        g.setValueAtTime(1, t);
        g.linearRampToValueAtTime(0.72, t + 0.02);
        g.setTargetAtTime(1, t + 0.04, 0.09);
    }

    snare(t, vel) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource(), bp = ctx.createBiquadFilter(), amp = ctx.createGain();
        src.buffer = this.noise;
        bp.type = 'bandpass';
        bp.frequency.value = 1700;
        bp.Q.value = 0.7;
        amp.gain.setValueAtTime(vel, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
        src.connect(bp).connect(amp).connect(this.bus);
        src.start(t, Math.random() * 1.5);
        src.stop(t + 0.22);
        src.onended = () => amp.disconnect();
        const body = ctx.createOscillator(), bodyAmp = ctx.createGain();
        body.type = 'triangle';
        body.frequency.value = 185;
        bodyAmp.gain.setValueAtTime(vel * 0.5, t);
        bodyAmp.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        body.connect(bodyAmp).connect(this.bus);
        body.start(t);
        body.stop(t + 0.1);
        body.onended = () => bodyAmp.disconnect();
    }

    hat(t, vel, open) {
        const ctx = this.ctx;
        const src = ctx.createBufferSource(), hp = ctx.createBiquadFilter(), amp = ctx.createGain();
        const len = open ? 0.28 : 0.045;
        src.buffer = this.noise;
        hp.type = 'highpass';
        hp.frequency.value = 7000;
        amp.gain.setValueAtTime(0.11 * vel, t);
        amp.gain.exponentialRampToValueAtTime(0.001, t + len);
        src.connect(hp).connect(amp).connect(this.bus);
        src.start(t, Math.random() * 1.5);
        src.stop(t + len + 0.02);
        src.onended = () => amp.disconnect();
    }

    // Starts pitched oscillators with the shared wobble and lets go of them once they end.
    voice(oscs, t, end) {
        for (const o of oscs) {
            this.wowDepth.connect(o.detune);
            o.start(t);
            o.stop(end);
        }
        oscs[0].onended = () => {
            for (const o of oscs) {
                this.wowDepth.disconnect(o.detune);
                o.disconnect();
            }
        };
    }
}
