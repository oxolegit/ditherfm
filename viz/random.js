// A preset from a seed: base parameters, motion and a warp snippet, all drawn from the seed,
// so the same seed always gives the same preset (and a link can carry it).
import { createRng } from '../gen/rng.js';

// A GLSL float literal: always with a decimal point.
const f = (v) => {
    const s = v.toFixed(3);
    return s.includes('.') ? s : s + '.0';
};

const WARPS = [
    (r) => `zoom += ${f(r.range(0.01, 0.04))} * sin(rad * ${f(r.range(6, 24))} - time * ${f(r.range(0.5, 4))});`,
    (r) => `rot += ${f(r.range(0.01, 0.05) * r.sign())} * sin(ang * ${f(r.int(2, 8))} + time * ${f(r.range(0.2, 1.5))});`,
    (r) => `zoom += ${f(r.range(0.01, 0.04))} * bass_att * (1.0 - rad);`,
    (r) => `dx += ${f(r.range(0.001, 0.004))} * sin(y * ${f(r.range(10, 50))} + time * ${f(r.range(0.3, 2))}); dy += ${f(r.range(0.001, 0.004))} * cos(x * ${f(r.range(10, 50))} + time * ${f(r.range(0.3, 2))});`,
    (r) => `rot += ${f(r.range(0.01, 0.05) * r.sign())} * rad * sin(time * ${f(r.range(0.2, 1))});`,
    (r) => `zoom += ${f(r.range(0.01, 0.03))} * cos(ang * ${f(r.int(2, 7))}) * mid_att;`,
    (r) => `sx += ${f(r.range(0.005, 0.02))} * sin(y * ${f(r.range(4, 16))} + time); sy += ${f(r.range(0.005, 0.02))} * sin(x * ${f(r.range(4, 16))} - time);`,
];

export function makePreset(seed) {
    const r = createRng(`preset/${seed}`);

    const base = {
        zoom: r.weighted([[r.range(1.005, 1.05), 5], [r.range(0.97, 0.995), 2], [1, 1]]),
        zoomexp: r.chance(0.3) ? r.range(0.8, 1.5) : 1,
        warp: r.weighted([[0, 2], [r.range(0.2, 1), 3], [r.range(1, 2), 2]]),
        warpSpeed: r.range(0.5, 1.5),
        warpScale: r.range(0.7, 1.6),
        decay: r.range(0.91, 0.98),
        blur: r.range(0, 0.5),
        fold: r.weighted([[0, 7], [4, 1], [6, 2], [8, 1]]),
        mirror: r.weighted([[0, 6], [1, 1.5], [2, 1]]),
        gamma: r.range(0.8, 1.3),
        waveMode: r.int(0, 6),
        waveScale: r.range(0.7, 1.4),
        waveThick: r.weighted([[1, 2], [2, 2], [3, 1]]),
        waveDots: r.chance(0.18) ? 1 : 0,
        waveBright: r.range(0.7, 1),
        shapeSides: r.chance(0.45) ? r.pick([1, 3, 4, 5, 6, 8]) : 0,
        shapeRad: r.range(0.05, 0.2),
        shapeThick: r.range(0.005, 0.02),
        shapeBright: r.range(0.6, 1),
        shapeFill: r.chance(0.25) ? 1 : 0,
        border: r.chance(0.2) ? r.range(0.005, 0.015) : 0,
        borderBright: r.range(0.5, 1),
    };

    // Motion: how strongly each parameter follows the music and time.
    const m = {
        zoomBass: r.chance(0.7) ? r.range(0.01, 0.05) : 0,
        rotAmp: r.chance(0.6) ? r.range(0.003, 0.025) : 0,
        rotSpeed: r.range(0.1, 0.5),
        rotBias: r.chance(0.3) ? r.range(-0.01, 0.01) : 0,
        driftAmp: r.chance(0.3) ? r.range(0.001, 0.005) : 0,
        driftSpeed: r.range(0.1, 0.4),
        waveSpin: r.chance(0.5) ? r.range(-0.6, 0.6) : 0,
        waveBass: r.range(0, 0.6),
        shapeSpin: r.range(-1, 1),
        shapeBass: r.range(0.02, 0.1),
        centreAmp: r.chance(0.25) ? r.range(0.05, 0.2) : 0,
        invertOnBeat: r.chance(0.12),
    };

    const snippets = [];
    const count = r.weighted([[0, 1], [1, 4], [2, 2]]);
    for (let i = 0; i < count; i++) snippets.push(r.pick(WARPS)(r));

    return {
        id: `seed:${seed}`,
        name: seed,
        seed,
        base,
        warp: snippets.join('\n    '),
        frame(p, a, t, s) {
            p.zoom = base.zoom + m.zoomBass * (a.bass_att - 1);
            p.rot = m.rotBias + m.rotAmp * Math.sin(t * m.rotSpeed);
            p.dx = m.driftAmp * Math.cos(t * m.driftSpeed);
            p.dy = m.driftAmp * Math.sin(t * m.driftSpeed * 1.3);
            p.waveRot = t * m.waveSpin;
            p.waveScale = base.waveScale * (1 + m.waveBass * (a.bass - 1));
            p.shapeAng = t * m.shapeSpin;
            p.shapeRad = base.shapeRad + m.shapeBass * (a.bass - 1);
            if (m.centreAmp) {
                p.cx = 0.5 + m.centreAmp * Math.sin(t * 0.21);
                p.cy = 0.5 + m.centreAmp * Math.cos(t * 0.17);
            }
            if (m.invertOnBeat) {
                s.flash = Math.max(0, (s.flash || 0) - 0.1);
                if (a.beat && a.beatStrength > 0.5) s.flash = 1;
                p.invert = s.flash > 0.6 ? 1 : 0;
            }
        },
    };
}
