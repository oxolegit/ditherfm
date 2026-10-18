// Thin WebGL2 helpers: programs, render targets, ping-pong pairs, a fullscreen triangle.

export function createGL(canvas) {
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false, premultipliedAlpha: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 is not available');
    // Float targets keep long, faint trails from getting stuck at 8-bit steps.
    gl.floatTargets = !!gl.getExtension('EXT_color_buffer_float') || !!gl.getExtension('EXT_color_buffer_half_float');
    gl.bindVertexArray(gl.createVertexArray());
    return gl;
}

// Vertex shader for a fullscreen triangle without buffers; v_uv covers 0…1 across the target.
export const FULLSCREEN_VS = `#version 300 es
out vec2 v_uv;
void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    v_uv = p;
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

function compile(gl, type, source) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, source);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        const log = gl.getShaderInfoLog(sh);
        gl.deleteShader(sh);
        throw new Error(log);
    }
    return sh;
}

// Program with a cached uniform lookup: prog.set('u_zoom', 1.02).
export function program(gl, vs, fs) {
    const p = gl.createProgram();
    const v = compile(gl, gl.VERTEX_SHADER, vs), f = compile(gl, gl.FRAGMENT_SHADER, fs);
    gl.attachShader(p, v);
    gl.attachShader(p, f);
    gl.linkProgram(p);
    gl.deleteShader(v);
    gl.deleteShader(f);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));

    const locs = new Map();
    const loc = (name) => {
        if (!locs.has(name)) locs.set(name, gl.getUniformLocation(p, name));
        return locs.get(name);
    };
    return {
        handle: p,
        use() { gl.useProgram(p); return this; },
        set(name, ...v) {
            const l = loc(name);
            if (l === null) return this;
            if (v.length === 1 && typeof v[0] === 'number') gl.uniform1f(l, v[0]);
            else if (v.length === 2) gl.uniform2f(l, ...v);
            else if (v.length === 3) gl.uniform3f(l, ...v);
            else if (v.length === 4) gl.uniform4f(l, ...v);
            return this;
        },
        int(name, v) { const l = loc(name); if (l !== null) gl.uniform1i(l, v); return this; },
        dispose() { gl.deleteProgram(p); },
    };
}

export function texture(gl, w, h, { internal, format, type, filter = gl.LINEAR, wrap = gl.CLAMP_TO_EDGE, data = null }) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, type, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    return tex;
}

// A colour target to render into and sample from.
export function target(gl, w, h) {
    const float = gl.floatTargets;
    const tex = texture(gl, w, h, float
        ? { internal: gl.RGBA16F, format: gl.RGBA, type: gl.HALF_FLOAT }
        : { internal: gl.RGBA8, format: gl.RGBA, type: gl.UNSIGNED_BYTE });
    const fbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return {
        tex, fbo, w, h,
        bind() { gl.bindFramebuffer(gl.FRAMEBUFFER, fbo); gl.viewport(0, 0, w, h); },
        dispose() { gl.deleteTexture(tex); gl.deleteFramebuffer(fbo); },
    };
}

// Two targets: read last frame from one, write this frame into the other, then swap.
export function pingPong(gl, w, h) {
    const pair = {
        read: target(gl, w, h),
        write: target(gl, w, h),
        w, h,
        swap() { [pair.read, pair.write] = [pair.write, pair.read]; },
        dispose() { pair.read.dispose(); pair.write.dispose(); },
    };
    return pair;
}

export function bindTexture(gl, unit, tex) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
}
