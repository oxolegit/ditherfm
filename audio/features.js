// What the visuals listen to, in MilkDrop's terms: bass, mid and treb near 1 for a typical
// moment of the track, above 1 when louder than usual; *_att are slower versions of the same.
// Plus beats, a short waveform per channel and a log-spaced spectrum.

export const BANDS = { bass: [20, 250], mid: [250, 2000], treb: [2000, 11000] };
export const WAVE_POINTS = 512;
export const SPECTRUM_BINS = 64;

// Energy per band from linear magnitudes, bin i sitting at i * binHz.
export function bandEnergies(mag, binHz) {
    const out = { bass: 0, mid: 0, treb: 0 };
    for (const [band, [lo, hi]] of Object.entries(BANDS)) {
        const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(mag.length - 1, Math.ceil(hi / binHz));
        let e = 0;
        for (let i = a; i <= b; i++) e += mag[i] * mag[i];
        out[band] = e / Math.max(1, b - a + 1);
    }
    return out;
}

// Smoothing factor for a time constant tau over a step dt: frame-rate independent.
const follow = (dt, tau) => Math.exp(-dt / tau);

// Log-spaced spectrum, 0…1, from 40 Hz to 16 kHz.
export function logSpectrum(mag, binHz, out = new Float32Array(SPECTRUM_BINS)) {
    const lo = Math.log(40), hi = Math.log(16000);
    for (let k = 0; k < out.length; k++) {
        const a = Math.exp(lo + ((hi - lo) * k) / out.length) / binHz;
        const b = Math.exp(lo + ((hi - lo) * (k + 1)) / out.length) / binHz;
        let m = 0;
        for (let i = Math.floor(a); i <= Math.min(mag.length - 1, Math.ceil(b)); i++) m = Math.max(m, mag[i]);
        // Magnitudes from the analyser are tiny; map roughly −70…−10 dB to 0…1.
        const db = 20 * Math.log10(m + 1e-9);
        out[k] = Math.max(0, Math.min(1, (db + 70) / 60));
    }
    return out;
}

export function createFeatures() {
    const s = {
        bass: 0, mid: 0, treb: 0, bass_att: 0, mid_att: 0, treb_att: 0, vol: 0,
        beat: false, beatStrength: 0, sinceBeat: 99, time: 0,
        wave: [new Float32Array(WAVE_POINTS), new Float32Array(WAVE_POINTS)],
        spectrum: new Float32Array(SPECTRUM_BINS),
    };
    const avg = { bass: 0, mid: 0, treb: 0 }, inst = { bass: 0, mid: 0, treb: 0 };
    let fluxMean = 0, fluxVar = 0, prevBass = 0, warm = 0;

    // mag: linear magnitudes (mono), waves: [left, right] time-domain samples, dt in seconds.
    function update(mag, binHz, waves, dt) {
        dt = Math.min(Math.max(dt, 1 / 240), 0.1);
        s.time += dt;
        warm = Math.min(1, warm + dt / 1.5);
        const e = bandEnergies(mag, binHz);
        const kInst = follow(dt, 0.04), kAvg = follow(dt, 3), kAtt = follow(dt, 0.35);
        for (const band of ['bass', 'mid', 'treb']) {
            inst[band] = inst[band] * kInst + e[band] * (1 - kInst);
            // Early on the average is still filling up; let it catch up fast.
            const k = warm < 1 ? Math.min(kAvg, follow(dt, 0.3)) : kAvg;
            avg[band] = avg[band] * k + e[band] * (1 - k);
            const rel = avg[band] > 1e-12 ? Math.min(4, inst[band] / avg[band]) : 0;
            s[band] = rel;
            s[band + '_att'] = s[band + '_att'] * kAtt + rel * (1 - kAtt);
        }
        s.vol = (s.bass + s.mid + s.treb) / 3;

        // Beats: a jump in bass energy well above its usual jumps, at most ~4 per second.
        const flux = Math.max(0, e.bass - prevBass);
        prevBass = e.bass;
        const kFlux = follow(dt, 1.2);
        const threshold = fluxMean + 1.6 * Math.sqrt(fluxVar);
        s.sinceBeat += dt;
        s.beat = warm >= 1 && flux > threshold && flux > 1e-10 && s.bass > 1.05 && s.sinceBeat > 0.25;
        if (s.beat) {
            s.beatStrength = Math.min(1, (flux - fluxMean) / (4 * Math.sqrt(fluxVar) + 1e-12));
            s.sinceBeat = 0;
        } else s.beatStrength *= follow(dt, 0.15);
        fluxMean = fluxMean * kFlux + flux * (1 - kFlux);
        fluxVar = fluxVar * kFlux + (flux - fluxMean) ** 2 * (1 - kFlux);

        for (let c = 0; c < 2; c++) resample(waves[c] || waves[0], s.wave[c]);
        logSpectrum(mag, binHz, s.spectrum);
        return s;
    }

    // Nothing playing: a slow made-up signal, so an empty page still breathes.
    function idle(dt) {
        dt = Math.min(Math.max(dt, 1 / 240), 0.1);
        const t = (s.time += dt);
        const pulse = Math.pow(0.5 + 0.5 * Math.sin(t * 2.2), 6);
        s.bass = 0.7 + 0.6 * pulse;
        s.mid = 0.85 + 0.25 * Math.sin(t * 0.9 + 1);
        s.treb = 0.8 + 0.2 * Math.sin(t * 1.7 + 2);
        const k = follow(dt, 0.35);
        for (const band of ['bass', 'mid', 'treb']) s[band + '_att'] = s[band + '_att'] * k + s[band] * (1 - k);
        s.vol = (s.bass + s.mid + s.treb) / 3;
        s.sinceBeat += dt;
        s.beat = false;
        s.beatStrength *= follow(dt, 0.15);
        for (let c = 0; c < 2; c++) {
            const w = s.wave[c];
            for (let i = 0; i < w.length; i++) {
                const x = i / w.length;
                w[i] = 0.35 * Math.sin(2 * Math.PI * (3 * x + t * 0.4 + c * 0.25)) * (0.6 + 0.4 * pulse)
                    + 0.12 * Math.sin(2 * Math.PI * (11 * x - t * 1.3));
            }
        }
        for (let k = 0; k < s.spectrum.length; k++) {
            s.spectrum[k] = Math.max(0, 0.55 - k / s.spectrum.length * 0.5 + 0.15 * Math.sin(k * 0.7 + t * 2) + 0.2 * pulse * (k < 8));
        }
        return s;
    }

    return { state: s, update, idle };
}

// Linear resample of a block of samples to the fixed wave length.
function resample(src, dst) {
    const n = src.length, m = dst.length;
    for (let i = 0; i < m; i++) {
        const x = (i * (n - 1)) / (m - 1), a = Math.floor(x), f = x - a;
        dst[i] = src[a] * (1 - f) + (src[Math.min(n - 1, a + 1)] || 0) * f;
    }
}
