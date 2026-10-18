// One frame, MilkDrop-style:
//   1. warp  — last frame resampled through a per-pixel zoom / rotation / warp field and faded,
//              plus a pulsing shape and a border that the motion then drags along;
//   2. wave  — the waveform or spectrum drawn on top;
//   3. ink   — brightness → threshold per cell → two colours of the palette.
// The feedback lives at cell resolution and in shades of grey, so the dither sees a smooth tone.
import { createGL, program, texture, pingPong, bindTexture, FULLSCREEN_VS } from './gl.js';
import { DITHER_GLSL, blueNoiseTexture, ditherIndex } from './dither.js';
import { WAVE_POINTS } from '../audio/features.js';

export const WAVE_MODES = ['circle', 'line', 'scope', 'double', 'spectrum', 'spiral', 'radial'];

// Every parameter a preset can set; numbers only, so two presets can be blended.
export const DEFAULT_PARAMS = {
    zoom: 1, zoomexp: 1, rot: 0, warp: 0, warpSpeed: 1, warpScale: 1,
    cx: 0.5, cy: 0.5, dx: 0, dy: 0, sx: 1, sy: 1,
    decay: 0.96, blur: 0.25, wrap: 1, fold: 0, mirror: 0,
    gain: 1, gamma: 1, invert: 0,
    waveMode: 0, waveScale: 1, waveX: 0.5, waveY: 0.5, waveRot: 0, waveBright: 1, waveThick: 1, waveDots: 0,
    shapeSides: 0, shapeRad: 0.2, shapeThick: 0.012, shapeBright: 0, shapeFill: 0, shapeAng: 0, shapeX: 0.5, shapeY: 0.5,
    border: 0, borderBright: 1,
    q1: 0, q2: 0, q3: 0, q4: 0,
};

// Parameters that pick between alternatives: blended by switching halfway, not by mixing.
export const DISCRETE = new Set(['waveMode', 'waveDots', 'shapeSides', 'fold', 'mirror', 'wrap']);

const AUDIO_UNIFORMS = ['bass', 'mid', 'treb', 'bass_att', 'mid_att', 'treb_att'];

