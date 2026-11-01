// The play queue for one server, with no Discord or audio in it so it's easy to test.
// `current` is what's playing, `next` is what's coming, `played` is what already went by (for "previous" and queue loop).

export const LOOP_MODES = ["off", "track", "queue"];

export function createQueue({ random = Math.random } = {}) {
    let current = null, next = [], played = [], loop = "off";

    const q = {
        get current() { return current; },
        get next() { return next; },
        get played() { return played; },
        get loop() { return loop; },
        get size() { return next.length + (current ? 1 : 0); },

        /** Adds tracks to the end (or to the front of the line with `first`). Stops at `max` total; returns how many went in. */
        add(tracks, { max = 100, first = false } = {}) {
            const room = Math.max(0, max - q.size);
            const take = tracks.slice(0, room);
            if (first) next = [...take, ...next]; else next = [...next, ...take];
            return take.length;
        },

        /** Starts the queue if nothing is playing. Returns the track that should start, or null. */
        start() {
            if (current || !next.length) return null;
            current = next.shift();
            return current;
        },

        /** Moves on. `force` is a skip (it ignores "loop this track"). Returns the new current track or null when the queue ran out. */
        advance({ force = false } = {}) {
            if (!current) return null;
            if (loop === "track" && !force) return current;
            played.push(current);
            if (played.length > 50) played = played.slice(-50);
            if (next.length) { current = next.shift(); return current; }
            if (loop === "queue" && played.length) { next = played; played = []; current = next.shift(); return current; }
            current = null;
            return null;
        },

        /** Back to the previous track, if there is one. */
        previous() {
            if (!played.length) return null;
            if (current) next.unshift(current);
            current = played.pop();
            return current;
        },

        /** Jumps to the nth upcoming track (1 = the next one). */
        skipTo(n) {
            if (!Number.isInteger(n) || n < 1 || n > next.length) return null;
            const skipped = next.splice(0, n - 1);
            played.push(...(current ? [current] : []), ...skipped);
            current = next.shift();
            return current;
        },

        /** Removes the nth upcoming track. */
        remove(n) {
            if (!Number.isInteger(n) || n < 1 || n > next.length) return null;
            return next.splice(n - 1, 1)[0];
        },

        /** Moves an upcoming track from one place to another (both 1-based). */
        move(from, to) {
            if (![from, to].every(x => Number.isInteger(x) && x >= 1 && x <= next.length)) return null;
            const [t] = next.splice(from - 1, 1);
            next.splice(to - 1, 0, t);
            return t;
        },

        clear() { const n = next.length; next = []; return n; },

        /** Shuffles what's coming up (never the track that's playing). */
        shuffle() {
            for (let i = next.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [next[i], next[j]] = [next[j], next[i]]; }
            return next.length;
        },

        setLoop(mode) { if (!LOOP_MODES.includes(mode)) return false; loop = mode; return true; },

        /** Everything gone, e.g. on stop. */
        reset() { current = null; next = []; played = []; },

        totalSeconds() { return [current, ...next].reduce((t, x) => t + (x?.duration ?? 0), 0); }
    };
    return q;
}
