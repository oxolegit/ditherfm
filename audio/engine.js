// Playback with the nightcore treatment: speed and pitch move together (playbackRate without
// pitch correction), then a bass shelf, reverb and a limiter. The same chain is reused offline
// for the WAV export, so the download sounds exactly like the preview.

export const MODES = {
    original: { rate: 1, bass: 0, reverb: 0 },
    nightcore: { rate: 1.25, bass: 4, reverb: 0.12 },
    hyper: { rate: 1.4, bass: 6, reverb: 0 },
    daycore: { rate: 0.8, bass: 3, reverb: 0.45 },
};

export const LIMITS = { rate: [0.5, 2], bass: [0, 12], reverb: [0, 1] };

export const clampSetting = (key, v) => {
    const [a, b] = LIMITS[key];
    return Math.max(a, Math.min(b, Number.isFinite(+v) ? +v : MODES.original[key]));
};

// The mode whose values match these settings, or null for a hand-tuned mix.
export function modeOf({ rate, bass, reverb }) {
    for (const [id, m] of Object.entries(MODES)) {
        if (Math.abs(m.rate - rate) < 0.005 && Math.abs(m.bass - bass) < 0.05 && Math.abs(m.reverb - reverb) < 0.005) return id;
    }
    return null;
}

// Pitch shift in semitones that a given speed causes.
export const semitones = (rate) => 12 * Math.log2(rate);

export const REVERB_TAIL = 2.6;

// Decaying stereo noise: a cheap, smooth room. Seeded, so every render uses the same room.
export function impulseResponse(ctx, seconds = REVERB_TAIL, decay = 3.2) {
    const rate = ctx.sampleRate, length = Math.round(rate * seconds);
    const buffer = ctx.createBuffer(2, length, rate);
    let s = 2463534242;
    const rnd = () => {
        s ^= s << 13; s ^= s >>> 17; s ^= s << 5;
        return (s >>> 0) / 4294967296 * 2 - 1;
    };
    for (let c = 0; c < 2; c++) {
        const data = buffer.getChannelData(c);
        for (let i = 0; i < length; i++) data[i] = rnd() * Math.pow(1 - i / length, decay);
    }
    return buffer;
}

// input → bass shelf → (dry + reverb) → limiter → output.
export function buildChain(ctx, input, settings) {
    const bass = ctx.createBiquadFilter();
    bass.type = 'lowshelf';
    bass.frequency.value = 150;

    const dry = ctx.createGain();
    const wet = ctx.createGain();
    const convolver = ctx.createConvolver();
    convolver.buffer = impulseResponse(ctx);

    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -4;
    limiter.knee.value = 0;
    limiter.ratio.value = 20;
    limiter.attack.value = 0.001;
    limiter.release.value = 0.12;

    input.connect(bass);
    bass.connect(dry).connect(limiter);
    bass.connect(convolver).connect(wet).connect(limiter);

    const set = ({ bass: db, reverb }) => {
        const now = ctx.currentTime;
        bass.gain.setTargetAtTime(db, now, 0.03);
        // Keep the overall level roughly even as the room is mixed in.
        dry.gain.setTargetAtTime(1 - 0.45 * reverb, now, 0.03);
        wet.gain.setTargetAtTime(0.9 * reverb, now, 0.03);
    };
    set(settings);
    return { output: limiter, set };
}

export class Engine {
    constructor() {
        this.audio = new Audio();
        this.audio.preload = 'auto';
        this.settings = { ...MODES.nightcore };
        this.volume = 0.5;
        this.muted = false;
        this.ctx = null;
        this.url = null;
    }

    // The audio graph needs a user gesture in most browsers, so it is built on first play.
    ensure() {
        if (this.ctx) return;
        const ctx = new AudioContext();
        const source = ctx.createMediaElementSource(this.audio);
        this.chain = buildChain(ctx, source, this.settings);

        // Two analysers, left and right, for stereo scopes; their sum drives the bands.
        const splitter = ctx.createChannelSplitter(2);
        this.analysers = [0, 1].map((ch) => {
            const a = ctx.createAnalyser();
            a.fftSize = 2048;
            a.smoothingTimeConstant = 0;
            splitter.connect(a, ch);
            return a;
        });
        this.chain.output.connect(splitter);
        // Volume sits after the analysers: quieter listening does not dim the visuals.
        this.gain = ctx.createGain();
        this.gain.gain.value = this.level;
        this.chain.output.connect(this.gain).connect(ctx.destination);
        this.ctx = ctx;
    }

    load(file) {
        if (this.url) URL.revokeObjectURL(this.url);
        this.url = URL.createObjectURL(file);
        this.audio.src = this.url;
        this.applyRate();
    }

    async play() {
        this.ensure();
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        this.applyRate();
        return this.audio.play();
    }

    pause() {
        this.audio.pause();
    }

    seek(t) {
        if (Number.isFinite(this.audio.duration)) this.audio.currentTime = Math.max(0, Math.min(this.audio.duration, t));
    }

    set(settings) {
        this.settings = {
            rate: clampSetting('rate', settings.rate ?? this.settings.rate),
            bass: clampSetting('bass', settings.bass ?? this.settings.bass),
            reverb: clampSetting('reverb', settings.reverb ?? this.settings.reverb),
        };
        this.applyRate();
        this.chain?.set(this.settings);
    }

    // Loading a new source resets the rate, so it is reapplied after every load and play.
    applyRate() {
        const a = this.audio;
        a.preservesPitch = a.mozPreservesPitch = a.webkitPreservesPitch = false;
        a.defaultPlaybackRate = a.playbackRate = this.settings.rate;
    }

    // 0…1, on a squared curve so the slider feels even to the ear.
    setVolume(v, muted = this.muted) {
        this.volume = Math.max(0, Math.min(1, +v || 0));
        this.muted = muted;
        this.gain?.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.02);
    }

    get level() {
        return this.muted ? 0 : this.volume * this.volume;
    }

    get playing() {
        return !this.audio.paused && !this.audio.ended;
    }
}
