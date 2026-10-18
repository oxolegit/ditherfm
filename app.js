// UI: files and the playlist, playback through the nightcore chain, the visualiser loop,
// settings remembered between visits.
import { Engine, MODES, LIMITS, modeOf, semitones, clampSetting } from './audio/engine.js';
import { createFeatures } from './audio/features.js';
import { Playlist } from './audio/playlist.js';
import { renderTrack } from './audio/wav.js';
import { Pipeline } from './viz/pipeline.js';
import { Director } from './viz/director.js';
import { PRESETS, presetById } from './viz/presets.js';
import { makePreset } from './viz/random.js';
import { DITHERS, DEFAULT_DITHER } from './viz/dither.js';
import { isSeed } from './gen/rng.js';
import { STRINGS, detectLang, applyStrings, formatTime } from './i18n.js';

// The same pairs as bitmap.
const PALETTES = {
    cv: { ink: '#3F3A39', paper: '#EDF2F4' },
    cvInverse: { ink: '#EDF2F4', paper: '#3F3A39' },
    graphite: { ink: '#1D1D1F', paper: '#F3F0E8' },
    blueprint: { ink: '#EAF0FF', paper: '#1F3C88' },
    sepia: { ink: '#5A3A26', paper: '#F2E6D0' },
    riso: { ink: '#E8432E', paper: '#F6F1E7' },
    moss: { ink: '#2E3A26', paper: '#DDE3C9' },
    night: { ink: '#A9B8FF', paper: '#0F1222' },
};

const $ = (id) => document.getElementById(id);
const els = {
    modes: $('modes'), rate: $('rate'), rateOut: $('rateOut'), bass: $('bass'), bassOut: $('bassOut'), reverb: $('reverb'), reverbOut: $('reverbOut'),
    preset: $('preset'), nextPreset: $('nextPreset'), randomPreset: $('randomPreset'), lock: $('lock'),
    palettes: $('palettes'), customColors: $('customColors'), inkColor: $('inkColor'), paperColor: $('paperColor'),
    dither: $('dither'), px: $('px'), pxOut: $('pxOut'), wav: $('wav'),
    frame: $('frame'), view: $('view'), empty: $('empty'), dropHint: $('dropHint'), fail: $('fail'), files: $('files'), moreFiles: $('moreFiles'),
    meta: $('meta'), play: $('play'), prev: $('prev'), next: $('next'), seek: $('seek'), time: $('time'), fullscreen: $('fullscreen'),
    queue: $('queue'), tracks: $('tracks'), repeat: $('repeat'), volume: $('volume'), mute: $('mute'),
};

// ─── Settings ───────────────────────────────────────────────────────────────────────
const KEY = 'ditherfm:settings';
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : null);

const state = {
    ...MODES.nightcore, palette: 'cv', ink: '#3f3a39', paper: '#edf2f4', dither: DEFAULT_DITHER, px: 3,
    preset: null, locked: false, repeat: true, volume: 1, muted: false, lang: detectLang(),
};

function loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem(KEY)) || {}; } catch {}
    for (const k of ['rate', 'bass', 'reverb']) if (k in s) state[k] = clampSetting(k, s[k]);
    if (s.palette in PALETTES || s.palette === 'custom') state.palette = s.palette;
    if (hex(s.ink)) state.ink = hex(s.ink);
    if (hex(s.paper)) state.paper = hex(s.paper);
    if (DITHERS.includes(s.dither)) state.dither = s.dither;
    if (s.px >= 1 && s.px <= 8) state.px = Math.round(s.px);
    if (typeof s.preset === 'string') state.preset = s.preset;
    state.locked = s.locked === true;
    state.repeat = s.repeat !== false;
    if (s.volume >= 0 && s.volume <= 1) state.volume = +s.volume;
    state.muted = s.muted === true;
}

let saveTimer = 0;
function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const { lang, ...rest } = state;
        try { localStorage.setItem(KEY, JSON.stringify(rest)); } catch {}
    }, 300);
}

