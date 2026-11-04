// The AI services the companion can talk to. Each one is a small adapter that turns the bot's neutral conversation into that
// service's request and reads its answer back, so the rest of the bot never cares which service is behind it.
//
// Neutral conversation messages:
//   { role: "user" | "assistant", content: "text" }
//   { role: "assistant", raw, calls }            a turn where the model asked for tools (raw is that service's own message)
//   { role: "tool", results: [{ id, name, output }] }   what the tools returned
// Tool definitions are written once, in Anthropic's shape ({ name, description, input_schema }), and converted here.
// Only fixed web addresses are used. Nobody can point the bot at an address of their own.

const MODEL_OK = /^[\w./:@+-]{1,100}$/;

export const PROVIDERS = {
    anthropic: { label: "Anthropic (Claude)", kind: "anthropic", url: "https://api.anthropic.com/v1/messages", defaultModel: "claude-haiku-5-5", keyHelp: "console.anthropic.com" },
    openai: { label: "OpenAI", kind: "openai", url: "https://api.openai.com/v1/chat/completions", tokens: "max_completion_tokens", keyHelp: "platform.openai.com" },
    gemini: { label: "Google Gemini", kind: "gemini", url: "https://generativelanguage.googleapis.com/v1beta", keyHelp: "aistudio.google.com" },
    openrouter: { label: "OpenRouter (many models)", kind: "openai", url: "https://openrouter.ai/api/v1/chat/completions", tokens: "max_tokens", keyHelp: "openrouter.ai" },
    groq: { label: "Groq", kind: "openai", url: "https://api.groq.com/openai/v1/chat/completions", tokens: "max_tokens", keyHelp: "console.groq.com" },
    mistral: { label: "Mistral", kind: "openai", url: "https://api.mistral.ai/v1/chat/completions", tokens: "max_tokens", keyHelp: "console.mistral.ai" },
    xai: { label: "xAI (Grok)", kind: "openai", url: "https://api.x.ai/v1/chat/completions", tokens: "max_tokens", keyHelp: "console.x.ai" },
    deepseek: { label: "DeepSeek", kind: "openai", url: "https://api.deepseek.com/chat/completions", tokens: "max_tokens", keyHelp: "platform.deepseek.com" }
};
export const PROVIDER_IDS = Object.keys(PROVIDERS);
export const providerList = () => PROVIDER_IDS.map(id => ({ id, label: PROVIDERS[id].label, needsModel: !PROVIDERS[id].defaultModel, keyHelp: PROVIDERS[id].keyHelp }));

/** Looks over a pasted key and model for the chosen service. Returns an error sentence or null. */
export function checkKeyShape(provider, key, model) {
    const p = PROVIDERS[provider];
    if (!p) return "Pick one of the AI services in the list.";
    const k = String(key ?? "").trim();
    if (k.length < 16 || k.length > 400 || /\s/.test(k) || !/^[\w.\-~+/=:]+$/.test(k)) return "That does not look like an API key. Copy all of it, with no spaces.";
    if (provider === "anthropic" && !/^sk-ant-[\w-]{20,300}$/.test(k)) return "That does not look like an Anthropic API key. They start with sk-ant-.";
    if (!p.defaultModel && !model) return `Type the name of the ${p.label} model to use. You can find the names in their model list.`;
    if (model && !MODEL_OK.test(model)) return "That model name has characters a model name does not use.";
    return null;
}

const text = s => String(s ?? "");
const errText = async res => { try { const j = await res.json(); return text(j?.error?.message ?? j?.error ?? j?.message ?? "").slice(0, 200); } catch { return ""; } };
const parseArgs = s => { try { const v = typeof s === "string" ? JSON.parse(s || "{}") : s; return v && typeof v === "object" ? v : {}; } catch { return {}; } };
const post = (fetchFn, url, headers, body, timeoutMs) => fetchFn(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs) });

// ---- Anthropic ----
async function anthropic({ fetchFn, p, apiKey, model, system, messages, tools, maxTokens, timeoutMs }) {
    const wire = messages.map(m => m.role === "tool"
        ? { role: "user", content: m.results.map(r => ({ type: "tool_result", tool_use_id: r.id, content: r.output })) }
        : m.raw ? { role: "assistant", content: m.raw } : { role: m.role, content: m.content });
    const res = await post(fetchFn, p.url, { "x-api-key": apiKey, "anthropic-version": "2023-06-01" }, { model, max_tokens: maxTokens, system, messages: wire, ...(tools?.length ? { tools } : {}) }, timeoutMs);
    if (!res.ok) return { ok: false, status: res.status, error: await errText(res) };
    const d = await res.json();
    const blocks = d?.content ?? [];
    return { ok: true, status: res.status, text: blocks.filter(b => b?.type === "text").map(b => b.text).join("\n").trim(),
        calls: d?.stop_reason === "tool_use" ? blocks.filter(b => b?.type === "tool_use").map(b => ({ id: b.id, name: b.name, input: b.input ?? {} })) : [],
        raw: blocks, usage: { in: d?.usage?.input_tokens ?? 0, out: d?.usage?.output_tokens ?? 0 } };
}

