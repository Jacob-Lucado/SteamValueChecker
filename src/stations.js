// Live radio stations the bot suggests with /music live and on the dashboard. The list is checked when it's asked for,
// so a station that has gone off the air simply doesn't show up.
export const STATIONS = [
    { name: "SAS Media 256k", genre: "Dance", url: "https://play.sas-media.ru/play_256" },
    { name: "SomaFM Groove Salad", genre: "Chill / downtempo", url: "https://ice1.somafm.com/groovesalad-128-mp3" },
    { name: "SomaFM Beat Blender", genre: "Deep house / downtempo", url: "https://ice1.somafm.com/beatblender-128-mp3" },
    { name: "SomaFM DEF CON Radio", genre: "Hacker / electronic", url: "https://ice1.somafm.com/defcon-128-mp3" },
    { name: "SomaFM Lush", genre: "Mellow vocals", url: "https://ice1.somafm.com/lush-128-mp3" },
    { name: "SomaFM Space Station", genre: "Space / electronica", url: "https://ice1.somafm.com/spacestation-128-mp3" },
    { name: "SomaFM Secret Agent", genre: "Spy / lounge", url: "https://ice1.somafm.com/secretagent-128-mp3" },
    { name: "SomaFM Drone Zone", genre: "Ambient", url: "https://ice1.somafm.com/dronezone-128-mp3" },
    { name: "Radio Paradise", genre: "Eclectic rock", url: "https://stream.radioparadise.com/mp3-128" },
    { name: "Radio Paradise Mellow", genre: "Mellow mix", url: "https://stream.radioparadise.com/mellow-128" },
    { name: "Radio Paradise Rock", genre: "Rock", url: "https://stream.radioparadise.com/rock-128" },
    { name: "NTS Radio 1", genre: "Underground / eclectic", url: "https://stream-relay-geo.ntslive.net/stream" },
    { name: "NTS Radio 2", genre: "Underground / eclectic", url: "https://stream-relay-geo.ntslive.net/stream2" },
    { name: "KEXP Seattle", genre: "Indie / alternative", url: "https://kexp-mp3-128.streamguys1.com/kexp128.mp3" }
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
                try { const t = await withTimeout(probe(st.url), timeoutMs); out[n] = { ...t, title: st.name, artist: `Live radio · ${st.genre}`, genre: st.genre }; }
                catch { /* off the air or blocked: left out */ }
            }
        };
        await Promise.all([worker(), worker(), worker(), worker()]);
        return out.filter(Boolean);
    }
    return {
        /** Working stations as ready-to-queue tracks. */
        async working({ force = false } = {}) {
            if (!force && cache && now() - at < ttlMs) return cache;
            running ??= check().then(r => { cache = r; at = now(); return r; }).finally(() => { running = null; });
            return running;
        },
        all: () => list.map(s => ({ ...s }))
    };
}
