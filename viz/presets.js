// Hand-made presets. Each has base parameters (see DEFAULT_PARAMS), a per-frame function that
// moves them with the music, and optionally a GLSL warp snippet run for every pixel, which may
// change zoom, rot, warp, cx, cy, dx, dy, sx, sy from x, y, rad, ang, time, bass… and q1…q4.
//
// frame(p, a, t, s): p — parameters to change in place, a — audio features, t — seconds,
// s — a scratch object that lives as long as the preset is on screen.

const TAU = Math.PI * 2;

export const PRESETS = [
    {
        id: 'tunnel', name: 'Tunnel',
        base: { zoom: 1.04, decay: 0.95, blur: 0.3, waveMode: 0, waveThick: 2 },
        frame(p, a, t) {
            p.zoom = 1.025 + 0.045 * a.bass_att;
            p.rot = 0.012 * Math.sin(t * 0.21);
            p.waveScale = 0.8 + 0.5 * a.bass;
        },
        warp: 'zoom += 0.015 * sin(ang * 6.0 + time * 0.7);',
    },
    {
        id: 'vortex', name: 'Vortex',
        base: { zoom: 1.02, zoomexp: 1.4, decay: 0.965, blur: 0.2, waveMode: 5, warp: 0.3 },
        frame(p, a, t) {
            p.rot = 0.03 * Math.sin(t * 0.17) + 0.02 * (a.bass_att - 1);
            p.waveRot = t * 0.4;
        },
        warp: 'rot += 0.04 * (1.0 - rad) * sin(time * 0.5);',
    },
    {
        id: 'kaleido', name: 'Kaleido',
        base: { zoom: 1.012, warp: 0.9, decay: 0.955, fold: 6, waveMode: 2, waveScale: 1.2, shapeSides: 3, shapeBright: 0.8, shapeRad: 0.12 },
        frame(p, a, t) {
            p.rot = 0.006 * Math.sin(t * 0.3);
            p.shapeAng = t * 0.5;
            p.shapeRad = 0.08 + 0.08 * a.bass_att;
            p.fold = a.treb_att > 1.2 ? 8 : 6;
        },
    },
    {
        id: 'rain', name: 'Rain',
        base: { decay: 0.975, blur: 0.15, waveMode: 1, waveY: 0.88, warp: 0.4, waveThick: 1 },
        frame(p, a, t) {
            p.dy = 0.004 + 0.006 * a.bass_att;
            p.waveScale = 0.6 + 0.6 * a.mid;
        },
        warp: 'dx += 0.002 * sin(y * 30.0 + time * 1.3);',
    },
    {
        id: 'bloom', name: 'Bloom',
        base: { zoom: 0.975, decay: 0.95, blur: 0.4, waveMode: 6, shapeSides: 1, shapeBright: 0.9, shapeThick: 0.01 },
        frame(p, a, t) {
            p.zoom = 0.985 - 0.02 * a.bass_att;
            p.shapeRad = 0.04 + 0.12 * a.bass;
            p.rot = 0.01 * Math.sin(t * 0.4);
            p.waveRot = t * 0.15;
        },
    },
    {
        id: 'scope', name: 'Lissajous',
        base: { decay: 0.9, blur: 0.1, waveMode: 2, waveScale: 1.6, mirror: 1, zoom: 1.005, waveThick: 2 },
        frame(p, a, t) {
            p.rot = 0.004 + 0.004 * a.treb_att;
            p.waveRot = t * 0.1;
        },
    },
    {
        id: 'heartbeat', name: 'Heartbeat',
        base: { zoom: 1.01, decay: 0.93, border: 0.012, borderBright: 0.9, waveMode: 1, warp: 0.6 },
        frame(p, a, t, s) {
            s.flash = Math.max(0, (s.flash || 0) - 0.08);
            if (a.beat && a.beatStrength > 0.4) s.flash = 1;
            p.invert = s.flash > 0.6 ? 1 : 0;
            p.zoom = 1.0 + 0.06 * a.bass;
            p.border = 0.006 + 0.02 * a.bass_att;
        },
    },
    {
        id: 'ripples', name: 'Ripples',
        base: { zoom: 1.0, decay: 0.96, blur: 0.35, waveMode: 0, waveScale: 0.7 },
        frame(p, a, t) {
            p.q1 = 0.4 + a.bass_att;
            p.rot = 0.005 * Math.sin(t * 0.25);
        },
        warp: 'zoom += 0.035 * q1 * sin(rad * 22.0 - time * 4.0);',
    },
    {
        id: 'skyline', name: 'Skyline',
        base: { decay: 0.97, waveMode: 4, waveY: 0.5, waveScale: 1.1, mirror: 2, blur: 0.1 },
        frame(p, a, t) {
            p.dx = 0.003 * Math.sin(t * 0.3);
            p.zoom = 1.0 + 0.012 * a.bass_att;
        },
    },
    {
        id: 'polygon', name: 'Polygon',
        base: { zoom: 1.03, rot: 0.01, decay: 0.95, waveBright: 0.5, shapeSides: 5, shapeBright: 1, shapeRad: 0.15, shapeThick: 0.008 },
        frame(p, a, t, s) {
            if (a.beat) s.n = ((s.n || 0) + 1) % 6;
            p.shapeSides = 3 + (s.n || 0);
            p.shapeAng = t * 0.3 * (1 + a.mid_att);
            p.shapeRad = 0.1 + 0.08 * a.bass;
            p.rot = 0.01 + 0.015 * Math.sin(t * 0.2);
        },
    },
    {
        id: 'drift', name: 'Drift',
        base: { warp: 1.6, warpSpeed: 0.8, decay: 0.965, blur: 0.3, waveMode: 1, waveThick: 2 },
        frame(p, a, t) {
            p.dx = 0.004 * Math.cos(t * 0.23);
            p.dy = 0.004 * Math.sin(t * 0.31);
            p.waveRot = Math.sin(t * 0.12) * Math.PI;
            p.warp = 1 + a.mid_att;
        },
    },
    {
        id: 'stars', name: 'Starfield',
        base: { zoom: 1.06, decay: 0.92, waveMode: 2, waveDots: 1, waveThick: 2, waveScale: 2.2, blur: 0 },
        frame(p, a, t) {
            p.zoom = 1.03 + 0.06 * a.bass_att;
            p.rot = 0.004 * Math.sin(t * 0.13);
            p.waveRot = t;
        },
    },
    {
        id: 'mirrorhall', name: 'Mirror hall',
        base: { warp: 1.1, zoom: 1.015, decay: 0.955, mirror: 2, waveMode: 3, waveScale: 0.9 },
        frame(p, a, t) {
            p.cx = 0.5 + 0.15 * Math.sin(t * 0.19);
            p.cy = 0.5 + 0.15 * Math.cos(t * 0.23);
            p.rot = 0.008 * (a.treb_att - 1);
        },
    },
    {
        id: 'weave', name: 'Weave',
        base: { decay: 0.965, blur: 0.2, border: 0.008, borderBright: 0.7, waveMode: 0, waveScale: 0.6 },
        frame(p, a, t) {
            p.q1 = 0.002 + 0.004 * a.bass_att;
            p.q2 = t * 0.6;
            p.zoom = 1.008;
        },
        warp: 'dx += q1 * sin(y * 40.0 + q2); dy += q1 * cos(x * 40.0 + q2 * 1.3);',
    },
    {
        id: 'orbit', name: 'Orbit',
        base: { decay: 0.97, zoom: 1.0, blur: 0.25, waveMode: 0, waveScale: 0.35, shapeSides: 1, shapeBright: 0.8, shapeRad: 0.02, shapeFill: 1 },
        frame(p, a, t) {
            const r = 0.28;
            p.shapeX = 0.5 + r * Math.cos(t * 0.9) * 0.62;
            p.shapeY = 0.5 + r * Math.sin(t * 0.9);
            p.waveX = 0.5 + r * Math.cos(t * 0.9 + Math.PI) * 0.62;
            p.waveY = 0.5 + r * Math.sin(t * 0.9 + Math.PI);
            p.shapeRad = 0.015 + 0.03 * a.bass;
            p.rot = 0.02 * Math.sin(t * TAU * 0.02);
        },
        warp: 'rot += 0.02 * (1.0 - rad);',
    },
];

export const presetById = (id) => PRESETS.find((p) => p.id === id) || null;
