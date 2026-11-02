// Live radio stations the bot suggests with /music live and on the dashboard. The list is checked when it's asked for,
// so a station that has gone off the air simply doesn't show up.
export const CATEGORIES = [["hiphop", "Hip hop"], ["rnb", "R&B & soul"], ["dance", "Dance & electronic"], ["chill", "Chill & ambient"], ["rock", "Rock & indie"], ["throwback", "Throwbacks"], ["world", "Reggae & world"]];
const ST = (cat, name, genre, url) => ({ cat, name, genre, url });
const TW = m => `https://playerservices.streamtheworld.com/api/livestream-redirect/${m}.aac`;
export const STATIONS = [
    // Hip hop
    ST("hiphop", "Hot 97 New York", "Hip hop", TW("WQHTFMAAC")),
    ST("hiphop", "97.9 The Box Houston", "Hip hop", TW("KBXXFMAAC")),
    ST("hiphop", "97.9 The Beat Dallas", "Hip hop", TW("KBFBFMAAC")),
    ST("hiphop", "Hot 107.9 Atlanta", "Hip hop", TW("WHTAFMAAC")),
    ST("hiphop", "Power 92 Richmond", "Hip hop", TW("WCDXFMAAC")),
    ST("hiphop", "Hot 103.3 Kansas City", "Hip hop & R&B", TW("KPRSFMAAC")),
    ST("hiphop", "Radio Record Rap Hits", "Hip hop", "https://radiorecord.hostingradio.ru/rap96.aacp"),
    ST("hiphop", "Radio Record Trap", "Trap", "https://radiorecord.hostingradio.ru/trap96.aacp"),
    ST("hiphop", "80s80s Hip Hop", "Old school hip hop", "https://streams.80s80s.de/hiphop/mp3-192"),
    ST("hiphop", "SomaFM Fluid", "Instrumental hip hop", "https://ice1.somafm.com/fluid-128-mp3"),
    // R&B and soul
    ST("rnb", "107.5 WBLS New York", "R&B", TW("WBLSFMAAC")),
    ST("rnb", "WKYS Washington", "Hip hop & R&B", TW("WKYSFMAAC")),
    ST("rnb", "92Q Baltimore", "Hip hop & R&B", TW("WERQFMAAC")),
    ST("rnb", "Majic 102.1 Houston", "R&B", TW("KMJQFMAAC")),
    ST("rnb", "Majic 105.1 Detroit", "R&B", TW("WMGCFMAAC")),
    ST("rnb", "Philadelphia R&B", "R&B", TW("WRNBFMAAC")),
    ST("rnb", "181.fm The Beat", "Hip hop & R&B", "https://listen.181fm.com/181-beat_128k.mp3"),
    ST("rnb", "SomaFM Seven Inch Soul", "Vintage soul", "https://ice1.somafm.com/7soul-128-mp3"),
    // Dance and electronic
    ST("dance", "SAS Media 256k", "Dance", "https://play.sas-media.ru/play_256"),
    ST("dance", "SomaFM Beat Blender", "Deep house / downtempo", "https://ice1.somafm.com/beatblender-128-mp3"),
    ST("dance", "SomaFM DEF CON Radio", "Hacker / electronic", "https://ice1.somafm.com/defcon-128-mp3"),
    ST("dance", "Radio Record Deep", "Deep house", "https://radiorecord.hostingradio.ru/deep96.aacp"),
    ST("dance", "Radio Record Mix", "Dance mix", "https://radiorecord.hostingradio.ru/mix96.aacp"),
    ST("dance", "Radio Record Synthwave", "Synthwave", "https://radiorecord.hostingradio.ru/synth96.aacp"),
    // Chill and ambient
    ST("chill", "SomaFM Groove Salad", "Chill / downtempo", "https://ice1.somafm.com/groovesalad-128-mp3"),
    ST("chill", "SomaFM Lush", "Mellow vocals", "https://ice1.somafm.com/lush-128-mp3"),
    ST("chill", "SomaFM Space Station", "Space / electronica", "https://ice1.somafm.com/spacestation-128-mp3"),
    ST("chill", "SomaFM Secret Agent", "Spy / lounge", "https://ice1.somafm.com/secretagent-128-mp3"),
    ST("chill", "SomaFM Drone Zone", "Ambient", "https://ice1.somafm.com/dronezone-128-mp3"),
    ST("chill", "Radio Paradise Mellow", "Mellow mix", "https://stream.radioparadise.com/mellow-128"),
    // Rock and indie
    ST("rock", "Radio Paradise", "Eclectic rock", "https://stream.radioparadise.com/mp3-128"),
    ST("rock", "Radio Paradise Rock", "Rock", "https://stream.radioparadise.com/rock-128"),
    ST("rock", "Radio Record Rock", "Rock", "https://radiorecord.hostingradio.ru/rock96.aacp"),
    ST("rock", "NTS Radio 1", "Underground / eclectic", "https://stream-relay-geo.ntslive.net/stream"),
    ST("rock", "NTS Radio 2", "Underground / eclectic", "https://stream-relay-geo.ntslive.net/stream2"),
    ST("rock", "KEXP Seattle", "Indie / alternative", "https://kexp-mp3-128.streamguys1.com/kexp128.mp3"),
    // Throwbacks
    ST("throwback", "80s80s Rap", "Old school rap", "https://streams.80s80s.de/rap/mp3-192"),
    ST("throwback", "Radio Record Gold", "Disco and oldies", "https://radiorecord.hostingradio.ru/gold96.aacp"),
    ST("throwback", "Radio Record Super Disco 90s", "90s dance", "https://radiorecord.hostingradio.ru/sd9096.aacp"),
    ST("throwback", "SomaFM Left Coast 70s", "70s soft rock", "https://ice1.somafm.com/seventies-128-mp3"),
    // Reggae and world
    ST("world", "Radio Record Reggae", "Reggae", "https://radiorecord.hostingradio.ru/reggae96.aacp"),
    ST("world", "SomaFM Heavyweight Reggae", "Reggae / dub", "https://ice1.somafm.com/reggae-128-mp3")
];

