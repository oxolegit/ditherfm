// UI: files and the playlist, playback through the nightcore chain, the visualiser loop,
// settings remembered between visits.
import { Engine, MODES, LIMITS, modeOf, semitones, clampSetting } from './audio/engine.js';
import { createFeatures } from './audio/features.js';
import { Playlist } from './audio/playlist.js';
import { renderTrack } from './audio/wav.js';
import { Pipeline } from './viz/pipeline.js';
import { VideoRecorder, videoTypes, VIDEO_SIZES, VIDEO_FPS, defaultVideo, parseSize, videoBitrate } from './viz/record.js';
import { renderVideo as renderOffline, offlineVideo, supportedCodecs, CODECS } from './viz/offline.js';
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
    dither: $('dither'), px: $('px'), pxOut: $('pxOut'), wav: $('wav'), video: $('video'), videoSize: $('videoSize'), videoFps: $('videoFps'), videoCodec: $('videoCodec'), videoHint: $('videoHint'),
    frame: $('frame'), view: $('view'), empty: $('empty'), dropHint: $('dropHint'), fail: $('fail'), files: $('files'), moreFiles: $('moreFiles'),
    meta: $('meta'), play: $('play'), prev: $('prev'), next: $('next'), seek: $('seek'), time: $('time'), fullscreen: $('fullscreen'),
    radio: $('radio'), radioStart: $('radioStart'),
    queue: $('queue'), tracks: $('tracks'), repeat: $('repeat'), volume: $('volume'), mute: $('mute'),
};

// ─── Settings ───────────────────────────────────────────────────────────────────────
const KEY = 'ditherfm:settings';
const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : null);

const phone = matchMedia('(pointer: coarse)').matches && Math.min(screen.width, screen.height) < 768;
const { size: videoSize, fps: videoFps } = defaultVideo(phone);

const state = {
    videoSize, videoFps, videoCodec: 'avc',
    ...MODES.nightcore, palette: 'cv', ink: '#3f3a39', paper: '#edf2f4', dither: DEFAULT_DITHER, px: 3,
    preset: null, locked: false, repeat: true, volume: 0.5, muted: false, lang: detectLang(),
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
    if (s.vol >= 0 && s.vol <= 1) state.volume = +s.vol;
    state.muted = s.muted === true;
    if (parseSize(s.videoSize)) state.videoSize = s.videoSize;
    if (VIDEO_FPS.includes(s.videoFps)) state.videoFps = s.videoFps;
    if (s.videoCodec in CODECS) state.videoCodec = s.videoCodec;
}

let saveTimer = 0;
function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const { lang, volume, ...rest } = state;
        try { localStorage.setItem(KEY, JSON.stringify({ ...rest, vol: volume })); } catch {}
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
    // On the radio new files only join the queue.
    if (!hadTrack && !engine.radio) load(true);
    renderQueue();
}

function load(autoplay) {
    const item = playlist.current;
    if (!item) return stop();
    if (recording) finishVideo();
    if (engine.radio) radioOff();
    engine.load(item.file);
    if (autoplay) play();
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: item.name, artist: 'ditherfm' });
    renderQueue();
    renderTransport();
    updateMeta();
}

function play() {
    engine.play().then(() => {
        // The radio has no player events of its own.
        if (engine.radio) recording?.resume(), renderTransport();
    }, (error) => {
        if (error?.name !== 'AbortError') fail(t().playError);
    });
}

function pause() {
    engine.pause();
    if (engine.radio) recording?.pause(), renderTransport();
}

const togglePlay = () => (engine.playing ? pause() : play());

function stop() {
    engine.pause();
    engine.audio.removeAttribute('src');
    engine.audio.load();
    renderQueue();
    renderTransport();
    updateMeta();
}

function step(dir) {
    if (engine.radio) return;
    if (dir < 0 && engine.audio.currentTime > 3) return engine.seek(0);
    const wasPlaying = engine.playing;
    if (playlist.step(dir)) load(wasPlaying || dir > 0);
}

function renderTransport() {
    const radio = !!engine.radio, has = !!playlist.current || radio;
    els.play.disabled = !has;
    els.seek.disabled = els.prev.disabled = els.next.disabled = !has || radio;
    els.wav.disabled = !playlist.current || radio || exporting;
    els.radio.setAttribute('aria-pressed', String(radio));
    els.rate.disabled = radio;
    els.rate.title = radio ? t().radioSpeed : '';
    els.video.disabled = !has || !videoType || !pipeline;
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
    const radio = engine.radio;
    if (radio) {
        els.seek.value = radio.time / radio.duration;
        els.time.textContent = `${formatTime(radio.time)} / ${formatTime(radio.duration)}`;
        return;
    }
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
            if (wasCurrent && !engine.radio) load(wasPlaying);
            else renderQueue();
        });
        li.append(pick, drop);
        return li;
    }));
    els.repeat.setAttribute('aria-pressed', String(playlist.repeat));
}