const warpFS = (snippet) => `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 o;
uniform sampler2D u_prev;
uniform vec2 u_res;
uniform float u_aspect, u_time;
uniform float u_zoom, u_zoomexp, u_rot, u_warp, u_warpSpeed, u_warpScale, u_cx, u_cy, u_dx, u_dy, u_sx, u_sy;
uniform float u_decay, u_blur, u_wrap, u_fold, u_mirror;
uniform float u_shapeSides, u_shapeRad, u_shapeThick, u_shapeBright, u_shapeFill, u_shapeAng, u_shapeX, u_shapeY;
uniform float u_border, u_borderBright;
uniform vec4 u_q;
uniform float ${AUDIO_UNIFORMS.map((n) => 'u_' + n).join(', ')};
const float PI = 3.14159265;

mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }

// Signed distance to a regular polygon (n ≥ 3) or a circle (n < 3).
float polygon(vec2 p, float n, float r) {
    if (n < 2.5) return length(p) - r;
    float an = PI / n;
    float b = mod(atan(p.y, p.x) + an, 2.0 * an) - an;
    return cos(b) * length(p) - r * cos(an);
}

void main() {
    vec2 uv = v_uv;
    vec2 asp = vec2(u_aspect, 1.0);
    // Preset code sees MilkDrop's names: x, y in 0…1, rad 0 (centre) … 1 (corner), ang.
    float x = uv.x, y = uv.y;
    vec2 c = (uv - 0.5) * asp;
    float rad = length(c) / length(asp * 0.5);
    float ang = atan(c.y, c.x);
    float time = u_time;
    float bass = u_bass, mid = u_mid, treb = u_treb, bass_att = u_bass_att, mid_att = u_mid_att, treb_att = u_treb_att;
    float q1 = u_q.x, q2 = u_q.y, q3 = u_q.z, q4 = u_q.w;
    float zoom = u_zoom, zoomexp = u_zoomexp, rot = u_rot, warp = u_warp;
    float cx = u_cx, cy = u_cy, dx = u_dx, dy = u_dy, sx = u_sx, sy = u_sy;

    ${snippet}

    // The same order of operations as MilkDrop's per-vertex warp.
    float z = pow(max(zoom, 0.01), pow(max(zoomexp, 0.01), rad * 2.0 - 1.0));
    vec2 p = (uv - vec2(cx, cy)) * asp;
    p /= z;
    p /= vec2(sx, sy);
    vec2 m = uv * 2.0 - 1.0;
    float wt = time * u_warpSpeed, ws = 1.0 / max(u_warpScale, 0.01);
    vec4 f = vec4(11.68 + 4.0 * cos(wt * 1.413 + 10.0), 8.77 + 3.0 * cos(wt * 1.113 + 7.0),
                  10.54 + 3.0 * cos(wt * 1.233 + 3.0), 11.49 + 4.0 * cos(wt * 0.933 + 5.0));
    p.x += warp * 0.0035 * sin(wt * 0.333 + ws * (m.x * f.x - m.y * f.w));
    p.y += warp * 0.0035 * cos(wt * 0.375 - ws * (m.x * f.z + m.y * f.y));
    p.x += warp * 0.0035 * cos(wt * 0.753 - ws * (m.x * f.y - m.y * f.z));
    p.y += warp * 0.0035 * sin(wt * 0.825 + ws * (m.x * f.x + m.y * f.w));
    p = rot2(rot) * p;
    vec2 src = p / asp + vec2(cx, cy) - vec2(dx, dy);

    if (u_fold > 1.5) {
        vec2 k = (src - 0.5) * asp;
        float seg = 2.0 * PI / u_fold;
        float a = abs(mod(atan(k.y, k.x), seg) - 0.5 * seg);
        src = vec2(cos(a), sin(a)) * length(k) / asp + 0.5;
    }
    if (u_mirror > 0.5) src.x = 0.5 - abs(src.x - 0.5);
    if (u_mirror > 1.5) src.y = 0.5 - abs(src.y - 0.5);
    src = u_wrap > 0.5 ? fract(src) : clamp(src, 0.0, 1.0);

    float v = texture(u_prev, src).r;
    if (u_blur > 0.0) {
        vec2 t = 1.0 / u_res;
        float b = texture(u_prev, src + vec2(t.x, 0)).r + texture(u_prev, src - vec2(t.x, 0)).r
                + texture(u_prev, src + vec2(0, t.y)).r + texture(u_prev, src - vec2(0, t.y)).r;
        v = mix(v, b * 0.25, u_blur);
    }
    v *= u_decay;

    if (u_shapeSides > 0.5 && u_shapeBright > 0.0) {
        vec2 sp = rot2(-u_shapeAng) * ((uv - vec2(u_shapeX, u_shapeY)) * asp);
        float d = polygon(sp, u_shapeSides, u_shapeRad);
        float px = 1.5 / u_res.y;
        v = max(v, u_shapeBright * max(1.0 - smoothstep(u_shapeThick, u_shapeThick + px, abs(d)), u_shapeFill * step(d, 0.0)));
    }
    if (u_border > 0.0) {
        float e = min(min(uv.x, 1.0 - uv.x) * u_aspect, min(uv.y, 1.0 - uv.y));
        v = max(v, u_borderBright * step(e, u_border));
    }
    o = vec4(vec3(clamp(v, 0.0, 1.0)), 1.0);
}`;

