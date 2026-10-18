// Seeded randomness. A seed is a short string; everything a preset needs is derived from it,
// so the same seed always gives the same visuals.

// cyrb128: a fast string hash giving four 32-bit words to seed the generator.
function cyrb128(str) {
    let h1 = 1779033703, h2 = 3144134277, h3 = 1013904242, h4 = 2773480762;
    for (let i = 0; i < str.length; i++) {
        const k = str.charCodeAt(i);
        h1 = h2 ^ Math.imul(h1 ^ k, 597399067);
        h2 = h3 ^ Math.imul(h2 ^ k, 2869860233);
        h3 = h4 ^ Math.imul(h3 ^ k, 951274213);
        h4 = h1 ^ Math.imul(h4 ^ k, 2716044179);
    }
    h1 = Math.imul(h3 ^ (h1 >>> 18), 597399067);
    h2 = Math.imul(h4 ^ (h2 >>> 22), 2869860233);
    h3 = Math.imul(h1 ^ (h3 >>> 17), 951274213);
    h4 = Math.imul(h2 ^ (h4 >>> 19), 2716044179);
    h1 ^= h2 ^ h3 ^ h4;
    h2 ^= h1;
    h3 ^= h1;
    h4 ^= h1;
    return [h1 >>> 0, h2 >>> 0, h3 >>> 0, h4 >>> 0];
}

// sfc32: small, fast, good-quality 32-bit generator.
function sfc32(a, b, c, d) {
    return () => {
        a |= 0; b |= 0; c |= 0; d |= 0;
        const t = (((a + b) | 0) + d) | 0;
        d = (d + 1) | 0;
        a = b ^ (b >>> 9);
        b = (c + (c << 3)) | 0;
        c = (c << 21) | (c >>> 11);
        c = (c + t) | 0;
        return (t >>> 0) / 4294967296;
    };
}

export function createRng(seed) {
    const next = sfc32(...cyrb128(String(seed)));
    // Warm up so short, similar seeds diverge immediately.
    for (let i = 0; i < 12; i++) next();

    const rng = {
        seed: String(seed),
        next,
        range: (a, b) => a + (b - a) * next(),
        int: (a, b) => a + Math.floor(next() * (b - a + 1)),
        chance: (p) => next() < p,
        sign: () => (next() < 0.5 ? -1 : 1),
        pick: (list) => list[Math.floor(next() * list.length)],
        // pairs: [[value, weight], ...]
        weighted(pairs) {
            const total = pairs.reduce((s, [, w]) => s + w, 0);
            let r = next() * total;
            for (const [value, w] of pairs) {
                if ((r -= w) <= 0) return value;
            }
            return pairs[pairs.length - 1][0];
        },
        gauss(mean = 0, sd = 1) {
            const u = 1 - next(), v = next();
            return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
        },
        // An independent stream for a sub-task, stable regardless of how much the parent was used.
        fork: (label) => createRng(`${seed}/${label}`),
    };
    return rng;
}

// Human-friendly seed: 8 characters without look-alikes (no 0/o, 1/l/i).
const ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';

export function newSeed(length = 8) {
    const bytes = new Uint8Array(length);
    crypto.getRandomValues(bytes);
    let s = '';
    for (const b of bytes) s += ALPHABET[b % ALPHABET.length];
    return s;
}

// The n-th fallback seed after `seed`: deterministic, so a shared link always resolves the same way.
export function deriveSeed(seed, n, length = 8) {
    const r = createRng(`${seed}#${n}`);
    let s = '';
    for (let i = 0; i < length; i++) s += ALPHABET[Math.floor(r.next() * ALPHABET.length)];
    return s;
}

export function isSeed(value) {
    return typeof value === 'string' && /^[a-z0-9-]{1,32}$/i.test(value);
}