const audio = engine.audio;
audio.addEventListener('play', () => {
    recording?.resume();
    renderTransport();
});
audio.addEventListener('pause', () => {
    recording?.pause();
    renderTransport();
});
audio.addEventListener('timeupdate', renderTime);
audio.addEventListener('loadedmetadata', renderTime);
audio.addEventListener('ended', () => {
    // A recording covers one track: it ends here instead of moving on.
    if (recording) return finishVideo();
    if (playlist.step(1)) load(true);
    else renderTransport();
});
audio.addEventListener('error', () => {
    if (audio.getAttribute('src')) fail(t().playError);
});

els.play.addEventListener('click', togglePlay);
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
    ms.setActionHandler('pause', pause);
    ms.setActionHandler('previoustrack', () => step(-1));
    ms.setActionHandler('nexttrack', () => step(1));
}

// ─── WAV export ─────────────────────────────────────────────────────────────────────
let exporting = false;

// "Track (nightcore).wav", or the speed for a hand-tuned mix.
function exportName(item, settings, ext) {
    if (item.radio) return `${item.name}.${ext}`;
    const mode = modeOf(settings);
    return `${item.name} (${mode && mode !== 'original' ? mode : `x${settings.rate.toFixed(2)}`}).${ext}`;
}

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
        download(blob, exportName(item, settings, 'wav'));
    } catch {
        fail(t().wavError);
    }
    exporting = false;
    els.wav.textContent = t().wav;
    renderTransport();
});

// ─── Video export ───────────────────────────────────────────────────────────────────
const types = videoTypes(), videoType = types[0] || null;
let recording = null;
// While recording, the visuals are drawn at the video's own size; the screen shows it letterboxed.
let captureSize = null;

function capture(size) {
    captureSize = size;
    els.frame.classList.toggle('recording', !!size);
    resize();
    renderTransport();
}

function buildVideoOptions() {
    const option = (value, text) => Object.assign(document.createElement('option'), { value, textContent: text });
    els.videoSize.replaceChildren(...VIDEO_SIZES.map(([w, h]) => option(`${w}x${h}`, `${w}×${h}`)));
    els.videoFps.replaceChildren(...VIDEO_FPS.map((f) => option(f, `${f} fps`)));
    els.videoSize.value = state.videoSize;
    els.videoFps.value = state.videoFps;
}
els.videoSize.addEventListener('change', () => { state.videoSize = els.videoSize.value; save(); });
els.videoFps.addEventListener('change', () => { state.videoFps = +els.videoFps.value; save(); });
els.videoCodec.addEventListener('change', () => { state.videoCodec = els.videoCodec.value; save(); });

// Frame-by-frame export needs WebCodecs; the codecs on offer are the ones this browser encodes.
let codecs = [];
let rendering = null, renderProgress = 0;
if (offlineVideo()) {
    supportedCodecs(1920, 1080, 30).then((list) => {
        codecs = list;
        els.videoCodec.replaceChildren(...list.map((id) => Object.assign(document.createElement('option'), { value: id, textContent: t().codecs[id] })));
        if (list.includes(state.videoCodec)) els.videoCodec.value = state.videoCodec;
        els.videoCodec.hidden = !list.length;
        renderVideo();
    });
}

// The current track rendered frame by frame, with the look and the sound as they are now.
async function exportOffline() {
    const item = playlist.current;
    if (!item || rendering) return;
    const [w, h] = parseSize(state.videoSize), fps = state.videoFps, settings = { ...engine.settings };
    const job = {
        file: item.file, settings, look: look(), dither: state.dither, px: state.px,
        preset: director.current?.preset || PRESETS[0], locked: director.locked,
        size: [w, h], fps, codec: codecs.includes(state.videoCodec) ? state.videoCodec : codecs[0], bitrate: videoBitrate(w, h, fps),
    };
    rendering = new AbortController();
    renderProgress = 0;
    renderVideo();
    try {
        const blob = await renderOffline(job, {
            signal: rendering.signal,
            onProgress: (p) => {
                renderProgress = p;
                renderVideo();
            },
        });
        download(blob, exportName(item, settings, 'mp4'));
    } catch (error) {
        if (error?.name !== 'AbortError') {
            console.error(error);
            fail(t().videoError);
        }
    }
    rendering = null;
    renderVideo();
}

function renderVideo() {
    const radio = engine.radio;
    const d = radio ? radio.duration : audio.duration, now = radio ? radio.time : audio.currentTime;
    // Tracks are rendered frame by frame where the browser can; the radio is always recorded live.
    const offline = !radio && codecs.length > 0;
    els.video.textContent = rendering
        ? t().videoRender.replace('{p}', Math.round(renderProgress * 100))
        : recording
            ? t().videoBusy.replace('{p}', Number.isFinite(d) && d ? Math.round((now / d) * 100) : 0)
            : t().video.replace('{ext}', (offline ? 'mp4' : videoType?.ext || 'mp4').toUpperCase());
    els.video.title = videoType || offline ? '' : t().noVideo;
    els.video.setAttribute('aria-pressed', String(!!(recording || rendering)));
    els.videoSize.disabled = els.videoFps.disabled = (!videoType && !offline) || !!recording || !!rendering;
    els.videoCodec.disabled = !offline || !!rendering;
    els.videoHint.textContent = offline ? t().videoHintOffline : t().videoHint;
}