const WAVE_VS = `#version 300 es
precision highp float;
uniform sampler2D u_wave;   // rows: left, right, spectrum
uniform float u_mode, u_scale, u_x, u_y, u_rot, u_aspect, u_time, u_pass, u_count, u_size;
uniform vec2 u_offset;
float L(float t) { return texture(u_wave, vec2(t, 0.25 / 1.5)).r; }
float R(float t) { return texture(u_wave, vec2(t, 0.75 / 1.5)).r; }
float S(float t) { return texture(u_wave, vec2(t, 1.25 / 1.5)).r; }
mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, s, -s, c); }
void main() {
    float i = float(gl_VertexID), t = i / (u_count - 1.0);
    float side = u_pass > 0.5 ? -1.0 : 1.0;
    float w = u_pass > 0.5 ? R(t) : L(t);
    vec2 p;   // in aspect space, y −0.5…0.5
    int mode = int(u_mode + 0.5);
    if (mode == 0) {            // circle, the seam faded so the loop closes
        float a = t * 6.2831853;
        float wc = mix(0.5 * (L(t) + R(t)), 0.5 * (L(0.0) + R(0.0)), smoothstep(0.85, 1.0, t));
        p = vec2(cos(a), sin(a)) * u_scale * (0.22 + 0.12 * wc);
    } else if (mode == 1) {     // oscilloscope line
        p = vec2((t - 0.5) * u_aspect * 1.1, w * 0.3 * u_scale);
    } else if (mode == 2) {     // stereo XY scope
        p = rot2(0.7854) * vec2(L(t), R(t)) * 0.55 * u_scale;
    } else if (mode == 3) {     // two lines, left above, right below
        p = vec2((t - 0.5) * u_aspect * 1.1, side * 0.15 * u_scale + w * 0.2 * u_scale);
    } else if (mode == 4) {     // spectrum, mirrored
        p = vec2((t - 0.5) * u_aspect * 1.1, side * S(t) * 0.3 * u_scale);
    } else if (mode == 5) {     // spiral
        float a = t * 18.85 + u_time * 0.6;
        p = vec2(cos(a), sin(a)) * (0.03 + t * 0.42 + w * 0.06) * u_scale;
    } else {                    // radial spectrum
        float a = t * 6.2831853;
        float sv = mix(S(t), S(0.0), smoothstep(0.9, 1.0, t));
        p = vec2(cos(a), sin(a)) * (0.16 + sv * 0.2) * u_scale;
    }
    p = rot2(u_rot) * p;
    vec2 uv = vec2(u_x, u_y) + p / vec2(u_aspect, 1.0);
    gl_Position = vec4(uv * 2.0 - 1.0 + u_offset, 0.0, 1.0);
    gl_PointSize = u_size;
}`;

const WAVE_FS = `#version 300 es
precision highp float;
uniform float u_bright;
out vec4 o;
void main() { o = vec4(vec3(u_bright), 1.0); }`;

const INK_FS = `#version 300 es
precision highp float;
out vec4 o;
uniform sampler2D u_frame;
uniform vec2 u_grid;
uniform float u_cell, u_height, u_gain, u_gamma, u_invert;
uniform vec3 u_ink, u_paper;
${DITHER_GLSL}
void main() {
    // Cells counted from the top left; a partial last cell is simply cropped.
    ivec2 cell = ivec2(floor(vec2(gl_FragCoord.x, u_height - gl_FragCoord.y) / u_cell));
    float v = texelFetch(u_frame, ivec2(cell.x, int(u_grid.y) - 1 - cell.y), 0).r;
    v = pow(clamp(v * u_gain, 0.0, 1.0), u_gamma);
    v = mix(v, 1.0 - v, u_invert);
    float ink = v > threshold(cell) ? 1.0 : 0.0;
    o = vec4(mix(u_paper, u_ink, ink), 1.0);
}`;

