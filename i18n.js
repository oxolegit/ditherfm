// Interface strings, Russian and English. Elements carry data-i18n="key" for their text and
// data-i18n-attr="attr:key;attr:key" for attributes.

export const STRINGS = {
    ru: {
        title: 'ditherfm — музыкальный визуализатор в две краски',
        description: 'Визуализатор музыки в духе MilkDrop, нарисованный дизерингом в две краски. Загрузите mp3, включите найткор и смотрите.',
        tagline: 'Визуализатор музыки в две краски',
        language: 'Язык',
        settings: 'Настройки',
        sound: 'Звук',
        modes: { original: 'Оригинал', nightcore: 'Nightcore', hyper: 'Hyper', daycore: 'Daycore' },
        speed: 'Скорость',
        bass: 'Бас',
        reverb: 'Реверб',
        st: 'пт',
        db: 'дБ',
        preset: 'Пресет',
        nextPreset: 'Дальше',
        randomPreset: 'Случайный',
        lock: 'Замок',
        lockHint: 'Не менять пресет сам',
        palette: 'Палитра',
        ink: 'Чернила',
        paper: 'Бумага',
        dither: 'Дизеринг',
        dithers: {
            bayer4: 'Bayer 4×4', bayer8: 'Bayer 8×8', bayer2: 'Bayer 2×2', blue: 'Blue noise', ign: 'IGN',
            dots: 'Растр точками', lines: 'Растр линиями', threshold: 'Порог',
        },
        pixel: 'Пиксель',
        export: 'Экспорт',
        wav: 'Скачать WAV',
        wavHint: 'Текущий трек с настройками звука',
        wavBusy: 'Рендер {p}%',
        wavError: 'Не получилось сохранить трек',
        video: 'Записать {ext}',
        videoHint: 'Трек с начала до конца, в реальном времени — не сворачивайте вкладку',
        videoBusy: 'Стоп · {p}%',
        videoError: 'Не получилось записать видео',
        noVideo: 'Браузер не умеет записывать видео',
        videoSize: 'Разрешение',
        videoFps: 'Кадров в секунду',
        videoCodec: 'Кодек',
        codecHint: 'H.264 играет везде; HEVC и AV1 при том же качестве дают файл меньше',
        codecs: { avc: 'H.264', hevc: 'HEVC', av1: 'AV1' },
        videoRender: 'Рендер {p}% · стоп',
        videoHintOffline: 'Трек целиком, кадр за кадром — ровный fps на любом компьютере. Радио пишется вживую',
        radio: 'FM',
        radioStart: 'Или включить lo-fi FM',
        radioHint: 'Общее lo-fi радио: у всех играет одно и то же',
        radioSpeed: 'Эфир общий, поэтому скорость на радио всегда ×1',
        radioTitle: 'lo-fi FM',
        play: 'Играть',
        pause: 'Пауза',
        prev: 'Назад',
        next: 'Вперёд',
        seek: 'Позиция',
        volume: 'Громкость',
        mute: 'Звук',
        muted: 'Без звука',
        fullscreen: 'Во весь экран',
        playlist: 'Плейлист',
        add: 'Добавить',
        repeat: 'Повтор',
        remove: 'Убрать',
        emptyTitle: 'Перетащите сюда музыку',
        emptyText: 'mp3, flac, wav, ogg, m4a — файлы не покидают ваш компьютер',
        choose: 'Выбрать файлы',
        dropHere: 'Отпустите, чтобы добавить',
        notAudio: 'Здесь нет аудиофайлов',
        playError: 'Не удалось воспроизвести файл',
        visual: 'Визуализация',
        noWebgl: 'Браузеру нужен WebGL2, чтобы рисовать визуализацию',
        shortcuts: 'Пробел — пауза · ← → — перемотка · ↑ ↓ — трек · − + — громкость · M — без звука · Q — радио · N — пресет · R — случайный · L — замок · F — экран',
        license: 'Лицензия MIT with Attribution',
        palettes: { cv: 'Резюме', cvInverse: 'Резюме, инверсия', graphite: 'Графит', blueprint: 'Синька', sepia: 'Сепия', riso: 'Ризограф', moss: 'Мох', night: 'Ночь', custom: 'Свои цвета' },
    },
    en: {
        title: 'ditherfm — a music visualiser in two colours',
        description: 'A MilkDrop-style music visualiser drawn with two-colour dithering. Drop in an mp3, switch on nightcore and watch.',
        tagline: 'Music visualiser in two colours',
        language: 'Language',
        settings: 'Settings',
        sound: 'Sound',
        modes: { original: 'Original', nightcore: 'Nightcore', hyper: 'Hyper', daycore: 'Daycore' },
        speed: 'Speed',
        bass: 'Bass',
        reverb: 'Reverb',
        st: 'st',
        db: 'dB',
        preset: 'Preset',
        nextPreset: 'Next',
        randomPreset: 'Random',
        lock: 'Lock',
        lockHint: 'Keep this preset',
        palette: 'Palette',
        ink: 'Ink',
        paper: 'Paper',
        dither: 'Dithering',
        dithers: {
            bayer4: 'Bayer 4×4', bayer8: 'Bayer 8×8', bayer2: 'Bayer 2×2', blue: 'Blue noise', ign: 'IGN',
            dots: 'Dot screen', lines: 'Line screen', threshold: 'Threshold',
        },
        pixel: 'Pixel',
        export: 'Export',
        wav: 'Download WAV',
        wavHint: 'The current track with the sound settings',
        wavBusy: 'Rendering {p}%',
        wavError: 'Could not save the track',
        video: 'Record {ext}',
        videoHint: 'The track start to finish, in real time — keep this tab open',
        videoBusy: 'Stop · {p}%',
        videoError: 'Could not record the video',
        noVideo: 'This browser cannot record video',
        videoSize: 'Resolution',
        videoFps: 'Frames per second',
        videoCodec: 'Codec',
        codecHint: 'H.264 plays everywhere; HEVC and AV1 give a smaller file at the same quality',
        codecs: { avc: 'H.264', hevc: 'HEVC', av1: 'AV1' },
        videoRender: 'Rendering {p}% · stop',
        videoHintOffline: 'The whole track, frame by frame — a steady frame rate on any machine. The radio is recorded live',
        radio: 'FM',
        radioStart: 'Or tune in to lo-fi FM',
        radioHint: 'Shared lo-fi radio: everyone hears the same thing',
        radioSpeed: 'The air is shared, so the radio always plays at ×1',
        radioTitle: 'lo-fi FM',
        play: 'Play',
        pause: 'Pause',
        prev: 'Previous',
        next: 'Next',
        seek: 'Position',
        volume: 'Volume',
        mute: 'Sound',
        muted: 'Muted',
        fullscreen: 'Full screen',
        playlist: 'Playlist',
        add: 'Add',
        repeat: 'Repeat',
        remove: 'Remove',
        emptyTitle: 'Drop music here',
        emptyText: 'mp3, flac, wav, ogg, m4a — files never leave your computer',
        choose: 'Choose files',
        dropHere: 'Release to add',
        notAudio: 'No audio files here',
        playError: 'Could not play this file',
        visual: 'Visuals',
        noWebgl: 'Your browser needs WebGL2 to draw the visuals',
        shortcuts: 'Space — pause · ← → — seek · ↑ ↓ — track · − + — volume · M — mute · Q — radio · N — preset · R — random · L — lock · F — full screen',
        license: 'MIT with Attribution licence',
        palettes: { cv: 'Résumé', cvInverse: 'Résumé, inverted', graphite: 'Graphite', blueprint: 'Blueprint', sepia: 'Sepia', riso: 'Riso', moss: 'Moss', night: 'Night', custom: 'Custom colours' },
    },
};