// From the top of the current track, with the sound and the look as they are now. The radio
// cannot be rewound, so there it runs from now to the end of the song on air.
async function startVideo() {
    const radio = engine.radio;
    const item = radio ? { name: `ditherfm lo-fi FM ${radio.song.seed}`, radio: true } : playlist.current;
    if (!item || !videoType || !pipeline || recording) return;
    try {
        const sound = engine.tap();
        if (!radio) {
            engine.pause();
            engine.seek(0);
        }
        capture(parseSize(state.videoSize));
        const rec = new VideoRecorder(els.view, sound, types, state.videoFps);
        rec.item = item;
        rec.settings = { ...engine.settings };
        recording = rec;
        // An encoder that gives up mid-way is reported at once, not at the end of the track.
        rec.done.catch(() => {
            if (recording !== rec) return;
            recording = null;
            capture(null);
            renderVideo();
            fail(t().videoError);
        });
        rec.start();
        renderVideo();
        await engine.play();
    } catch {
        recording = null;
        capture(null);
        renderVideo();
        fail(t().videoError);
    }
}

async function finishVideo() {
    const rec = recording;
    if (!rec) return;
    recording = null;
    // A track stops at its end; the radio plays on.
    if (!engine.radio) engine.pause();
    const file = rec.stop();
    capture(null);
    renderVideo();
    try {
        download(await file, exportName(rec.item, rec.settings, rec.ext));
    } catch {
        fail(t().videoError);
    }
}

// ─── Radio ──────────────────────────────────────────────────────────────────────────
function radioOn() {
    if (recording) finishVideo();
    const radio = engine.radioOn();
    radio.onSong = () => {
        // A radio recording is one song long.
        if (recording) finishVideo();
        updateMeta();
        renderTime();
    };
    radio.onBeat = () => {
        renderTime();
        if (recording) renderVideo();
    };
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = new MediaMetadata({ title: t().radioTitle, artist: 'ditherfm' });
    play();
    renderQueue();
    renderTransport();
    updateMeta();
}

function radioOff() {
    if (recording) finishVideo();
    engine.radioOff();
    renderTransport();
    updateMeta();
}

function toggleRadio() {
    if (!engine.radio) return radioOn();
    radioOff();
    // Back to the queue where it was, paused.
    if (playlist.current) load(false);
}

els.radio.addEventListener('click', toggleRadio);
els.radioStart.addEventListener('click', radioOn);

els.video.addEventListener('click', () => {
    if (rendering) return rendering.abort();
    if (recording) return finishVideo();
    if (!engine.radio && codecs.length) return exportOffline();
    startVideo();
});
audio.addEventListener('timeupdate', () => recording && renderVideo());

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
    const song = engine.radio?.song;
    if (song) parts.push(t().radioTitle, `${song.chords[0].name} · ${song.bpm} BPM`);
    else if (playlist.current) parts.push(playlist.current.name);
    if (preset) parts.push(preset.seed ? `seed ${preset.seed}` : preset.name);
    els.meta.textContent = parts.join(' · ') || ' ';
}

function resize() {
    if (!pipeline) return;
    // At 1080p one "pixel" of the setting is two video pixels, as on a 2× screen.
    if (captureSize) {
        const [w, h] = captureSize, scale = Math.min(w, h) / 540;
        return pipeline.resize(w / scale, h / scale, scale, state.px);
    }
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
        ' ': () => (playlist.current || engine.radio) && togglePlay(),
        ArrowLeft: () => engine.seek(audio.currentTime - 5),
        ArrowRight: () => engine.seek(audio.currentTime + 5),
        ArrowUp: () => step(-1),
        ArrowDown: () => step(1),
        n: () => director.next(),
        r: () => director.random(),
        l: toggleLock,
        f: toggleFullscreen,
        m: toggleMute,
        q: toggleRadio,
        '-': () => setVolume(state.volume - 0.1, false),
        '=': () => setVolume(state.volume + 0.1, false),
        '+': () => setVolume(state.volume + 0.1, false),
    };
    // Same keys on a Russian layout.
    const ru = { т: 'n', к: 'r', д: 'l', а: 'f', ь: 'm', й: 'q' };
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
    renderVideo();
}
document.querySelectorAll('[data-lang]').forEach((b) => b.addEventListener('click', () => setLang(b.dataset.lang)));

// ─── Start ──────────────────────────────────────────────────────────────────────────
buildPalettes();
buildVideoOptions();
setLang(state.lang);
renderLook();
director.set(presetFromId(state.preset) || PRESETS[Math.floor(Math.random() * PRESETS.length)], { instant: true });
if (pipeline) {
    resize();
    requestAnimationFrame(frame);
}