/** Which stations answer right now. Results are kept for ten minutes so a busy server doesn't re-check them every time. */
export function createStations({ probe, list = STATIONS, ttlMs = 10 * 60_000, timeoutMs = 8000, now = Date.now } = {}) {
    let cache = null, at = 0, running = null;
    const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms).unref?.())]);
    async function check() {
        const out = new Array(list.length).fill(null);
        let i = 0;
        const worker = async () => {
            while (i < list.length) {
                const n = i++, st = list[n];
                try { const t = await withTimeout(probe(st.url), timeoutMs); out[n] = { ...t, title: st.name, artist: `Live radio · ${st.genre}`, genre: st.genre, cat: st.cat }; }
                catch { /* off the air or blocked: left out */ }
            }
        };
        await Promise.all(Array.from({ length: 8 }, worker));
        return out.filter(Boolean);
    }
    return {
        /** Working stations as ready-to-queue tracks. */
        async working({ force = false } = {}) {
            if (!force && cache && now() - at < ttlMs) return cache;
            running ??= check().then(r => { cache = r; at = now(); return r; }).finally(() => { running = null; });
            return running;
        },
        /** Working stations for one category, or a mix with every category represented when none is given (a Discord menu holds 25). */
        async pick(cat = null, max = 25) {
            const all = await this.working();
            if (cat) return all.filter(t => t.cat === cat).slice(0, max);
            const groups = CATEGORIES.map(([id]) => all.filter(t => t.cat === id)), out = [];
            for (let n = 0; out.length < Math.min(max, all.length); n++) for (const g of groups) if (g[n] && out.length < max) out.push(g[n]);
            return out;
        },
        all: () => list.map(s => ({ ...s }))
    };
}
