/** The places listings come from, for the "don't include" switches (per member and per server). */
export const PLAYTEST_SOURCES = [["abg", "Alpha Beta Gamer"], ["gamerpower", "GamerPower"], ["itch", "itch.io"], ["playtester", "Playtester"], ["steamdemo", "Steam demos"]];
export const cleanSkipList = v => [...new Set((Array.isArray(v) ? v : String(v ?? "").split(",")).map(x => String(x).trim()).filter(x => PLAYTEST_SOURCES.some(([id]) => id === x)))].join(",");
