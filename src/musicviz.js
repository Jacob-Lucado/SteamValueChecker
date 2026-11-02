// Measures the sound as it goes out to Discord, so the music page can draw a live visualizer.
// It sits in the audio path: every byte is passed on untouched, the analysis only looks. If the analysis ever fails, the sound still flows.
import { Transform } from "node:stream";

export const BANDS = 24;
export const RATE = 48000;     // Hz, what the bot decodes to
export const HOP = 1024;       // samples per picture of the sound (about 21 ms)
const RING = 400;              // how many pictures to remember (about 8 seconds)
const LOW = 50, HIGH = 16000;  // the range the bars cover, in Hz

const WINDOW = Float64Array.from({ length: HOP }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (HOP - 1)));
const BITS = Math.log2(HOP);
const REVERSE = Uint16Array.from({ length: HOP }, (_, i) => { let r = 0; for (let b = 0; b < BITS; b++) if (i & (1 << b)) r |= 1 << (BITS - 1 - b); return r; });
const COS = Float64Array.from({ length: HOP / 2 }, (_, i) => Math.cos((2 * Math.PI * i) / HOP));
const SIN = Float64Array.from({ length: HOP / 2 }, (_, i) => -Math.sin((2 * Math.PI * i) / HOP));

/** Which FFT bins each bar listens to: log spaced from LOW to HIGH, always at least one bin each. */
export const BAND_BINS = (() => {
    const hz = HOP > 0 ? RATE / HOP : 1, out = [];
    let start = Math.max(1, Math.round(LOW / hz));
    for (let b = 0; b < BANDS; b++) {
        const edge = LOW * Math.pow(HIGH / LOW, (b + 1) / BANDS);
        const end = Math.max(start + 1, Math.round(edge / hz));
        out.push([start, Math.min(end, HOP / 2)]);
        start = Math.min(end, HOP / 2 - 1);
    }
    return out;
})();

/** One FFT of a Hann-windowed block. Returns BANDS values from 0 to 255. */
export function analyse(samples) {
    const re = new Float64Array(HOP), im = new Float64Array(HOP);
    for (let i = 0; i < HOP; i++) re[REVERSE[i]] = samples[i] * WINDOW[i];
    for (let size = 2; size <= HOP; size <<= 1) {
        const half = size >> 1, step = HOP / size;
        for (let i = 0; i < HOP; i += size) for (let j = 0, k = 0; j < half; j++, k += step) {
            const a = i + j, b = a + half, tr = re[b] * COS[k] - im[b] * SIN[k], ti = re[b] * SIN[k] + im[b] * COS[k];
            re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
    }
    const out = new Uint8Array(BANDS);
    for (let b = 0; b < BANDS; b++) {
        const [lo, hi] = BAND_BINS[b];
        let peak = 0;
        for (let k = lo; k < hi; k++) peak = Math.max(peak, Math.hypot(re[k], im[k]));
        const level = peak / (HOP / 4);                       // 1.0 is a full-scale tone
        const db = 20 * Math.log10(level + 1e-6) + (b / BANDS) * 14; // music has less energy up high, so lift the top a little
        out[b] = Math.max(0, Math.min(255, Math.round(((db + 66) / 60) * 255)));
    }
    return out;
}

export function createAnalyser() {
    const frames = new Array(RING);
    const block = new Float32Array(HOP);
    let fill = 0, total = 0, carry = Buffer.alloc(0);
    const t = new Transform({
        transform(chunk, _enc, cb) {
            try {
                const data = carry.length ? Buffer.concat([carry, chunk]) : chunk;
                const pairs = Math.floor(data.length / 4);          // 16-bit stereo: 4 bytes per sample
                for (let i = 0; i < pairs; i++) {
                    block[fill++] = (data.readInt16LE(i * 4) + data.readInt16LE(i * 4 + 2)) / 65536;
                    if (fill === HOP) { frames[total % RING] = analyse(block); total++; fill = 0; }
                }
                carry = data.subarray(pairs * 4);
            } catch { /* looking is optional, playing is not */ }
            cb(null, chunk);
        }
    });
    /** The pictures for the stretch from `playMs` for `spanMs`, where playMs is how long this song has been playing. */
    t.window = (playMs, spanMs) => {
        const first = Math.max(0, Math.floor((playMs * RATE) / 1000 / HOP)), last = Math.min(total, first + Math.ceil((spanMs * RATE) / 1000 / HOP));
        const out = [];
        for (let n = Math.max(first, total - RING); n < last; n++) out.push(frames[n % RING]);
        return { first: Math.max(first, total - RING), frames: out };
    };
    t.framesMade = () => total;
    return t;
}
