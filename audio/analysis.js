// What an AnalyserNode would report at a given moment, computed from a rendered buffer: the
// offline video sees the same spectrum and waveform as the live visuals. Blackman window,
// magnitudes scaled by 1/N as in the Web Audio spec, no smoothing.

export function createAnalysis(fftSize = 2048) {
    const n = fftSize, half = n / 2, levels = Math.log2(n);
    const window = new Float64Array(n);
    for (let i = 0; i < n; i++) window[i] = 0.42 - 0.5 * Math.cos((2 * Math.PI * i) / n) + 0.08 * Math.cos((4 * Math.PI * i) / n);
    const rev = new Uint32Array(n);
    for (let i = 0; i < n; i++) {
        let r = 0;
        for (let b = 0; b < levels; b++) r |= ((i >> b) & 1) << (levels - 1 - b);
        rev[i] = r;
    }
    const cos = new Float64Array(half), sin = new Float64Array(half);
    for (let i = 0; i < half; i++) {
        cos[i] = Math.cos((2 * Math.PI * i) / n);
        sin[i] = -Math.sin((2 * Math.PI * i) / n);
    }
    const re = new Float64Array(n), im = new Float64Array(n);
    const mag = new Float32Array(half);
    const waves = [new Float32Array(n), new Float32Array(n)];

    // Iterative radix-2 FFT of the windowed input; adds |X[k]| / N into mag, scaled by gain.
    function spectrum(input, gain) {
        for (let i = 0; i < n; i++) {
            re[rev[i]] = input[i] * window[i];
            im[rev[i]] = 0;
        }
        for (let size = 2; size <= n; size *= 2) {
            const h = size / 2, step = n / size;
            for (let start = 0; start < n; start += size) {
                for (let j = 0; j < h; j++) {
                    const a = start + j, b = a + h, c = cos[j * step], s = sin[j * step];
                    const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
        }
        for (let k = 0; k < half; k++) mag[k] += (gain * Math.hypot(re[k], im[k])) / n;
    }

    // channels: [left, right] Float32Arrays; end: the sample the moment falls on.
    // Returns the mean magnitude of both channels and the last fftSize samples of each.
    function at(channels, end) {
        mag.fill(0);
        for (let c = 0; c < 2; c++) {
            const src = channels[c] || channels[0], w = waves[c];
            const from = end - n;
            for (let i = 0; i < n; i++) {
                const j = from + i;
                w[i] = j >= 0 && j < src.length ? src[j] : 0;
            }
            spectrum(w, 0.5);
        }
        return { mag, waves };
    }

    return { at, fftSize: n };
}
