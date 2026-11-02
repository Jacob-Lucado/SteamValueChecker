import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";
import { createAnalyser, analyse, BANDS, BAND_BINS, HOP, RATE } from "../src/musicviz.js";

const tone = (hz, seconds, amp = 0.5) => {
    const n = Math.floor(RATE * seconds), buf = Buffer.alloc(n * 4);
    for (let i = 0; i < n; i++) { const v = Math.round(Math.sin((2 * Math.PI * hz * i) / RATE) * 32767 * amp); buf.writeInt16LE(v, i * 4); buf.writeInt16LE(v, i * 4 + 2); }
    return buf;
};
const drain = async (src, tap) => { const out = []; src.pipe(tap); for await (const c of tap) out.push(c); return Buffer.concat(out); };

test("viz: the sound passes through byte for byte, whatever the chunk sizes", async () => {
    const input = tone(440, 0.5);
    const chunks = []; for (let i = 0; i < input.length; i += 997) chunks.push(input.subarray(i, i + 997)); // odd sizes split samples in the middle
    const out = await drain(Readable.from(chunks), createAnalyser());
    assert.ok(out.equals(input));
});

test("viz: a tone lights up the bar for its pitch and silence lights nothing", async () => {
    const bar = hz => BAND_BINS.findIndex(([lo, hi]) => hz / (RATE / HOP) >= lo && hz / (RATE / HOP) < hi);
    for (const hz of [100, 1000, 8000]) {
        const block = new Float32Array(HOP); for (let i = 0; i < HOP; i++) block[i] = Math.sin((2 * Math.PI * hz * i) / RATE) * 0.5;
        const v = analyse(block), top = v.indexOf(Math.max(...v));
        assert.ok(Math.abs(top - bar(hz)) <= 1, `${hz} Hz peaks near bar ${bar(hz)}, got ${top}`);
        assert.ok(v[top] > 150);
    }
    assert.equal(Math.max(...analyse(new Float32Array(HOP))), 0);
    assert.equal(analyse(new Float32Array(HOP)).length, BANDS);
});

test("viz: pictures line up with how long the song has played", async () => {
    const tap = createAnalyser();
    await drain(Readable.from([tone(1000, 1)]), tap);
    assert.equal(tap.framesMade(), Math.floor(RATE / HOP));
    const w = tap.window(500, 200);
    assert.equal(w.first, Math.floor((500 * RATE) / 1000 / HOP));
    assert.ok(w.frames.length >= 8 && w.frames.length <= 10);
    assert.equal(tap.window(60_000, 200).frames.length, 0, "nothing yet for a time that has not been decoded");
});
