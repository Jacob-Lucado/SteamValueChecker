import test from "node:test";
import assert from "node:assert/strict";
import { findVideo } from "../src/video.js";
import { parseNews } from "../src/news.js";
import { parseNewsFeed, newsEmbed } from "../src/drops.js";
import { newsPayload } from "../src/render.js";

test("finds YouTube and file videos in Steam and RSS markup", () => {
    assert.equal(findVideo("[previewyoutube=abcDEF12345;full][/previewyoutube]").url, "https://www.youtube.com/watch?v=abcDEF12345");
    assert.equal(findVideo('<iframe src="https://www.youtube.com/embed/abcDEF12345?rel=0"></iframe>').thumb, "https://i.ytimg.com/vi/abcDEF12345/hqdefault.jpg");
    assert.equal(findVideo("watch https://youtu.be/abcDEF12345 now").url, "https://www.youtube.com/watch?v=abcDEF12345");
    assert.equal(findVideo("see https://cdn.example.com/clip.mp4?x=1 ok").url, "https://cdn.example.com/clip.mp4?x=1");
    assert.equal(findVideo("no video here"), null);
});

test("steam news carries the video and shows it as a player link in the message", () => {
    const [post] = parseNews({ appnews: { newsitems: [{ gid: "1", date: 1000, title: "Event", contents: "Hi [previewyoutube=abcDEF12345;full][/previewyoutube] text" }] } }, 10);
    assert.equal(post.video, "https://www.youtube.com/watch?v=abcDEF12345");
    const out = newsPayload([{ ...post, gameTitle: "Game" }]);
    assert.match(out.content, /youtube\.com\/watch\?v=abcDEF12345/);
    assert.equal(out.components[0].components.length, 2);
});

test("blog giveaway news keeps its video and a pinged role still comes through", () => {
    const xml = `<rss><channel><item><title>Giveaway event</title><link>https://example.com/p</link><description>&lt;p&gt;Claim your free key&lt;/p&gt;&lt;iframe src="https://www.youtube.com/embed/abcDEF12345"&gt;&lt;/iframe&gt;</description></item></channel></rss>`;
    const [n] = parseNewsFeed(xml, { key: "x", name: "X" });
    assert.equal(n.video, "https://www.youtube.com/watch?v=abcDEF12345");
    const m = newsEmbed(n);
    assert.equal(m.content, n.video);
    assert.equal(m.components[0].components[1].label, "▶ Watch the video");
});
