// @ts-nocheck
import { useState, useEffect, useCallback, useRef } from "react";

// ─── TOPICS ───────────────────────────────────────────────────────────────────
const TOPICS = {
  GPU_INFRA: {
    label: "GPU / ML Infrastructure", short: "GPU INFRA", color: "#00ff9f",
    keywords: ["nvidia","gpu cluster","h100","blackwell","data center gpu","inference infrastructure","ai accelerator","tpu"],
    subreddits: ["MachineLearning","hardware","artificial"],
    investable: ["NVDA","AMD","SMCI"], thesis: "La domanda di compute per AI cresce esponenzialmente. Ogni nuovo modello richiede 10x il compute del precedente.",
  },
  COOLING: {
    label: "Data Center Cooling", short: "COOLING", color: "#4cc9f0",
    keywords: ["liquid cooling","immersion cooling","data center water","thermal management","cooling infrastructure","pue"],
    subreddits: ["hardware","sysadmin","datacenter"],
    investable: ["VRT","CARR","JCI"], thesis: "Ogni GPU H100 consuma 700W. I data center stanno esaurendo capacità ad aria. Il liquid cooling è strutturale.",
  },
  HBM: {
    label: "HBM / Memory", short: "HBM", color: "#f72585",
    keywords: ["hbm","hbm3","high bandwidth memory","sk hynix","memory bandwidth","micron hbm","gddr7"],
    subreddits: ["hardware","stocks","investing"],
    investable: ["MU","000660.KS"], thesis: "HBM è il collo di bottiglia per LLM. SK Hynix e Micron hanno quasi monopolio con backlog di 18+ mesi.",
  },
  DATA_GOV: {
    label: "Data Governance", short: "DATA GOV", color: "#ffd166",
    keywords: ["data governance","data catalog","data mesh","data lineage","gdpr enforcement","data sovereignty","data fabric"],
    subreddits: ["dataengineering","datascience","investing"],
    investable: ["INFA","MSFT","SNOW"], thesis: "Regolamentazione AI e GDPR rendono la governance dati da costo a requisito legale.",
  },
  WATER: {
    label: "Water Infrastructure", short: "WATER", color: "#06d6a0",
    keywords: ["water scarcity","desalination","water infrastructure","water stress","water technology","water purification","drought"],
    subreddits: ["environment","investing","Futurology","climate"],
    investable: ["XYL","WTRG","PHO"], thesis: "2050: 5 miliardi di persone in aree con stress idrico. L'acqua diventa asset strategico.",
  },
};

// Crypto instruments on Crypto.com
const CRYPTO_INSTRUMENTS = {
  BTC: "BTC_USDT", ETH: "ETH_USDT", SOL: "SOL_USDT",
  BNB: "BNB_USDT", AVAX: "AVAX_USDT",
};

const MOCK_STOCKS = {
  NVDA: { price: 875.4, change: 2.3, name: "NVIDIA" },
  TSLA: { price: 177.9, change: -1.8, name: "Tesla" },
  XYL:  { price: 118.2, change: 0.9,  name: "Xylem" },
  MU:   { price: 96.4,  change: 1.4,  name: "Micron" },
  VRT:  { price: 88.7,  change: 3.2,  name: "Vertiv" },
};

const SIG_COLORS = { STRONG_BUY: "#00ff9f", BUY: "#4cc9f0", WATCH: "#ffd166", HOLD: "#888", AVOID: "#ff4d6d", SELL: "#ff4d6d" };
const MOM_ICON = { accelerating: "▲▲", stable: "▶", decelerating: "▼" };

// ─── TELEGRAM ─────────────────────────────────────────────────────────────────
async function sendTelegram(token, chatId, msg) {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: msg, parse_mode: "Markdown" }),
    });
    return res.ok;
  } catch { return false; }
}

// ─── HN + REDDIT FETCH ────────────────────────────────────────────────────────
async function fetchHNStories(limit = 40) {
  try {
    const ids = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json").then(r => r.json());
    const stories = await Promise.all(
      ids.slice(0, limit).map(id =>
        fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()).catch(() => null)
      )
    );
    return stories.filter(Boolean).map(s => ({ title: s.title || "", url: s.url || "", score: s.score || 0, source: "HackerNews" }));
  } catch { return []; }
}