const t = () => STRINGS[state.lang];
const look = () => (state.palette === 'custom' ? { ink: state.ink, paper: state.paper } : PALETTES[state.palette]);

loadSettings();

// ─── Audio ──────────────────────────────────────────────────────────────────────────
const engine = new Engine();
engine.set(state);
engine.setVolume(state.volume, state.muted);
const playlist = new Playlist();
playlist.repeat = state.repeat;
const features = createFeatures();

function renderSound() {
    const mode = modeOf(state);
    els.modes.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    els.rate.value = state.rate;
    els.bass.value = state.bass;
    els.reverb.value = state.reverb;
    const st = semitones(state.rate);
    els.rateOut.textContent = `×${state.rate.toFixed(2)} · ${st >= 0 ? '+' : '−'}${Math.abs(st).toFixed(1)} ${t().st}`;
    els.bassOut.textContent = `+${state.bass} ${t().db}`;
    els.reverbOut.textContent = `${Math.round(state.reverb * 100)}%`;
}

function setSound(values) {
    Object.assign(state, values);
    engine.set(state);
    renderSound();
    save();
}

els.modes.addEventListener('click', (e) => {
    const id = e.target.closest('[data-mode]')?.dataset.mode;
    if (id) setSound(MODES[id]);
});
for (const k of Object.keys(LIMITS)) els[k].addEventListener('input', () => setSound({ [k]: +els[k].value }));

// ─── Playlist and transport ─────────────────────────────────────────────────────────
let failTimer = 0;
function fail(message) {
    els.fail.textContent = message;
    els.fail.hidden = false;
    clearTimeout(failTimer);
    failTimer = setTimeout(() => (els.fail.hidden = true), 3500);
}

function addFiles(files) {
    const hadTrack = !!playlist.current;
    if (!playlist.add(files)) return fail(t().notAudio);
    if (!hadTrack) load(true);
    renderQueue();
}

function load(autoplay) {
    const item = playlist.current;
    if (!item) return stop();
    engine.load(item.file);
    if (autoplay) play();
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: item.name, artist: 'ditherfm' });
    renderQueue();
    renderTransport();
    updateMeta();
}

function play() {
    engine.play().catch((error) => {
        if (error?.name !== 'AbortError') fail(t().playError);
    });
}

function stop() {
    engine.pause();
    engine.audio.removeAttribute('src');
    engine.audio.load();
    renderQueue();
    renderTransport();
    updateMeta();
}

function step(dir) {
    if (dir < 0 && engine.audio.currentTime > 3) return engine.seek(0);
    const wasPlaying = engine.playing;
    if (playlist.step(dir)) load(wasPlaying || dir > 0);
}

function renderTransport() {
    const has = !!playlist.current;
    els.play.disabled = els.seek.disabled = els.prev.disabled = els.next.disabled = !has;
    els.wav.disabled = !has || exporting;
    els.play.firstElementChild.textContent = engine.playing ? t().pause : t().play;
    els.play.firstElementChild.dataset.i18n = engine.playing ? 'pause' : 'play';
    els.empty.hidden = has;
    renderTime();
}

function setVolume(v, muted) {
    state.volume = Math.max(0, Math.min(1, Math.round(v * 100) / 100));
    state.muted = muted;
    engine.setVolume(state.volume, state.muted);
    renderVolume();
    save();
}

function renderVolume() {
    els.volume.value = state.muted ? 0 : state.volume;
    els.mute.setAttribute('aria-pressed', String(state.muted || state.volume === 0));
    els.mute.textContent = state.muted || state.volume === 0 ? t().muted : t().mute;
    els.volume.title = `${t().volume}: ${state.muted ? 0 : Math.round(state.volume * 100)}%`;
}

// Moving the slider always unmutes; unmuting from zero comes back at half volume.
function toggleMute() {
    const silent = state.muted || state.volume === 0;
    setVolume(silent ? state.volume || 0.5 : state.volume, !silent);
}

