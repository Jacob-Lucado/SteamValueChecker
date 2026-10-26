// Builds the Discord embeds and the CSV download from report data.
// Embeds are plain API objects (no discord.js needed), which keeps this module testable.

export const ROWS_PER_PAGE = 15;
const COLOR = 0xff9800;

export function money(n, currency = "USD") {
    if (n === null || n === undefined || Number.isNaN(n)) return "-";
    try {
        return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(n);
    } catch {
        return `${n.toFixed(2)} ${currency}`;
    }
}

const fit = (s, n) => { const t = String(s); return (t.length > n ? t.slice(0, n - 1) + "…" : t).padEnd(n); };
const left = (s, n) => String(s).padStart(n);
const fence = lines => "```\n" + lines.join("\n") + "\n```";

export function pageCount(rows) {
    return Math.max(1, Math.ceil(rows.length / ROWS_PER_PAGE));
}

/** The table for one page. `~` marks an approximate title match. */
export function tableEmbed(rows, page, currency) {
    const showPaid = rows.some(r => r.paid !== null);
    const header = `${fit("Game", 24)} ${left("MSRP", 9)} ${left("Steam", 9)} ${left("Cheapest", 9)} ${fit("Store", 11)}` +
        (showPaid ? ` ${left("Paid", 9)}` : "");

    const slice = rows.slice(page * ROWS_PER_PAGE, (page + 1) * ROWS_PER_PAGE);
    const body = slice.map(r => {
        if (!r.found) return `${fit(r.title, 24)} not found`;
        const name = (r.approx ? "~" : "") + r.title;
        const store = r.best ? r.best.shop : "-";
        return `${fit(name, 24)} ${left(money(r.msrp, currency), 9)} ${left(money(r.steam, currency), 9)} ` +
            `${left(money(r.best?.price ?? null, currency), 9)} ${fit(store, 11)}` +
            (showPaid ? ` ${left(money(r.paid, currency), 9)}` : "");
    });

    const pages = pageCount(rows);
    return {
        color: COLOR,
        description: fence([header, ...body]),
        footer: { text: `Page ${page + 1}/${pages}  •  ~ = approximate title match  •  Prices by IsThereAnyDeal` }
    };
}

function signed(diff, pct, currency) {
    return diff >= 0
        ? `saved ${money(diff, currency)} (${Math.round(pct)}%)`
        : `extra ${money(-diff, currency)} (${Math.round(-pct)}% more)`;
}

/** Totals, plus the paid-vs-value block when the user gave an amount. */
export function summaryEmbed(t, savings, { region, majorOnly }) {
    const c = t.currency;
    const value = [
        `${"MSRP".padEnd(14)} ${left(money(t.msrp, c), 11)}`,
        `${"Steam now".padEnd(14)} ${left(money(t.steam, c), 11)}${t.steamCount < t.found ? `  (${t.steamCount} on Steam)` : ""}`,
        `${"Cheapest now".padEnd(14)} ${left(money(t.best, c), 11)}${majorOnly ? "  (major stores)" : ""}`
    ];
    if (t.atlCount > 0) value.push(`${"All-time low".padEnd(14)} ${left(money(t.atl, c), 11)}`);

    const fields = [{
        name: `Library value  (${t.found}/${t.count} games found, ${region})`,
        value: fence(value)
    }];

    if (savings) {
        const paidLine = `${"You paid".padEnd(16)} ${left(money(savings.paid, c), 10)}`;
        const lines = [paidLine];
        if (savings.perGame !== null) lines.push(`${"Per game".padEnd(16)} ${left(money(savings.perGame, c), 10)}`);
        for (const l of savings.lines) {
            lines.push(`vs ${l.label.padEnd(13)} ${signed(l.diff, l.pct, c)}`);
        }
        fields.push({ name: "Paid vs value", value: fence(lines) });
        if (savings.verdict) fields.push({ name: "Verdict", value: savings.verdict });

        if (savings.biggest.length) {
            fields.push({
                name: "Best deals",
                value: savings.biggest
                    .map(r => `**${r.title}**: paid ${money(r.paid, c)} (MSRP ${money(r.msrp, c)})`)
                    .join("\n").slice(0, 1000)
            });
        }
        if (savings.overpaid.length) {
            fields.push({
                name: "Cheaper elsewhere now",
                value: savings.overpaid.slice(0, 5)
                    .map(r => `**${r.title}**: paid ${money(r.paid, c)}, now ${money(r.best.price, c)} at ${r.best.shop}`)
                    .join("\n").slice(0, 1000)
            });
        }
    }

    return { color: COLOR, title: "Steam Value Checker", fields };
}

const csvCell = v => {
    let s = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // stops spreadsheet formula injection from odd titles
    return `"${s.replace(/"/g, '""')}"`;
};

export function toCsv(rows, currency) {
    const head = ["Game", "Matched title", "Found", "Currency", "MSRP", "Steam price", "Steam discount %", "Cheapest price", "Cheapest store", "All-time low", "Paid"];
    const lines = rows.map(r => [
        r.title, r.approx ? r.matched : "", r.found ? "yes" : "no", currency,
        r.msrp, r.steam, r.cut || "", r.best?.price, r.best?.shop, r.atl, r.paid
    ].map(csvCell).join(","));
    return "﻿" + [head.map(csvCell).join(","), ...lines].join("\r\n") + "\r\n";
}