async function fetchReddit(sub, limit = 10) {
  try {
    const data = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=${limit}`, { headers: { "User-Agent": "SignalOps/2.0" } }).then(r => r.json());
    return (data?.data?.children || []).map(c => ({ title: c.data.title || "", url: c.data.url || "", score: c.data.score || 0, source: `r/${sub}` }));
  } catch { return []; }
}

function scoreArticles(articles, keywords) {
  return articles
    .map(a => ({ ...a, relevance: keywords.filter(k => a.title.toLowerCase().includes(k.toLowerCase())).length }))
    .filter(a => a.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance);
}

// ─── CLAUDE API WITH CRYPTO.COM MCP ──────────────────────────────────────────
async function analyzeWithCryptoCom(symbol, instrument) {
  const prompt = `Hai accesso ai dati di mercato Crypto.com in tempo reale.
Usa lo strumento get_ticker per ottenere i dati attuali di ${instrument} e poi analizza:
- Momentum del prezzo
- Spread bid/ask (liquidità)
- Volume nelle ultime 24h
- Variazione percentuale

Rispondi SOLO con JSON valido:
{"signal":"BUY","confidence":75,"reasoning":"due frasi","entry":100,"stop_loss":90,"take_profit":115,"price":100,"change":2.5}
signal può essere: BUY, SELL, HOLD, WATCH`;

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1000,
        mcp_servers: [{ type: "url", url: "https://mcp.crypto.com/market-data/mcp", name: "crypto-com-mcp" }],
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const data = await res.json();
    // Extract text from possibly mixed content (text + mcp_tool_use + mcp_tool_result)
    const textBlocks = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("");
    const jsonMatch = textBlocks.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    return JSON.parse(jsonMatch[0]);
  } catch (e) { console.error("Crypto.com MCP analysis error", e); return null; }
}

async function analyzeTrend(topicKey, topic, articles) {
  const titles = articles.slice(0, 12).map(a => `- [${a.source}] ${a.title}`).join("\n");
  const prompt = `Sei un analista di trend tecnologici e finanziari.
Topic: ${topic.label}
Tesi: ${topic.thesis}
Asset investibili: ${topic.investable.join(", ")}
Articoli recenti:
${titles || "Nessun articolo trovato."}
Analizza il momentum e rispondi SOLO con JSON:
{"score":0-100,"momentum":"accelerating|stable|decelerating","signal":"STRONG_BUY|BUY|WATCH|HOLD|AVOID","summary":"2 frasi","catalyst":"evento rilevante","timeframe":"short|medium|long","confidence":0-100}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    const text = (data.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim();
    return JSON.parse(text);
  } catch { return null; }
}

async function analyzeStockAsset(symbol, price, change) {
  const prompt = `Sei un analista quantitativo. Analizza ${symbol} (azione USA):
- Prezzo: $${price}
- Variazione 24h: ${change}%
Rispondi SOLO con JSON valido:
{"signal":"BUY","confidence":75,"reasoning":"due frasi","entry":${price},"stop_loss":${(price * 0.95).toFixed(2)},"take_profit":${(price * 1.08).toFixed(2)}}`;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
    });
    const data = await res.json();
    return JSON.parse((data.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim());
  } catch { return null; }
}

// ─── GMAIL via MCP ────────────────────────────────────────────────────────────
async function sendGmailAlert(emailTo, subject, body) {
  if (!emailTo) return false;
  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        mcp_servers: [{ type: "url", url: "https://gmail.mcp.claude.com/mcp", name: "gmail-mcp" }],
        messages: [{ role: "user", content: `Invia una email a ${emailTo} con subject "${subject}" e body: ${body}. Poi rispondi solo "ok".` }],
      }),
    });
    return res.ok;
  } catch { return false; }
}