els.volume.addEventListener('input', () => setVolume(+els.volume.value, false));
els.mute.addEventListener('click', toggleMute);

let seeking = false;
function renderTime() {
    const a = engine.audio, d = Number.isFinite(a.duration) ? a.duration : 0;
    if (!seeking) els.seek.value = d ? a.currentTime / d : 0;
    // Shown in track time: with nightcore the clock runs faster, as the music does.
    els.time.textContent = `${formatTime(a.currentTime)} / ${formatTime(d)}`;
}

function renderQueue() {
    els.queue.hidden = !playlist.items.length;
    els.tracks.replaceChildren(...playlist.items.map((item, i) => {
        const li = document.createElement('li');
        if (i === playlist.index) li.setAttribute('aria-current', 'true');
        const pick = document.createElement('button');
        pick.type = 'button';
        pick.className = 'pick';
        const n = document.createElement('span');
        n.className = 'n';
        n.textContent = String(i + 1).padStart(2, '0');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = item.name;
        pick.append(n, name);
        pick.addEventListener('click', () => {
            playlist.select(i);
            load(true);
        });
        const drop = document.createElement('button');
        drop.type = 'button';
        drop.className = 'drop';
        drop.textContent = '×';
        drop.setAttribute('aria-label', `${t().remove}: ${item.name}`);
        drop.addEventListener('click', () => {
            const wasCurrent = i === playlist.index, wasPlaying = engine.playing;
            playlist.remove(i);
            if (wasCurrent) load(wasPlaying);
            else renderQueue();
        });
        li.append(pick, drop);
        return li;
    }));
    els.repeat.setAttribute('aria-pressed', String(playlist.repeat));
}

const audio = engine.audio;
audio.addEventListener('play', renderTransport);
audio.addEventListener('pause', renderTransport);
audio.addEventListener('timeupdate', renderTime);
audio.addEventListener('loadedmetadata', renderTime);
audio.addEventListener('ended', () => {
    if (playlist.step(1)) load(true);
    else renderTransport();
});
audio.addEventListener('error', () => {
    if (audio.getAttribute('src')) fail(t().playError);
});

els.play.addEventListener('click', () => (engine.playing ? engine.pause() : play()));
els.prev.addEventListener('click', () => step(-1));
els.next.addEventListener('click', () => step(1));
els.seek.addEventListener('input', () => {
    seeking = true;
    const d = audio.duration;
    if (Number.isFinite(d)) els.time.textContent = `${formatTime(+els.seek.value * d)} / ${formatTime(d)}`;
});
els.seek.addEventListener('change', () => {
    seeking = false;
    engine.seek(+els.seek.value * audio.duration);
});
els.repeat.addEventListener('click', () => {
    playlist.repeat = state.repeat = !playlist.repeat;
    renderQueue();
    save();
});

for (const input of [els.files, els.moreFiles]) {
    input.addEventListener('change', () => {
        addFiles(input.files);
        input.value = '';
    });
}

// Files dropped anywhere on the page.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
const setDragging = (on) => {
    els.frame.classList.toggle('dragging', on);
    els.dropHint.hidden = !on;
};
window.addEventListener('dragenter', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth++;
    setDragging(true);
});
window.addEventListener('dragover', (e) => {
    if (hasFiles(e)) e.preventDefault();
});
window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) dragDepth = 0, setDragging(false);
});
window.addEventListener('drop', (e) => {
    if (!hasFiles(e)) return;
    e.preventDefault();
    dragDepth = 0;
    setDragging(false);
    addFiles(e.dataTransfer.files);
});

if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    ms.setActionHandler('play', play);
    ms.setActionHandler('pause', () => engine.pause());
    ms.setActionHandler('previoustrack', () => step(-1));
    ms.setActionHandler('nexttrack', () => step(1));
}

// ─── WAV export ─────────────────────────────────────────────────────────────────────
let exporting = false;

