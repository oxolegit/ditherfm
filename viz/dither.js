// Ordered dithering in the shader: a threshold per output cell, compared with the ink density.
// Error diffusion is inherently sequential, so the visualiser uses thresholds only; they are
// also stable from frame to frame, which keeps motion from shimmering.
import { blueNoise } from '../gen/bluenoise.js';
import { texture } from './gl.js';

// Order matters: the index is passed to the shader.
export const DITHERS = ['bayer4', 'bayer8', 'bayer2', 'blue', 'ign', 'dots', 'lines', 'threshold'];
export const DEFAULT_DITHER = 'bayer4';

export const ditherIndex = (id) => Math.max(0, DITHERS.indexOf(id));

export const DITHER_GLSL = `
uniform int u_dither;
uniform sampler2D u_blue;

// Recursive Bayer matrix of size 2^n, the same layout as the bitmap generator's.
float bayer(ivec2 p, int n) {
    int v = 0;
    for (int i = 0; i < 3; i++) {
        if (i >= n) break;
        int xb = (p.x >> i) & 1, yb = (p.y >> i) & 1;
        v += (2 * (xb ^ yb) + yb) << (2 * (n - 1 - i));
    }
    return (float(v) + 0.5) / float(1 << (2 * n));
}

float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
}

// Halftone: dots on a 45° screen; the threshold grows from the dot centre so area tracks tone.
float dots(vec2 p) {
    const float P = 6.0;
    vec2 r = mat2(0.7071, -0.7071, 0.7071, 0.7071) * p / P;
    vec2 f = fract(r) - 0.5;
    return clamp(length(f) * length(f) * 3.1416, 0.0, 1.0);
}

float lines(vec2 p) {
    const float P = 5.0;
    return abs(fract((p.x + p.y) * 0.7071 / P) * 2.0 - 1.0);
}

float threshold(ivec2 cell) {
    vec2 p = vec2(cell);
    if (u_dither == 0) return bayer(cell, 2);
    if (u_dither == 1) return bayer(cell, 3);
    if (u_dither == 2) return bayer(cell, 1);
    if (u_dither == 3) return texelFetch(u_blue, cell & 63, 0).r;
    if (u_dither == 4) return ign(p);
    if (u_dither == 5) return dots(p);
    if (u_dither == 6) return lines(p);
    return 0.5;
}
`;

// The 64×64 blue noise map as a single-channel texture, sampled with texelFetch.
export function blueNoiseTexture(gl) {
    const { map, size } = blueNoise(64);
    return texture(gl, size, size, { internal: gl.R32F, format: gl.RED, type: gl.FLOAT, filter: gl.NEAREST, wrap: gl.REPEAT, data: map });
}
