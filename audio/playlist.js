// The queue of tracks: plain logic, no DOM, so it can be tested without a browser.

const AUDIO_EXT = /\.(mp3|m4a|aac|wav|flac|ogg|oga|opus|webm)$/i;

export const isAudioFile = (file) => (file.type || '').startsWith('audio/') || AUDIO_EXT.test(file.name || '');

// "02 - Artist - Song.mp3" → "02 - Artist - Song"
export const trackName = (name) => String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '').trim() || '—';

let nextId = 1;

export class Playlist {
    constructor() {
        this.items = [];   // { id, file, name }
        this.index = -1;
        this.repeat = true;
    }

    get current() {
        return this.items[this.index] || null;
    }

    // Adds the audio files among `files`; returns how many were added.
    add(files) {
        const added = [...files].filter(isAudioFile).map((file) => ({ id: nextId++, file, name: trackName(file.name) }));
        this.items.push(...added);
        if (this.index < 0 && added.length) this.index = this.items.length - added.length;
        return added.length;
    }

    select(i) {
        if (i < 0 || i >= this.items.length) return null;
        this.index = i;
        return this.current;
    }

    // step: +1 next, −1 previous. Wraps around when repeat is on; otherwise stops at the ends.
    step(step) {
        if (!this.items.length) return null;
        let i = this.index + step;
        if (i < 0 || i >= this.items.length) {
            if (!this.repeat) return null;
            i = (i + this.items.length) % this.items.length;
        }
        return this.select(i);
    }

    remove(i) {
        if (i < 0 || i >= this.items.length) return;
        this.items.splice(i, 1);
        if (i < this.index) this.index--;
        else if (i === this.index) this.index = Math.min(this.index, this.items.length - 1);
    }

    move(from, to) {
        if (from === to || from < 0 || to < 0 || from >= this.items.length || to >= this.items.length) return;
        const cur = this.current;
        const [item] = this.items.splice(from, 1);
        this.items.splice(to, 0, item);
        this.index = this.items.indexOf(cur);
    }
}