// ─── GOOGLE CALENDAR via MCP ──────────────────────────────────────────────────
async function logToCalendar(title, description) {
  try {
    const now = new Date();
    const end = new Date(now.getTime() + 30 * 60000);
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        mcp_servers: [{ type: "url", url: "https://gcal.mcp.claude.com/mcp", name: "gcal-mcp" }],
        messages: [{ role: "user", content: `Crea un evento Google Calendar con titolo "${title}", descrizione "${description}", inizio ${now.toISOString()}, fine ${end.toISOString()}. Poi rispondi solo "ok".` }],
      }),
    });
    return res.ok;
  } catch { return false; }
}

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function Pulse({ color, size = 7 }) {
  return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}`, animation: "pulse 2s infinite", marginRight: 6, flexShrink: 0 }} />;
}

function ScoreBar({ score, color }) {
  return (
    <div style={{ height: 3, background: "#1a2535", borderRadius: 2, overflow: "hidden", margin: "6px 0" }}>
      <div style={{ height: "100%", width: `${score}%`, background: `linear-gradient(90deg, ${color}88, ${color})`, borderRadius: 2, transition: "width 1.2s ease" }} />
    </div>
  );
}

function Badge({ label, color }) {
  const c = color || "#888";
  return <span style={{ padding: "2px 7px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", fontFamily: "monospace", background: `${c}22`, color: c, border: `1px solid ${c}44`, whiteSpace: "nowrap" }}>{label}</span>;
}

function IntegrationRow({ icon, label, active, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginBottom: 8 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 12px", background: active ? "#0a1a12" : "#10090a", border: `1px solid ${active ? "#00ff9f33" : "#2a1a1a"}`, borderRadius: open ? "5px 5px 0 0" : 5, cursor: "pointer" }}>
        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: active ? "#00ff9f" : "#4a2a2a" }}>{icon} {label} {active ? "● ON" : "○ OFF"}</span>
        <span style={{ color: "#2a4a3a", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && <div style={{ padding: 12, background: "#050810", border: "1px solid #1a2535", borderTop: "none", borderRadius: "0 0 5px 5px" }}>{children}</div>}
    </div>
  );
}

const inputStyle = { width: "100%", padding: "7px 10px", background: "#0d1520", border: "1px solid #1a2535", borderRadius: 4, color: "#c8d3dc", fontSize: 11, fontFamily: "monospace", outline: "none", marginTop: 4 };
const btnStyle = (color, disabled) => ({ padding: "6px 14px", borderRadius: 4, border: `1px solid ${color}44`, background: `${color}18`, color: disabled ? "#2a4a3a" : color, fontSize: 11, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", fontFamily: "monospace" });

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function SignalOps() {
  const [view, setView] = useState("radar");
  const [trendData, setTrendData] = useState({});
  const [trendArticles, setTrendArticles] = useState({});
  const [scanning, setScanning] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const [cryptoPrices, setCryptoPrices] = useState({});
  const [tradingSignals, setTradingSignals] = useState({});
  const [analyzingAsset, setAnalyzingAsset] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [expandedTopic, setExpandedTopic] = useState(null);

  // Integrations config
  const [tgCfg, setTgCfg] = useState({ token: "", chatId: "" });
  const [gmailCfg, setGmailCfg] = useState({ email: "" });
  const [calendarEnabled, setCalendarEnabled] = useState(false);
  const [tgSent, setTgSent] = useState({});
  const [calSent, setCalSent] = useState({});
  const [gmailSent, setGmailSent] = useState({});

  // Auto-scan
  const [autoScan, setAutoScan] = useState(false);
  const [autoInterval, setAutoInterval] = useState(6);
  const [nextScan, setNextScan] = useState(null);
  const autoRef = useRef(null);

  // ── Fetch crypto prices via Crypto.com MCP (fallback to CoinGecko) ──────────
  const fetchCryptoPrices = useCallback(async () => {
    // Try CoinGecko first (direct fetch, reliable for price display)
    try {
      const ids = "bitcoin,ethereum,solana,binancecoin,avalanche-2";
      const data = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`).then(r => r.json());
      const map = { bitcoin: "BTC", ethereum: "ETH", solana: "SOL", "binancecoin": "BNB", "avalanche-2": "AVAX" };
      const out = {};
      Object.entries(map).forEach(([id, sym]) => {
        if (data[id]) out[sym] = { price: data[id].usd, change: data[id].usd_24h_change, source: "CoinGecko" };
      });
      if (Object.keys(out).length > 0) { setCryptoPrices(out); return; }
    } catch {}
    // Fallback: basic placeholder
    setCryptoPrices({ BTC: { price: 0, change: 0 }, ETH: { price: 0, change: 0 }, SOL: { price: 0, change: 0 } });
  }, []);

  useEffect(() => {
    fetchCryptoPrices();
    const i = setInterval(fetchCryptoPrices, 30000);
    return () => clearInterval(i);
  }, [fetchCryptoPrices]);

  // ── Dispatch alert to all enabled channels ───────────────────────────────────
  const dispatchAlert = useCallback(async (alert) => {
    setAlerts(prev => [alert, ...prev].slice(0, 50));

    // Telegram
    if (tgCfg.token && tgCfg.chatId) {
      let msg = "";
      if (alert.type === "TREND") {
        msg = `📡 *TREND RADAR — ${alert.topicLabel}*\n\n🎯 \`${alert.signal}\` — Score \`${alert.score}/100\` ${MOM_ICON[alert.momentum] || ""}\n\n💡 ${alert.summary}\n\n⚡ _${alert.catalyst}_\n\n🏦 ${(alert.investable || []).map(a => `\`${a}\``).join(" ")}\n\n⏱ ${alert.time}`;
      } else {
        const e = alert.signal === "BUY" ? "🟢" : "🔴";
        msg = `${e} *TRADE — ${alert.symbol}*\n\nSegnale: \`${alert.signal}\`\n💰 \`$${Number(alert.price || 0).toFixed(2)}\`\nConf: \`${alert.confidence}%\`\n${alert.entry ? `🎯 Entry: \`$${alert.entry}\`\n` : ""}${alert.stop_loss ? `🛑 Stop: \`$${alert.stop_loss}\`\n` : ""}${alert.take_profit ? `✅ TP: \`$${alert.take_profit}\`\n` : ""}\n💬 _${alert.reasoning}_`;
      }
      const ok = await sendTelegram(tgCfg.token, tgCfg.chatId, msg);
      if (ok) setTgSent(prev => ({ ...prev, [alert.id]: true }));
    }

    // Gmail (only for STRONG_BUY or high confidence)
    if (gmailCfg.email && (alert.signal === "STRONG_BUY" || alert.confidence >= 80)) {
      const subject = `SIGNAL//OPS — ${alert.signal} su ${alert.topicLabel || alert.symbol}`;
      const body = alert.summary || alert.reasoning || "";
      const ok = await sendGmailAlert(gmailCfg.email, subject, body);
      if (ok) setGmailSent(prev => ({ ...prev, [alert.id]: true }));
    }

    // Google Calendar (log BUY+ signals)
    if (calendarEnabled && (alert.signal === "BUY" || alert.signal === "STRONG_BUY")) {
      const title = `📈 ${alert.signal}: ${alert.topicLabel || alert.symbol}`;
      const desc = alert.summary || alert.reasoning || "";
      const ok = await logToCalendar(title, desc);
      if (ok) setCalSent(prev => ({ ...prev, [alert.id]: true }));
    }
  }, [tgCfg, gmailCfg, calendarEnabled]);

  // ── Scan single topic ────────────────────────────────────────────────────────
  const scanTopic = useCallback(async (key) => {
    setScanning(key);
    const topic = TOPICS[key];
    try {
      const [hnStories, ...redditResults] = await Promise.all([
        fetchHNStories(60),
        ...topic.subreddits.map(sub => fetchReddit(sub, 15)),
      ]);
      const relevant = scoreArticles([...hnStories, ...redditResults.flat()], topic.keywords);
      setTrendArticles(prev => ({ ...prev, [key]: relevant }));
      const analysis = await analyzeTrend(key, topic, relevant);
      if (analysis) {
        setTrendData(prev => ({ ...prev, [key]: { ...analysis, scannedAt: new Date() } }));
        if (analysis.signal === "STRONG_BUY" || analysis.signal === "BUY") {
          await dispatchAlert({
            id: Date.now(), type: "TREND", topic: key, topicLabel: topic.short,
            signal: analysis.signal, score: analysis.score, momentum: analysis.momentum,
            summary: analysis.summary, catalyst: analysis.catalyst, investable: topic.investable,
            time: new Date().toLocaleTimeString("it-IT"), color: topic.color, confidence: analysis.confidence,
          });
        }
      }
    } catch (e) { console.error(e); }
    finally { setScanning(null); }
  }, [dispatchAlert]);

  // ── Scan all ──────────────────────────────────────────────────────────────────
  const scanAll = useCallback(async () => {
    for (const key of Object.keys(TOPICS)) {
      await scanTopic(key);
      await new Promise(r => setTimeout(r, 800));
    }
    setLastScan(new Date());
  }, [scanTopic]);

  // ── Auto-scan interval ────────────────────────────────────────────────────────
  useEffect(() => {
    if (autoRef.current) clearInterval(autoRef.current);
    if (!autoScan) { setNextScan(null); return; }
    const ms = autoInterval * 3600000;
    setNextScan(new Date(Date.now() + ms));
    autoRef.current = setInterval(async () => { await scanAll(); setNextScan(new Date(Date.now() + ms)); }, ms);
    return () => clearInterval(autoRef.current);
  }, [autoScan, autoInterval, scanAll]);

  // ── Analyze asset (crypto via Crypto.com MCP, stock via direct) ──────────────
  const analyzeAsset = useCallback(async (symbol, data, type) => {
    setAnalyzingAsset(symbol);
    try {
      let parsed = null;
      if (type === "crypto" && CRYPTO_INSTRUMENTS[symbol]) {
        // Use Crypto.com MCP for real-time analysis
        parsed = await analyzeWithCryptoCom(symbol, CRYPTO_INSTRUMENTS[symbol]);
      }
      if (!parsed) {
        // Fallback for stocks or if MCP fails
        parsed = await analyzeStockAsset(symbol, data.price, data.change);
      }
      if (!parsed) return;

      // Update price if MCP returned it
      if (parsed.price && type === "crypto") {
        setCryptoPrices(prev => ({ ...prev, [symbol]: { ...prev[symbol], price: parsed.price, change: parsed.change || prev[symbol]?.change } }));
      }

      setTradingSignals(prev => ({ ...prev, [symbol]: parsed }));

      if (parsed.signal === "BUY" || parsed.signal === "SELL") {
        await dispatchAlert({
          id: Date.now(), type: "TRADE", symbol,
          signal: parsed.signal, price: parsed.price || data.price,
          confidence: parsed.confidence, reasoning: parsed.reasoning,
          entry: parsed.entry, stop_loss: parsed.stop_loss, take_profit: parsed.take_profit,
          time: new Date().toLocaleTimeString("it-IT"),
          color: parsed.signal === "BUY" ? "#00ff9f" : "#ff4d6d",
        });
      }
    } catch (e) { console.error(e); }
    finally { setAnalyzingAsset(null); }
  }, [dispatchAlert]);

  const allAssets = [
    ...Object.entries(cryptoPrices).map(([sym, d]) => ({ sym, ...d, type: "crypto" })),
    ...Object.entries(MOCK_STOCKS).map(([sym, d]) => ({ sym, ...d, type: "stock" })),
  ];

  const trendAlerts = alerts.filter(a => a.type === "TREND");
  const tradeAlerts = alerts.filter(a => a.type === "TRADE");

  return (
    <div style={{ minHeight: "100vh", background: "#06090e", color: "#b8c8d4", fontFamily: "'Segoe UI', sans-serif" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Mono:wght@400;700&family=Syne:wght@400;700;800&display=swap');
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.25}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
        @keyframes scan{0%{transform:translateY(-100%)}100%{transform:translateY(100vh)}}
        *{box-sizing:border-box;margin:0;padding:0}
        ::-webkit-scrollbar{width:3px}::-webkit-scrollbar-thumb{background:#1a2535}
        input,select{outline:none}
      `}</style>

      {/* Background grid + scanline */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(0,255,159,0.018) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,159,0.018) 1px,transparent 1px)", backgroundSize: "32px 32px" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg,transparent,#00ff9f22,transparent)", animation: "scan 8s linear infinite", opacity: 0.4 }} />
      </div>

      {/* HEADER */}
      <div style={{ position: "sticky", top: 0, zIndex: 200, borderBottom: "1px solid #1a2535", background: "#06090eee", backdropFilter: "blur(12px)", padding: "12px 24px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
            <div>
              <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 15, color: "#00ff9f", letterSpacing: "0.2em" }}>SIGNAL//OPS <span style={{ fontSize: 9, color: "#2a6a4a", letterSpacing: "0.1em" }}>v2</span></div>
              <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#2a4a3a", letterSpacing: "0.1em" }}>TREND · MARKETS · CRYPTO.COM · GMAIL · CALENDAR</div>
            </div>
            <div style={{ display: "flex", gap: 3 }}>
              {[["radar", "📡 RADAR"], ["markets", "📈 MARKETS"]].map(([key, label]) => (
                <button key={key} onClick={() => setView(key)} style={{ padding: "5px 14px", border: `1px solid ${view === key ? "#00ff9f44" : "#1a2535"}`, borderRadius: 4, background: view === key ? "#00ff9f18" : "transparent", color: view === key ? "#00ff9f" : "#2a4a5a", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "'Space Mono', monospace" }}>{label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
            {/* Integration status dots */}
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              {[["TG", !!tgCfg.token, "#00ff9f"], ["MAIL", !!gmailCfg.email, "#4cc9f0"], ["CAL", calendarEnabled, "#ffd166"], ["C.COM", true, "#f72585"]].map(([l, on, c]) => (
                <div key={l} title={l} style={{ display: "flex", alignItems: "center", gap: 3 }}>
                  <div style={{ width: 5, height: 5, borderRadius: "50%", background: on ? c : "#1a2535", boxShadow: on ? `0 0 6px ${c}` : "none" }} />
                  <span style={{ fontSize: 8, fontFamily: "monospace", color: on ? c : "#1a2535" }}>{l}</span>
                </div>
              ))}
            </div>
            {[["TREND", trendAlerts.length, "#4cc9f0"], ["TRADE", tradeAlerts.length, "#00ff9f"], ["TOT", alerts.length, "#ffd166"]].map(([l, v, c]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 8, color: "#1a3a3a", fontFamily: "'Space Mono', monospace" }}>{l}</div>
                <div style={{ fontSize: 15, fontWeight: 700, color: c, fontFamily: "'Space Mono', monospace" }}>{v}</div>
              </div>
            ))}
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 10, color: "#1a4a3a", fontFamily: "'Space Mono', monospace" }}>
              <Pulse color="#00ff9f" />
              {lastScan ? lastScan.toLocaleTimeString("it-IT") : "NO SCAN"}
            </div>
          </div>
        </div>
      </div>

      {/* BODY */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 340px", height: "calc(100vh - 57px)", position: "relative", zIndex: 1 }}>

        {/* MAIN */}
        <div style={{ overflowY: "auto", padding: "20px 24px", borderRight: "1px solid #1a2535" }}>

          {/* RADAR */}
          {view === "radar" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: "#c8d3dc" }}>Trend Intelligence Radar</div>
                  <div style={{ fontSize: 10, color: "#2a4a3a", marginTop: 2, fontFamily: "'Space Mono', monospace" }}>HackerNews · Reddit · Claude AI · 5 topic strategici</div>
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button onClick={scanAll} disabled={!!scanning} style={{ padding: "7px 18px", border: "1px solid #00ff9f44", background: scanning ? "#00ff9f18" : "#00ff9f0a", color: scanning ? "#00ff9f" : "#4a8a5a", fontSize: 10, fontWeight: 700, borderRadius: 5, cursor: scanning ? "not-allowed" : "pointer", fontFamily: "'Space Mono', monospace" }}>
                    {scanning ? `SCANNING ${TOPICS[scanning]?.short}...` : "⬡ SCAN ALL"}
                  </button>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "5px 10px", border: `1px solid ${autoScan ? "#4cc9f044" : "#1a2535"}`, borderRadius: 5, background: autoScan ? "#4cc9f010" : "transparent" }}>
                    <span style={{ fontSize: 9, color: autoScan ? "#4cc9f0" : "#2a4a5a", fontFamily: "'Space Mono', monospace" }}>AUTO</span>
                    <div onClick={() => setAutoScan(a => !a)} style={{ width: 26, height: 13, borderRadius: 7, background: autoScan ? "#4cc9f044" : "#1a2535", cursor: "pointer", position: "relative", transition: "background 0.3s" }}>
                      <div style={{ position: "absolute", top: 2, left: autoScan ? 13 : 2, width: 9, height: 9, borderRadius: "50%", background: autoScan ? "#4cc9f0" : "#2a4a5a", transition: "left 0.3s" }} />
                    </div>
                    <select value={autoInterval} onChange={e => setAutoInterval(Number(e.target.value))} style={{ background: "transparent", border: "none", color: autoScan ? "#4cc9f0" : "#2a4a5a", fontSize: 9, fontFamily: "'Space Mono', monospace", cursor: "pointer" }}>
                      {[1,3,6,12,24].map(h => <option key={h} value={h} style={{ background: "#0d1520" }}>{h}h</option>)}
                    </select>
                  </div>
                  {autoScan && nextScan && <span style={{ fontSize: 9, color: "#1a4a3a", fontFamily: "'Space Mono', monospace" }}>next {nextScan.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}</span>}
                </div>
              </div>

              {Object.entries(TOPICS).map(([key, topic]) => {
                const td = trendData[key];
                const arts = trendArticles[key] || [];
                const isScanning = scanning === key;
                const isExp = expandedTopic === key;
                return (
                  <div key={key} style={{ background: td ? `${topic.color}06` : "#0a0f16", border: `1px solid ${td ? topic.color + "22" : "#1a2535"}`, borderRadius: 8, padding: "13px 15px", marginBottom: 10, animation: "fadeUp 0.4s ease" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", alignItems: "center", gap: 10 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                          <Pulse color={isScanning ? "#ffd166" : td ? topic.color : "#1a3535"} />
                          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: "#e8e8e8" }}>{topic.label}</span>
                          {td && <Badge label={`${MOM_ICON[td.momentum] || ""} ${(td.momentum || "").toUpperCase()}`} color={td.momentum === "accelerating" ? "#00ff9f" : td.momentum === "decelerating" ? "#ff4d6d" : "#ffd166"} />}
                        </div>
                        <div style={{ fontSize: 10, color: "#2a4a3a", marginTop: 2, fontFamily: "'Space Mono', monospace" }}>
                          {arts.length > 0 ? `${arts.length} articoli rilevanti` : "Non ancora scansionato"}
                          {td && ` · conf ${td.confidence}%`}
                        </div>
                      </div>
                      {td && <div style={{ textAlign: "center" }}><div style={{ fontSize: 22, fontWeight: 700, color: topic.color, fontFamily: "'Space Mono', monospace" }}>{td.score}</div><div style={{ fontSize: 8, color: "#1a3a2a", fontFamily: "'Space Mono', monospace" }}>SCORE</div></div>}
                      {td ? <Badge label={td.signal} color={SIG_COLORS[td.signal] || "#888"} /> : (
                        <button onClick={() => scanTopic(key)} disabled={isScanning} style={{ padding: "4px 10px", border: "1px solid #1a3a2a", background: isScanning ? "#1a3a2a" : "transparent", color: isScanning ? "#00ff9f" : "#3a5a4a", fontSize: 9, borderRadius: 4, cursor: "pointer", fontFamily: "'Space Mono', monospace" }}>{isScanning ? "..." : "SCAN"}</button>
                      )}
                      <button onClick={() => setExpandedTopic(isExp ? null : key)} style={{ padding: "4px 8px", border: "1px solid #1a2535", background: "transparent", color: "#2a4a5a", fontSize: 9, borderRadius: 4, cursor: "pointer", fontFamily: "'Space Mono', monospace" }}>{isExp ? "▲" : "▼"}</button>
                    </div>
                    {td && <ScoreBar score={td.score} color={topic.color} />}
                    {td && <div style={{ fontSize: 11, color: "#5a8a6a", lineHeight: 1.7, marginTop: 3 }}>{td.summary}{td.catalyst && <span style={{ color: "#3a6a5a" }}> — <i>{td.catalyst}</i></span>}</div>}
                    {isExp && (
                      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid #1a2535" }}>
                        <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
                          <span style={{ fontSize: 9, color: "#1a3a2a", fontFamily: "'Space Mono', monospace", alignSelf: "center" }}>INVESTABLE:</span>
                          {topic.investable.map(a => <Badge key={a} label={a} color={topic.color} />)}
                        </div>
                        <div style={{ fontSize: 11, color: "#3a6a5a", lineHeight: 1.7, marginBottom: 8, fontStyle: "italic" }}>"{topic.thesis}"</div>
                        {arts.slice(0, 5).map((a, i) => (
                          <div key={i} style={{ padding: "5px 0", borderBottom: "1px solid #0d1520", fontSize: 11, color: "#4a6a5a", display: "flex", justifyContent: "space-between", gap: 8 }}>
                            <span style={{ flex: 1 }}>{a.title}</span>
                            <span style={{ fontSize: 9, color: "#1a3a2a", fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap" }}>{a.source}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* MARKETS */}
          {view === "markets" && (
            <div>
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: "#c8d3dc" }}>Trading Dashboard</div>
                <div style={{ fontSize: 10, color: "#2a4a3a", marginTop: 2, fontFamily: "'Space Mono', monospace" }}>Crypto: analisi via <span style={{ color: "#f72585" }}>Crypto.com MCP</span> · Azioni: AI quantitativa</div>
              </div>
              {allAssets.map(asset => {
                const sig = tradingSignals[asset.sym];
                const loading = analyzingAsset === asset.sym;
                const sc = sig ? (SIG_COLORS[sig.signal] || "#888") : null;
                return (
                  <div key={asset.sym} style={{ background: sc ? `${sc}07` : "#0a0f16", border: `1px solid ${sc ? sc + "22" : "#1a2535"}`, borderRadius: 8, padding: "11px 14px", marginBottom: 8, transition: "all 0.3s" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", alignItems: "center", gap: 10 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={{ fontSize: 13, fontWeight: 700, color: "#e8e8e8", fontFamily: "'Space Mono', monospace" }}>{asset.sym}</span>
                          {asset.type === "crypto" && <span style={{ fontSize: 8, color: "#f72585", fontFamily: "'Space Mono', monospace", background: "#f7258511", padding: "1px 4px", borderRadius: 2 }}>C.COM</span>}
                        </div>
                        <div style={{ fontSize: 10, color: "#1a3a3a", marginTop: 1 }}>{asset.name || asset.sym} · {asset.type}</div>
                      </div>
                      <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, fontFamily: "'Space Mono', monospace", color: "#d8e8e0" }}>
                        {asset.price > 0 ? `$${asset.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
                      </div>
                      <div style={{ fontSize: 11, fontWeight: 600, color: (asset.change || 0) >= 0 ? "#00ff9f" : "#ff4d6d", fontFamily: "'Space Mono', monospace" }}>
                        {(asset.change || 0) >= 0 ? "▲" : "▼"} {Math.abs(asset.change || 0).toFixed(2)}%
                      </div>
                      {sig ? <Badge label={sig.signal} color={sc} /> : (
                        <button disabled={loading} onClick={() => !loading && analyzeAsset(asset.sym, asset, asset.type)} style={{ padding: "4px 10px", border: "1px solid #1a3a2a", background: loading ? "#1a3a2a" : "transparent", color: loading ? "#00ff9f" : "#3a5a4a", fontSize: 9, borderRadius: 3, cursor: "pointer", fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap" }}>{loading ? "..." : "ANALIZZA"}</button>
                      )}
                    </div>
                    {sig && (
                      <div style={{ marginTop: 8, padding: "8px 10px", background: "#050810", borderRadius: 4, borderLeft: `2px solid ${sc}44` }}>
                        <div style={{ fontSize: 11, color: "#5a8a6a", lineHeight: 1.6, marginBottom: 5 }}>{sig.reasoning}</div>
                        <div style={{ display: "flex", gap: 12, fontSize: 10, fontFamily: "'Space Mono', monospace" }}>
                          <span style={{ color: "#2a4a3a" }}>CONF {sig.confidence}%</span>
                          {sig.entry && <span style={{ color: "#3a6a4a" }}>E ${sig.entry}</span>}
                          {sig.stop_loss && <span style={{ color: "#6a2a2a" }}>SL ${sig.stop_loss}</span>}
                          {sig.take_profit && <span style={{ color: "#2a6a3a" }}>TP ${sig.take_profit}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* RIGHT PANEL */}
        <div style={{ overflowY: "auto", padding: 16, background: "#050810" }}>

          {/* Integrations */}
          <div style={{ fontSize: 9, color: "#1a3a3a", fontFamily: "'Space Mono', monospace", letterSpacing: "0.15em", marginBottom: 8 }}>⚙ INTEGRAZIONI</div>

          {/* Telegram */}
          <IntegrationRow icon="✈️" label="TELEGRAM" active={!!tgCfg.token}>
            <input value={tgCfg.token} onChange={e => setTgCfg(p => ({ ...p, token: e.target.value }))} placeholder="Bot Token" style={inputStyle} />
            <input value={tgCfg.chatId} onChange={e => setTgCfg(p => ({ ...p, chatId: e.target.value }))} placeholder="Chat ID" style={inputStyle} />
            <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
              <button onClick={async () => { const ok = await sendTelegram(tgCfg.token, tgCfg.chatId, "✅ *SIGNAL//OPS v2* connesso!"); alert(ok ? "✓ Inviato!" : "✗ Errore"); }} style={btnStyle("#00ff9f", !tgCfg.token)}>TEST</button>
            </div>
          </IntegrationRow>

          {/* Gmail */}
          <IntegrationRow icon="📧" label="GMAIL (solo STRONG_BUY)" active={!!gmailCfg.email}>
            <div style={{ fontSize: 10, color: "#4a6a5a", lineHeight: 1.7, marginBottom: 8, fontFamily: "monospace" }}>Email ricevuta solo per segnali con confidence ≥80% o STRONG_BUY.</div>
            <input value={gmailCfg.email} onChange={e => setGmailCfg({ email: e.target.value })} placeholder="La tua email Gmail" style={inputStyle} />
          </IntegrationRow>

          {/* Google Calendar */}
          <IntegrationRow icon="📅" label="GOOGLE CALENDAR" active={calendarEnabled}>
            <div style={{ fontSize: 10, color: "#4a6a5a", lineHeight: 1.7, marginBottom: 8, fontFamily: "monospace" }}>Ogni segnale BUY viene loggato nel calendario per tenere traccia dello storico.</div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div onClick={() => setCalendarEnabled(a => !a)} style={{ width: 28, height: 14, borderRadius: 7, background: calendarEnabled ? "#ffd16644" : "#1a2535", cursor: "pointer", position: "relative" }}>
                <div style={{ position: "absolute", top: 2, left: calendarEnabled ? 14 : 2, width: 10, height: 10, borderRadius: "50%", background: calendarEnabled ? "#ffd166" : "#2a4a5a", transition: "left 0.3s" }} />
              </div>
              <span style={{ fontSize: 10, color: calendarEnabled ? "#ffd166" : "#2a4a5a", fontFamily: "monospace" }}>{calendarEnabled ? "Attivo" : "Disattivo"}</span>
            </div>
          </IntegrationRow>

          {/* Crypto.com status */}
          <div style={{ padding: "8px 12px", background: "#0a050f", border: "1px solid #f7258522", borderRadius: 5, marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: "#f72585", fontFamily: "monospace", fontWeight: 700 }}>◈ CRYPTO.COM MCP <span style={{ color: "#00ff9f" }}>● ATTIVO</span></div>
            <div style={{ fontSize: 9, color: "#4a2a4a", marginTop: 2, fontFamily: "monospace" }}>Analisi crypto via MCP real-time. Nessuna configurazione richiesta.</div>
          </div>

          {/* Alert feed */}
          <div style={{ fontSize: 9, color: "#1a3a3a", fontFamily: "'Space Mono', monospace", letterSpacing: "0.15em", marginBottom: 8, marginTop: 4, display: "flex", justifyContent: "space-between" }}>
            <span>⚡ ALERT ({alerts.length})</span>
            {alerts.length > 0 && <button onClick={() => setAlerts([])} style={{ fontSize: 9, color: "#1a3a3a", background: "none", border: "none", cursor: "pointer", fontFamily: "monospace" }}>CLEAR</button>}
          </div>

          {alerts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "24px 0", color: "#1a3a2a", fontSize: 10, fontFamily: "'Space Mono', monospace", lineHeight: 2.2 }}>Feed vuoto.<br />Scan un topic o analizza<br />un asset per iniziare.</div>
          ) : alerts.map(a => (
            <div key={a.id} style={{ background: "#080d14", border: `1px solid ${a.color}1a`, borderLeft: `3px solid ${a.color}55`, borderRadius: 6, padding: "10px 12px", marginBottom: 7, animation: "fadeUp 0.3s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap" }}>
                  <span style={{ fontSize: 9, fontFamily: "monospace", color: "#1a3a3a", background: "#0d1520", padding: "1px 4px", borderRadius: 2 }}>{a.type}</span>
                  <span style={{ fontWeight: 700, color: "#d8e8e0", fontFamily: "'Space Mono', monospace", fontSize: 12 }}>{a.topicLabel || a.symbol}</span>
                  <Badge label={a.signal} color={SIG_COLORS[a.signal] || a.color} />
                  {tgSent[a.id] && <span title="Telegram">✈️</span>}
                  {gmailSent[a.id] && <span title="Gmail">📧</span>}
                  {calSent[a.id] && <span title="Calendar">📅</span>}
                </div>
                <span style={{ fontSize: 9, color: "#1a3a2a", fontFamily: "'Space Mono', monospace" }}>{a.time}</span>
              </div>
              {a.type === "TREND" && (
                <div>
                  <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: a.color, fontFamily: "'Space Mono', monospace" }}>{a.score}</span>
                    <span style={{ fontSize: 8, color: "#1a4a3a" }}>score</span>
                    {a.momentum && <Badge label={`${MOM_ICON[a.momentum]} ${a.momentum}`} color={a.momentum === "accelerating" ? "#00ff9f" : "#ffd166"} />}
                  </div>
                  {a.summary && <div style={{ fontSize: 11, color: "#4a7a5a", lineHeight: 1.6, marginBottom: 4 }}>{a.summary}</div>}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {(a.investable || []).map(t => <Badge key={t} label={t} color={a.color} />)}
                  </div>
                </div>
              )}
              {a.type === "TRADE" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#c8d3dc" }}>${Number(a.price || 0).toFixed(2)}</span>
                    <span style={{ fontSize: 10, color: "#1a4a3a", fontFamily: "'Space Mono', monospace" }}>CONF {a.confidence}%</span>
                  </div>
                  {a.reasoning && <div style={{ fontSize: 11, color: "#4a7a5a", lineHeight: 1.5, marginBottom: 4 }}>{a.reasoning}</div>}
                  <div style={{ display: "flex", gap: 8, fontSize: 10, fontFamily: "'Space Mono', monospace" }}>
                    {a.entry && <span style={{ color: "#2a5a3a" }}>E ${a.entry}</span>}
                    {a.stop_loss && <span style={{ color: "#5a2a2a" }}>SL ${a.stop_loss}</span>}
                    {a.take_profit && <span style={{ color: "#1a5a2a" }}>TP ${a.take_profit}</span>}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Quick scan */}
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 9, color: "#1a3a3a", fontFamily: "'Space Mono', monospace", letterSpacing: "0.15em", marginBottom: 6 }}>SCAN RAPIDO</div>
            {Object.entries(TOPICS).map(([key, topic]) => {
              const td = trendData[key];
              return (
                <div key={key} onClick={() => !scanning && scanTopic(key)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: "1px solid #0d1520", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    <Pulse color={scanning === key ? "#ffd166" : td ? topic.color : "#1a2535"} size={5} />
                    <span style={{ fontSize: 10, color: td ? "#8a9aaa" : "#2a4a3a" }}>{topic.short}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                    {td && <span style={{ fontSize: 11, fontWeight: 700, color: topic.color, fontFamily: "'Space Mono', monospace" }}>{td.score}</span>}
                    {td && <Badge label={td.signal} color={SIG_COLORS[td.signal]} />}
                    {!td && <span style={{ fontSize: 8, color: "#1a3a2a", fontFamily: "'Space Mono', monospace" }}>—</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 12, padding: "8px 10px", background: "#080d14", borderRadius: 5, border: "1px solid #1a2030" }}>
            <div style={{ fontSize: 9, color: "#1a3a2a", lineHeight: 1.8, fontFamily: "'Space Mono', monospace" }}>⚠ Segnali AI su dati pubblici.<br />Non consulenza finanziaria.<br />Verifica sempre prima di investire.</div>
          </div>
        </div>
      </div>
    </div>
  );
}