// ---- OpenAI and everything that speaks its chat format ----
async function openai({ fetchFn, p, apiKey, model, system, messages, tools, maxTokens, timeoutMs }) {
    const wire = [{ role: "system", content: system }];
    for (const m of messages) {
        if (m.role === "tool") for (const r of m.results) wire.push({ role: "tool", tool_call_id: r.id, content: r.output });
        else if (m.raw) wire.push(m.raw);
        else wire.push({ role: m.role, content: m.content });
    }
    const body = { model, messages: wire, [p.tokens ?? "max_tokens"]: maxTokens };
    if (tools?.length) body.tools = tools.map(t => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema ?? { type: "object", properties: {} } } }));
    const res = await post(fetchFn, p.url, { authorization: `Bearer ${apiKey}` }, body, timeoutMs);
    if (!res.ok) return { ok: false, status: res.status, error: await errText(res) };
    const d = await res.json();
    const msg = d?.choices?.[0]?.message ?? {};
    const calls = (msg.tool_calls ?? []).filter(c => c?.function?.name).map(c => ({ id: c.id, name: c.function.name, input: parseArgs(c.function.arguments) }));
    return { ok: true, status: res.status, text: text(Array.isArray(msg.content) ? msg.content.map(x => x?.text ?? "").join("") : msg.content).trim(), calls,
        raw: { role: "assistant", content: msg.content ?? null, ...(msg.tool_calls?.length ? { tool_calls: msg.tool_calls } : {}) },
        usage: { in: d?.usage?.prompt_tokens ?? 0, out: d?.usage?.completion_tokens ?? 0 } };
}

// ---- Google Gemini ----
const geminiSchema = s => {
    if (!s || !Object.keys(s.properties ?? {}).length) return undefined; // Gemini refuses an empty parameter object
    return s;
};
async function gemini({ fetchFn, p, apiKey, model, system, messages, tools, maxTokens, timeoutMs }) {
    const contents = [];
    for (const m of messages) {
        if (m.role === "tool") contents.push({ role: "user", parts: m.results.map(r => ({ functionResponse: { name: r.name, response: { result: parseArgs(r.output) } } })) });
        else if (m.raw) contents.push({ role: "model", parts: m.raw });
        else contents.push({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] });
    }
    const body = { systemInstruction: { parts: [{ text: system }] }, contents, generationConfig: { maxOutputTokens: maxTokens } };
    if (tools?.length) body.tools = [{ functionDeclarations: tools.map(t => ({ name: t.name, description: t.description ?? "", ...(geminiSchema(t.input_schema) ? { parameters: geminiSchema(t.input_schema) } : {}) })) }];
    const res = await post(fetchFn, `${p.url}/models/${encodeURIComponent(model)}:generateContent`, { "x-goog-api-key": apiKey }, body, timeoutMs);
    if (!res.ok) return { ok: false, status: res.status, error: await errText(res) };
    const d = await res.json();
    const parts = d?.candidates?.[0]?.content?.parts ?? [];
    return { ok: true, status: res.status, text: parts.map(x => x?.text ?? "").join("").trim(),
        calls: parts.filter(x => x?.functionCall).map((x, n) => ({ id: `${x.functionCall.name}-${n}`, name: x.functionCall.name, input: x.functionCall.args ?? {} })),
        raw: parts, usage: { in: d?.usageMetadata?.promptTokenCount ?? 0, out: d?.usageMetadata?.candidatesTokenCount ?? 0 } };
}

const ADAPTERS = { anthropic, openai, gemini };

/**
 * One request to the chosen service. Never throws for an HTTP error: returns { ok: false, status, error }.
 * On success returns { ok, status, text, calls: [{ id, name, input }], raw, usage: { in, out } }.
 */
export function chat({ provider = "anthropic", fetchFn = fetch, timeoutMs = 25_000, ...rest }) {
    const p = PROVIDERS[provider];
    if (!p) return Promise.resolve({ ok: false, status: 0, error: "Unknown AI service." });
    return ADAPTERS[p.kind]({ fetchFn, p, timeoutMs, ...rest });
}
