// Live radio stations the bot suggests with /music live and on the dashboard. The list is checked when it's asked for,
// so a station that has gone off the air simply doesn't show up.
export const CATEGORIES = [["hiphop", "Hip hop"], ["rnb", "R&B & soul"], ["dance", "Dance & electronic"], ["chill", "Chill & ambient"], ["rock", "Rock & indie"], ["throwback", "Throwbacks"], ["world", "Reggae & world"], ["game", "Game & anime"], ["lofi", "Lofi & synthwave"], ["jazz", "Jazz & classical"], ["pop", "Pop & top 40"]];
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
    ST("world", "SomaFM Heavyweight Reggae", "Reggae / dub", "https://ice1.somafm.com/reggae-128-mp3"),
    // Game music and anime
    ST("game", "Rainwave Game Music", "Video game soundtracks", "https://relay.rainwave.cc/game.mp3"),
    ST("game", "Rainwave OC ReMix", "Game remixes", "https://relay.rainwave.cc/ocremix.mp3"),
    ST("game", "Rainwave Covers", "Game music covers", "https://relay.rainwave.cc/covers.mp3"),
    ST("game", "Rainwave Chiptunes", "Chiptune", "https://relay.rainwave.cc/chiptune.mp3"),
    ST("game", "Rainwave All", "Everything game", "https://relay.rainwave.cc/all.mp3"),
    ST("game", "Nectarine Demoscene Radio", "Demoscene / tracker", "https://necta.burn.net:8000/nectarine"),
    ST("game", "Gensokyo Radio", "Touhou", "https://stream.gensokyoradio.net/1/"),
    ST("game", "LISTEN.moe", "J-pop and anime", "https://listen.moe/stream"),
    ST("game", "LISTEN.moe K-pop", "K-pop", "https://listen.moe/kpop/stream"),
    ST("game", "laut.fm Anime", "Anime", "https://stream.laut.fm/anime"),
    // Lofi and synthwave
    ST("lofi", "Lofi Hip Hop Radio", "Lofi beats to study to", "https://stream.laut.fm/lofi-radio"),
    ST("lofi", "Lofi Radio", "Lofi", "https://play.streamafrica.net/lofiradio"),
    ST("lofi", "Chillhop (FluxFM)", "Chillhop", "https://streams.fluxfm.de/Chillhop/mp3-128/streams.fluxfm.de/"),
    ST("lofi", "I Love Chillhop", "Chillhop", "https://streams.ilovemusic.de/iloveradio17.mp3"),
    ST("lofi", "Nightride FM", "Synthwave", "https://stream.nightride.fm/nightride.mp3"),
    ST("lofi", "Chillsynth FM", "Chill synthwave", "https://stream.nightride.fm/chillsynth.mp3"),
    ST("lofi", "Datawave FM", "Datawave / glitch", "https://stream.nightride.fm/datawave.mp3"),
    ST("lofi", "Spacesynth FM", "Space synth", "https://stream.nightride.fm/spacesynth.mp3"),
    ST("lofi", "Darksynth FM", "Darksynth", "https://stream.nightride.fm/darksynth.mp3"),
    ST("lofi", "Horrorsynth FM", "Horror synth", "https://stream.nightride.fm/horrorsynth.mp3"),
    ST("lofi", "EBSM", "Industrial / EBM", "https://stream.nightride.fm/ebsm.mp3"),
    ST("lofi", "Rektory", "Rekt / bass synth", "https://stream.nightride.fm/rektory.mp3"),
    ST("lofi", "laut.fm Synthwave", "Synthwave", "https://stream.laut.fm/synthwave"),
    ST("lofi", "SomaFM Vaporwaves", "Vaporwave", "https://ice1.somafm.com/vaporwaves-128-mp3"),
    ST("lofi", "SomaFM Synphaera", "Ambient electronica", "https://ice1.somafm.com/synphaera-128-mp3"),
    // Jazz and classical
    ST("jazz", "Classic FM", "Classical", "https://media-ssl.musicradio.com/ClassicFM"),
    ST("jazz", "Jazz24", "Jazz", "https://knkx-ice.streamguys1.com/jazz24-aac"),
    ST("jazz", "WBGO Jazz 88.3", "Jazz", "https://wbgo.streamguys1.com/wbgo128"),
    ST("jazz", "WWOZ New Orleans", "New Orleans jazz and roots", "https://wwoz-sc.streamguys1.com/wwoz-hi.mp3"),
    ST("jazz", "FIP Jazz", "Jazz", "https://icecast.radiofrance.fr/fipjazz-midfi.mp3"),
    ST("jazz", "SomaFM Sonic Universe", "Jazz fusion", "https://ice1.somafm.com/sonicuniverse-128-mp3"),
    ST("jazz", "SomaFM Illinois Street Lounge", "Lounge", "https://ice1.somafm.com/illstreet-128-mp3"),
    ST("jazz", "laut.fm Jazz", "Jazz", "https://stream.laut.fm/jazz"),
    // Pop and top 40
    ST("pop", "Capital FM London", "Pop hits", "https://media-ssl.musicradio.com/Capital"),
    ST("pop", "Heart London", "Pop hits", "https://media-ssl.musicradio.com/HeartLondon"),
    ST("pop", "Virgin Radio UK", "Pop and rock hits", "https://radio.virginradio.co.uk/stream"),
    ST("pop", "Smooth Radio London", "Easy listening", "https://media-ssl.musicradio.com/SmoothLondon"),
    ST("pop", "Capital Xtra", "Hip hop and R&B hits", "https://media-ssl.musicradio.com/CapitalXTRANational"),
    ST("pop", "I Love Radio", "Pop hits", "https://streams.ilovemusic.de/iloveradio1.mp3"),
    ST("pop", "I Love 2 Dance", "Dance hits", "https://streams.ilovemusic.de/iloveradio2.mp3"),
    ST("pop", "SomaFM PopTron", "Indie electropop", "https://ice1.somafm.com/poptron-128-mp3"),
    ST("pop", "SomaFM Underground 80s", "80s alternative", "https://ice1.somafm.com/u80s-128-mp3"),
    // Indie, eclectic and more rock
    ST("rock", "Radio X UK", "Rock", "https://media-ssl.musicradio.com/RadioXUK"),
    ST("rock", "The Current (Minnesota)", "Indie / alternative", "https://current.stream.publicradio.org/kcmp.mp3"),
    ST("rock", "WXPN Philadelphia", "Indie / adult alternative", "https://wxpnhi.xpn.org/xpnhi"),
    ST("rock", "WFMU", "Freeform", "https://stream0.wfmu.org/freeform-128k"),
    ST("rock", "dublab", "Los Angeles eclectic", "https://dublab.out.airtime.pro/dublab_a"),
    ST("rock", "FIP", "Eclectic", "https://icecast.radiofrance.fr/fip-midfi.mp3"),
    ST("rock", "FIP Rock", "Rock", "https://icecast.radiofrance.fr/fiprock-midfi.mp3"),
    ST("rock", "Rock Antenne", "Rock", "https://stream.rockantenne.de/rockantenne/stream/mp3"),
    ST("rock", "laut.fm Rock", "Rock", "https://stream.laut.fm/rock"),
    ST("rock", "laut.fm Metal", "Metal", "https://stream.laut.fm/metal"),
    ST("rock", "SomaFM Metal Detector", "Metal", "https://ice1.somafm.com/metal-128-mp3"),
    ST("rock", "SomaFM Indie Pop Rocks", "Indie pop", "https://ice1.somafm.com/indiepop-128-mp3"),
    // More dance, chill and world
    ST("dance", "SLAM!", "Dance (Netherlands)", "https://stream.slam.nl/slam_mp3"),
    ST("dance", "laut.fm Techno", "Techno", "https://stream.laut.fm/techno"),
    ST("dance", "laut.fm Dance", "Dance", "https://stream.laut.fm/dance"),
    ST("dance", "FIP Electro", "Electronic", "https://icecast.radiofrance.fr/fipelectro-midfi.mp3"),
    ST("dance", "SomaFM The Trip", "Progressive house", "https://ice1.somafm.com/thetrip-128-mp3"),
    ST("dance", "SomaFM Dub Step Beyond", "Dubstep", "https://ice1.somafm.com/dubstep-128-mp3"),
    ST("dance", "SomaFM cliqhop", "IDM / glitch", "https://ice1.somafm.com/cliqhop-128-mp3"),
    ST("chill", "SomaFM Deep Space One", "Deep ambient", "https://ice1.somafm.com/deepspaceone-128-mp3"),
    ST("chill", "SomaFM Groove Salad Classic", "Chill classics", "https://ice1.somafm.com/gsclassic-128-mp3"),
    ST("chill", "SomaFM Mission Control", "Space ambient with NASA audio", "https://ice1.somafm.com/missioncontrol-128-mp3"),
    ST("chill", "laut.fm Chillout", "Chillout", "https://stream.laut.fm/chillout"),
    ST("world", "FIP World", "World music", "https://icecast.radiofrance.fr/fipworld-midfi.mp3"),
    ST("world", "Radio Paradise Global", "Global mix", "https://stream.radioparadise.com/global-128"),
    ST("world", "laut.fm Reggae", "Reggae", "https://stream.laut.fm/reggae"),
    ST("world", "SomaFM Suburbs of Goa", "Indian / world electronica", "https://ice1.somafm.com/suburbsofgoa-128-mp3"),
    ST("world", "SomaFM ThistleRadio", "Celtic", "https://ice1.somafm.com/thistle-128-mp3"),
    ST("throwback", "SomaFM Black Rock FM", "Eclectic", "https://ice1.somafm.com/brfm-128-mp3"),
    ST("throwback", "laut.fm Country", "Country", "https://stream.laut.fm/country"),
    ST("hiphop", "laut.fm Hip Hop", "Hip hop", "https://stream.laut.fm/hiphop")
];

/** Finds a station from words someone typed ("lofi", "groove salad", "jazz"): the best name match, then the best genre match. Null when nothing fits. */
export function findStation(query, list = STATIONS) {
    const words = String(query ?? "").toLowerCase().replace(/[^a-z0-9&+ ]+/g, " ").split(/\s+/).filter(w => w && !["radio", "fm", "play", "the", "station", "stream", "live"].includes(w));
    if (!words.length) return null;
    let best = null, top = 0;
    for (const st of list) {
        const name = st.name.toLowerCase(), hay = `${name} ${st.genre.toLowerCase()} ${(CATEGORIES.find(c => c[0] === st.cat)?.[1] ?? "").toLowerCase()}`;
        let score = 0;
        for (const w of words) { if (name.includes(w)) score += 3; else if (hay.includes(w)) score += 1; }
        if (name === words.join(" ")) score += 10;
        if (score > top) { top = score; best = st; }
    }
    return top >= words.length ? best : null; // every word has to land somewhere
}

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