export function detectLang() {
    try {
        const saved = localStorage.getItem('ditherfm:lang');
        if (saved === 'ru' || saved === 'en') return saved;
    } catch {}
    return (navigator.language || '').toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export function applyStrings(lang, root = document) {
    const t = STRINGS[lang];
    document.documentElement.lang = lang;
    document.title = t.title;
    document.querySelector('meta[name="description"]')?.setAttribute('content', t.description);
    root.querySelectorAll('[data-i18n]').forEach((el) => {
        const v = t[el.dataset.i18n];
        if (typeof v === 'string') el.textContent = v;
    });
    root.querySelectorAll('[data-i18n-attr]').forEach((el) => {
        for (const pair of el.dataset.i18nAttr.split(';')) {
            const [attr, key] = pair.split(':');
            if (t[key]) el.setAttribute(attr, t[key]);
        }
    });
    root.querySelectorAll('[data-mode]').forEach((el) => {
        el.textContent = t.modes[el.dataset.mode];
    });
    root.querySelectorAll('[data-palette-label]').forEach((el) => {
        const v = t.palettes[el.dataset.paletteLabel];
        if (v) el.setAttribute('aria-label', v), el.setAttribute('title', v);
    });
    try { localStorage.setItem('ditherfm:lang', lang); } catch {}
}

// 1:05, or 1:02:05 for long mixes.
export function formatTime(s) {
    if (!Number.isFinite(s) || s < 0) s = 0;
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