const hexToRgb = (hex) => {
    const n = parseInt(hex.slice(1), 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export class Pipeline {
    constructor(canvas) {
        this.canvas = canvas;
        const gl = (this.gl = createGL(canvas));
        this.blue = blueNoiseTexture(gl);
        this.waveData = new Float32Array(WAVE_POINTS * 3);
        this.waveTex = texture(gl, WAVE_POINTS, 3, { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, filter: gl.NEAREST });
        this.waveProg = program(gl, WAVE_VS, WAVE_FS);
        this.inkProg = program(gl, FULLSCREEN_VS, INK_FS);
        this.warps = new Map();
        this.frame = null;
        this.grid = [0, 0];
    }

    // Feedback programs differ only by the preset's warp snippet; compiled once each.
    // A snippet that fails to compile falls back to the plain warp.
    warpProgram(snippet = '') {
        if (!this.warps.has(snippet)) {
            let p;
            try {
                p = program(this.gl, FULLSCREEN_VS, warpFS(snippet));
            } catch (error) {
                console.warn('preset warp failed to compile', error.message);
                p = this.warpProgram('');
            }
            this.warps.set(snippet, p);
        }
        return this.warps.get(snippet);
    }

    // CSS size, device pixel ratio and cell size in CSS pixels.
    resize(cssW, cssH, dpr, cell) {
        const w = Math.max(1, Math.round(cssW * dpr)), h = Math.max(1, Math.round(cssH * dpr));
        const step = Math.max(1, cell * dpr);
        const gw = Math.max(8, Math.ceil(w / step)), gh = Math.max(8, Math.ceil(h / step));
        this.canvas.width = w;
        this.canvas.height = h;
        this.cell = step;
        if (gw !== this.grid[0] || gh !== this.grid[1]) {
            this.frame?.dispose();
            this.frame = pingPong(this.gl, gw, gh);
            this.grid = [gw, gh];
        }
    }

    uploadWaves(audio) {
        const d = this.waveData, n = WAVE_POINTS, sp = audio.spectrum;
        d.set(audio.wave[0], 0);
        d.set(audio.wave[1], n);
        for (let i = 0; i < n; i++) {
            const x = (i / (n - 1)) * (sp.length - 1), a = Math.floor(x), f = x - a;
            d[2 * n + i] = sp[a] * (1 - f) + sp[Math.min(sp.length - 1, a + 1)] * f;
        }
        const gl = this.gl;
        gl.bindTexture(gl.TEXTURE_2D, this.waveTex);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, n, 3, gl.RED, gl.FLOAT, d);
    }

    // params: blended preset parameters; snippet: warp code; look: { ink, paper, dither }.
    render(params, snippet, audio, time, look) {
        const gl = this.gl, P = params, [gw, gh] = this.grid, aspect = gw / gh;
        this.uploadWaves(audio);

        // 1. warp
        const warp = this.warpProgram(snippet).use();
        this.frame.write.bind();
        bindTexture(gl, 0, this.frame.read.tex);
        warp.int('u_prev', 0).set('u_res', gw, gh).set('u_aspect', aspect).set('u_time', time);
        for (const k of ['zoom', 'zoomexp', 'rot', 'warp', 'warpSpeed', 'warpScale', 'cx', 'cy', 'dx', 'dy', 'sx', 'sy',
            'decay', 'blur', 'wrap', 'fold', 'mirror', 'shapeSides', 'shapeRad', 'shapeThick', 'shapeBright', 'shapeFill',
            'shapeAng', 'shapeX', 'shapeY', 'border', 'borderBright']) warp.set('u_' + k, P[k]);
        warp.set('u_q', P.q1, P.q2, P.q3, P.q4);
        for (const k of AUDIO_UNIFORMS) warp.set('u_' + k, audio[k]);
        gl.drawArrays(gl.TRIANGLES, 0, 3);

        // 2. wave, drawn over: the brighter of the two wins, so nothing saturates
        if (P.waveBright > 0) {
            const wave = this.waveProg.use();
            bindTexture(gl, 0, this.waveTex);
            wave.int('u_wave', 0).set('u_mode', P.waveMode).set('u_scale', P.waveScale).set('u_x', P.waveX).set('u_y', P.waveY)
                .set('u_rot', P.waveRot).set('u_aspect', aspect).set('u_time', time).set('u_count', WAVE_POINTS)
                .set('u_bright', P.waveBright).set('u_size', Math.max(1, P.waveThick * 1.5));
            gl.enable(gl.BLEND);
            gl.blendEquation(gl.MAX);
            const passes = P.waveMode === 3 || P.waveMode === 4 ? 2 : 1;
            const thick = Math.max(1, Math.round(P.waveThick));
            for (let pass = 0; pass < passes; pass++) {
                wave.set('u_pass', pass);
                // Thick lines: the same strip drawn a cell apart.
                for (let k = 0; k < thick; k++) {
                    wave.set('u_offset', ((k % 2) * 2) / gw, (((k >> 1) % 2) * 2) / gh);
                    gl.drawArrays(P.waveDots > 0.5 ? gl.POINTS : gl.LINE_STRIP, 0, WAVE_POINTS);
                }
            }
            gl.disable(gl.BLEND);
        }

        // 3. ink
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.viewport(0, 0, this.canvas.width, this.canvas.height);
        const ink = this.inkProg.use();
        bindTexture(gl, 0, this.frame.write.tex);
        bindTexture(gl, 1, this.blue);
        ink.int('u_frame', 0).int('u_blue', 1).int('u_dither', ditherIndex(look.dither))
            .set('u_grid', gw, gh).set('u_cell', this.cell).set('u_height', this.canvas.height)
            .set('u_gain', P.gain).set('u_gamma', P.gamma).set('u_invert', P.invert)
            .set('u_ink', ...hexToRgb(look.ink)).set('u_paper', ...hexToRgb(look.paper));
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        this.frame.swap();
    }

    // Wipe the feedback, e.g. when the cell size changes the picture anyway.
    clear() {
        const gl = this.gl;
        for (const t of [this.frame.read, this.frame.write]) {
            t.bind();
            gl.clearColor(0, 0, 0, 1);
            gl.clear(gl.COLOR_BUFFER_BIT);
        }
    }
}