function download(blob, name) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

els.wav.addEventListener('click', async () => {
    const item = playlist.current;
    if (!item || exporting) return;
    exporting = true;
    els.wav.disabled = true;
    const settings = { ...engine.settings };
    const label = (p) => (els.wav.textContent = t().wavBusy.replace('{p}', Math.round(p * 100)));
    label(0);
    try {
        const blob = await renderTrack(item.file, settings, label);
        const mode = modeOf(settings);
        download(blob, `${item.name} (${mode && mode !== 'original' ? mode : `x${settings.rate.toFixed(2)}`}).wav`);
    } catch {
        fail(t().wavError);
    }
    exporting = false;
    els.wav.textContent = t().wav;
    renderTransport();
});

// ─── Visuals ────────────────────────────────────────────────────────────────────────
let pipeline = null;
try {
    pipeline = new Pipeline(els.view);
} catch {
    els.fail.textContent = t().noWebgl;
    els.fail.hidden = false;
}

const director = new Director();
director.locked = state.locked;
director.onChange = (preset) => {
    state.preset = preset.id;
    renderPresets();
    updateMeta();
    save();
};

function presetFromId(id) {
    if (!id) return null;
    if (id.startsWith('seed:') && isSeed(id.slice(5))) return makePreset(id.slice(5));
    return presetById(id);
}

function renderPresets() {
    const current = director.current?.preset;
    const options = PRESETS.map((p) => [p.id, p.name]);
    if (current?.seed) options.push([current.id, `seed ${current.seed}`]);
    els.preset.replaceChildren(...options.map(([id, name]) => {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = name;
        return o;
    }));
    if (current) els.preset.value = current.id;
    els.lock.setAttribute('aria-pressed', String(director.locked));
}

els.preset.addEventListener('change', () => {
    const p = presetFromId(els.preset.value);
    if (p) director.set(p);
});
els.nextPreset.addEventListener('click', () => director.next());
els.randomPreset.addEventListener('click', () => director.random());
function toggleLock() {
    director.locked = state.locked = !director.locked;
    renderPresets();
    save();
}
els.lock.addEventListener('click', toggleLock);

function buildPalettes() {
    const items = [...Object.entries(PALETTES), ['custom', { ink: state.ink, paper: state.paper }]];
    els.palettes.replaceChildren(...items.map(([id, p]) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch' + (id === 'custom' ? ' custom' : '');
        b.setAttribute('role', 'radio');
        b.dataset.palette = id;
        b.dataset.paletteLabel = id;
        b.style.setProperty('--ink', p.ink);
        b.style.setProperty('--paper', p.paper);
        b.addEventListener('click', () => {
            state.palette = id;
            renderLook();
            save();
        });
        return b;
    }));
}

function buildDithers() {
    els.dither.replaceChildren(...DITHERS.map((id) => {
        const o = document.createElement('option');
        o.value = id;
        o.textContent = t().dithers[id];
        return o;
    }));
    els.dither.value = state.dither;
}

