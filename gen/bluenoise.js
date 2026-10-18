// Blue noise threshold map by void-and-cluster (Ulichney), computed once and cached.
// The visualiser uploads it as a texture and dithers against it in the shader.
let blueCache = null;
export function blueNoise(S = 64) {
    if (blueCache) return blueCache;
    const N = S * S, sigma = 1.9;
    // Toroidal Gaussian kernel, indexed by offset.
    const kernel = new Float32Array(N);
    for (let y = 0; y < S; y++) {
        for (let x = 0; x < S; x++) {
            const dx = Math.min(x, S - x), dy = Math.min(y, S - y);
            kernel[y * S + x] = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
        }
    }
    const energy = new Float32Array(N);
    const bits = new Uint8Array(N);
    const splat = (i, sign) => {
        const ix = i % S, iy = (i / S) | 0;
        for (let y = 0; y < S; y++) {
            const ky = ((y - iy + S) % S) * S, row = y * S;
            for (let x = 0; x < S; x++) energy[row + x] += sign * kernel[ky + ((x - ix + S) % S)];
        }
    };
    const extreme = (wantOnes, max) => {
        let best = -1, bv = max ? -Infinity : Infinity;
        for (let i = 0; i < N; i++) {
            if (bits[i] !== (wantOnes ? 1 : 0)) continue;
            if (max ? energy[i] > bv : energy[i] < bv) { bv = energy[i]; best = i; }
        }
        return best;
    };
    // Deterministic initial pattern (~10%), then relax: move tightest cluster into largest void.
    let s = 12345;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    const ones = Math.round(N * 0.1);
    for (let k = 0; k < ones; k++) {
        let i;
        do { i = Math.floor(rnd() * N); } while (bits[i]);
        bits[i] = 1; splat(i, 1);
    }
    for (let guard = 0; guard < N; guard++) {
        const c = extreme(true, true);
        bits[c] = 0; splat(c, -1);
        const v = extreme(false, false);
        if (v === c) { bits[c] = 1; splat(c, 1); break; }
        bits[v] = 1; splat(v, 1);
    }
    const rank = new Float32Array(N);
    const proto = bits.slice(), protoEnergy = energy.slice();
    // Phase 1: remove clusters from the prototype, ranking downwards.
    let count = ones;
    while (count > 0) {
        const c = extreme(true, true);
        bits[c] = 0; splat(c, -1); count--;
        rank[c] = count;
    }
    // Phase 2/3: from the prototype, fill voids, ranking upwards.
    bits.set(proto); energy.set(protoEnergy); count = ones;
    while (count < N) {
        const v = extreme(false, false);
        bits[v] = 1; splat(v, 1);
        rank[v] = count++;
    }
    for (let i = 0; i < N; i++) rank[i] = (rank[i] + 0.5) / N;
    blueCache = { map: rank, size: S };
    return blueCache;
}
