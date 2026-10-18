// Which preset is on screen and when it changes. A change blends the parameters of the old and
// the new preset over a couple of seconds; the feedback image carries on through the change,
// so one picture melts into the next as in MilkDrop.
import { DEFAULT_PARAMS, DISCRETE } from './pipeline.js';
import { PRESETS } from './presets.js';
import { makePreset } from './random.js';
import { newSeed } from '../gen/rng.js';

const BLEND_SECONDS = 2;
const smooth = (x) => x * x * (3 - 2 * x);

export class Director {
    constructor({ minTime = 14, maxTime = 32, randomShare = 0.35 } = {}) {
        this.minTime = minTime;
        this.maxTime = maxTime;
        this.randomShare = randomShare;
        this.locked = false;
        this.current = null;
        this.previous = null;
        this.blend = 1;
        this.since = 0;
        this.bag = [];
        this.onChange = () => {};
        this.params = { ...DEFAULT_PARAMS };
    }

    set(preset, { instant = false } = {}) {
        this.previous = instant ? null : this.current;
        this.current = { preset, state: {} };
        this.blend = instant || !this.previous ? 1 : 0;
        this.since = 0;
        this.onChange(preset);
    }

    // Hand-made presets in shuffled order, each once per round, mixed with seeded ones.
    next() {
        if (Math.random() < this.randomShare) return this.random();
        if (!this.bag.length) {
            this.bag = PRESETS.filter((p) => p !== this.current?.preset);
            for (let i = this.bag.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [this.bag[i], this.bag[j]] = [this.bag[j], this.bag[i]];
            }
        }
        this.set(this.bag.pop());
    }

    random(seed = newSeed(6)) {
        this.set(makePreset(seed));
    }

    // Advance by dt seconds; returns the parameters and warp snippet for this frame.
    update(dt, audio, t) {
        this.since += dt;
        // Change on a strong beat once the preset has had its time, or anyway after a while.
        if (!this.locked && this.since > this.minTime && ((audio.beat && audio.beatStrength > 0.5) || this.since > this.maxTime)) this.next();

        const now = evaluate(this.current, audio, t);
        if (this.blend < 1 && this.previous) {
            this.blend = Math.min(1, this.blend + dt / BLEND_SECONDS);
            const was = evaluate(this.previous, audio, t), k = smooth(this.blend);
            for (const key in now) now[key] = DISCRETE.has(key) ? (k < 0.5 ? was[key] : now[key]) : was[key] + (now[key] - was[key]) * k;
            if (this.blend >= 1) this.previous = null;
        }
        this.params = now;
        return { params: now, snippet: this.current.preset.warp || '' };
    }
}

function evaluate(entry, audio, t) {
    const p = { ...DEFAULT_PARAMS, ...entry.preset.base };
    entry.preset.frame?.(p, audio, t, entry.state);
    return p;
}