function renderLook() {
    els.palettes.querySelectorAll('[data-palette]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.palette === state.palette)));
    els.customColors.hidden = state.palette !== 'custom';
    els.inkColor.value = state.ink;
    els.paperColor.value = state.paper;
    els.palettes.querySelector('.custom')?.style.setProperty('--ink', state.ink);
    els.palettes.querySelector('.custom')?.style.setProperty('--paper', state.paper);
    els.dither.value = state.dither;
    els.px.value = state.px;
    els.pxOut.textContent = `${state.px} px`;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', look().paper);
}

els.inkColor.addEventListener('input', () => { state.ink = els.inkColor.value; renderLook(); save(); });
els.paperColor.addEventListener('input', () => { state.paper = els.paperColor.value; renderLook(); save(); });
els.dither.addEventListener('change', () => { state.dither = els.dither.value; save(); });
els.px.addEventListener('input', () => {
    state.px = +els.px.value;
    renderLook();
    resize();
    save();
});

function updateMeta() {
    const preset = director.current?.preset;
    const parts = [];
    if (playlist.current) parts.push(playlist.current.name);
    if (preset) parts.push(preset.seed ? `seed ${preset.seed}` : preset.name);
    els.meta.textContent = parts.join(' · ') || ' ';
}

function resize() {
    if (!pipeline) return;
    const r = els.view.getBoundingClientRect();
    pipeline.resize(r.width, r.height, Math.min(window.devicePixelRatio || 1, 2), state.px);
}
new ResizeObserver(resize).observe(els.frame);

// Analyser buffers, reused every frame.
const FFT = 2048;
const freq = [new Float32Array(FFT / 2), new Float32Array(FFT / 2)];
const waves = [new Float32Array(FFT), new Float32Array(FFT)];
const mag = new Float32Array(FFT / 2);

let last = performance.now(), clock = 0;
function frame(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    let a;
    if (engine.ctx && engine.playing) {
        engine.analysers.forEach((an, c) => {
            an.getFloatFrequencyData(freq[c]);
            an.getFloatTimeDomainData(waves[c]);
        });
        for (let i = 0; i < mag.length; i++) mag[i] = 0.5 * (10 ** (freq[0][i] / 20) + 10 ** (freq[1][i] / 20));
        a = features.update(mag, engine.ctx.sampleRate / FFT, waves, dt);
    } else a = features.idle(dt);
    const { params, snippet } = director.update(dt, a, clock);
    pipeline.render(params, snippet, a, clock, { ...look(), dither: state.dither });
    requestAnimationFrame(frame);
}

// ─── Full screen ────────────────────────────────────────────────────────────────────
function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else els.frame.requestFullscreen?.().catch(() => {});
}
els.fullscreen.addEventListener('click', toggleFullscreen);
els.frame.addEventListener('dblclick', toggleFullscreen);

let idleTimer = 0;
els.frame.addEventListener('mousemove', () => {
    els.frame.classList.remove('idle');
    clearTimeout(idleTimer);
    if (document.fullscreenElement) idleTimer = setTimeout(() => els.frame.classList.add('idle'), 2000);
});

// ─── Keyboard ───────────────────────────────────────────────────────────────────────
document.addEventListener('keydown', (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.target.closest?.('input, select, textarea')) return;
    const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const actions = {
        ' ': () => playlist.current && (engine.playing ? engine.pause() : play()),
        ArrowLeft: () => engine.seek(audio.currentTime - 5),
        ArrowRight: () => engine.seek(audio.currentTime + 5),
        ArrowUp: () => step(-1),
        ArrowDown: () => step(1),
        n: () => director.next(),
        r: () => director.random(),
        l: toggleLock,
        f: toggleFullscreen,
        m: toggleMute,
        '-': () => setVolume(state.volume - 0.1, false),
        '=': () => setVolume(state.volume + 0.1, false),
        '+': () => setVolume(state.volume + 0.1, false),
    };
    // Same keys on a Russian layout.
    const ru = { т: 'n', к: 'r', д: 'l', а: 'f', ь: 'm' };
    const action = actions[key] || actions[ru[key]];
    if (!action) return;
    e.preventDefault();
    action();
});

// ─── Language ───────────────────────────────────────────────────────────────────────
function setLang(lang) {
    state.lang = lang;
    document.querySelectorAll('[data-lang]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.lang === lang)));
    applyStrings(lang);
    buildDithers();
    renderSound();
    renderVolume();
    renderQueue();
    renderTransport();
    if (!exporting) els.wav.textContent = t().wav;
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

// ─── Start ──────────────────────────────────────────────────────────────────────────
buildPalettes();
setLang(state.lang);
renderLook();
director.set(presetFromId(state.preset) || PRESETS[Math.floor(Math.random() * PRESETS.length)], { instant: true });
if (pipeline) {
    resize();
    requestAnimationFrame(frame);
}
