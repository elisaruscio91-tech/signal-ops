import { useState, useEffect, useCallback, useRef } from "react";

// ─── TOPICS CONFIG ────────────────────────────────────────────────────────────
const TOPICS = {
  GPU_INFRA: {
    label: "GPU / ML Infrastructure",
    short: "GPU INFRA",
    color: "#00ff9f",
    keywords: ["nvidia", "gpu cluster", "h100", "blackwell", "data center gpu", "inference infrastructure", "compute cluster", "tpu", "ai accelerator"],
    subreddits: ["MachineLearning", "hardware", "artificial"],
    investable: ["NVDA", "AMD", "INTC", "SMCI"],
    thesis: "La domanda di compute per AI continua a crescere. Ogni nuovo modello richiede 10x il compute del precedente.",
  },
  COOLING: {
    label: "Data Center Cooling",
    short: "COOLING",
    color: "#4cc9f0",
    keywords: ["liquid cooling", "immersion cooling", "data center water", "thermal management", "cooling infrastructure", "pue", "water usage effectiveness"],
    subreddits: ["hardware", "sysadmin", "datacenter"],
    investable: ["VRT", "CARR", "JCI"],
    thesis: "Ogni GPU H100 consuma 700W. I data center stanno esaurendo capacità di raffreddamento ad aria. La transizione al liquid cooling è strutturale.",
  },
  HBM: {
    label: "HBM / Memory",
    short: "HBM",
    color: "#f72585",
    keywords: ["hbm", "hbm3", "high bandwidth memory", "sk hynix", "memory bandwidth", "micron hbm", "gddr7", "memory subsystem"],
    subreddits: ["hardware", "stocks", "investing"],
    investable: ["MU", "000660.KS"],
    thesis: "HBM è il collo di bottiglia per LLM. SK Hynix e Micron hanno quasi monopolio sulla produzione, con backlog di 18+ mesi.",
  },
  DATA_GOV: {
    label: "Data Governance",
    short: "DATA GOV",
    color: "#ffd166",
    keywords: ["data governance", "data catalog", "data mesh", "data lineage", "gdpr enforcement", "data sovereignty", "master data management", "data fabric"],
    subreddits: ["dataengineering", "datascience", "investing"],
    investable: ["INFA", "MSFT", "SNOW"],
    thesis: "Regolamentazione AI e GDPR rendono la governance dati da costo a requisito legale. Il mercato è nascente e poco prezzato.",
  },
  WATER: {
    label: "Water Infrastructure",
    short: "WATER",
    color: "#06d6a0",
    keywords: ["water scarcity", "desalination", "water infrastructure", "water stress", "groundwater", "water technology", "water purification", "drought", "water data center"],
    subreddits: ["environment", "investing", "Futurology", "climate"],
    investable: ["XYL", "WTRG", "PHO", "VIE.PA"],
    thesis: "2050: 5 miliardi di persone in aree con stress idrico. I data center usano miliardi di litri d'acqua per raffreddamento. L'acqua diventa asset strategico.",
  },
};

const CRYPTO_IDS = { BTC: "bitcoin", ETH: "ethereum", SOL: "solana" };

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

// ─── HN FETCH ─────────────────────────────────────────────────────────────────
async function fetchHNStories(limit = 30) {
  try {
    const ids = await fetch("https://hacker-news.firebaseio.com/v0/topstories.json").then(r => r.json());
    const slice = ids.slice(0, limit);
    const stories = await Promise.all(
      slice.map(id => fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`).then(r => r.json()).catch(() => null))
    );
    return stories.filter(Boolean).map(s => ({ title: s.title || "", url: s.url || "", score: s.score || 0, source: "HackerNews" }));
  } catch { return []; }
}

// ─── REDDIT FETCH ─────────────────────────────────────────────────────────────
async function fetchReddit(sub, limit = 10) {
  try {
    const data = await fetch(`https://www.reddit.com/r/${sub}/hot.json?limit=${limit}`, {
      headers: { "User-Agent": "SignalOps/1.0" }
    }).then(r => r.json());
    return (data?.data?.children || []).map(c => ({
      title: c.data.title || "",
      url: c.data.url || "",
      score: c.data.score || 0,
      source: `r/${sub}`,
    }));
  } catch { return []; }
}

// ─── SCORE ARTICLES LOCALLY ───────────────────────────────────────────────────
function scoreArticles(articles, keywords) {
  return articles
    .map(a => {
      const text = a.title.toLowerCase();
      const hits = keywords.filter(k => text.includes(k.toLowerCase())).length;
      return { ...a, relevance: hits };
    })
    .filter(a => a.relevance > 0)
    .sort((a, b) => b.relevance - a.relevance);
}

// ─── CLAUDE TREND ANALYSIS ────────────────────────────────────────────────────
async function analyzeTrend(topicKey, topic, articles) {
  const titles = articles.slice(0, 12).map(a => `- [${a.source}] ${a.title}`).join("\n");
  const prompt = `Sei un analista di trend tecnologici e finanziari.

Topic: ${topic.label}
Tesi di investimento: ${topic.thesis}
Asset investibili: ${topic.investable.join(", ")}

Articoli recenti trovati online su questo topic:
${titles || "Nessun articolo trovato nelle ultime ore."}

Analizza il momentum attuale di questo trend e rispondi SOLO con JSON valido:
{
  "score": 0-100,
  "momentum": "accelerating|stable|decelerating",
  "signal": "STRONG_BUY|BUY|WATCH|HOLD|AVOID",
  "summary": "2 frasi max sul trend attuale",
  "catalyst": "evento o dato specifico più rilevante trovato",
  "timeframe": "short|medium|long",
  "confidence": 0-100
}`;

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

// ─── CRYPTO FETCH ─────────────────────────────────────────────────────────────
async function fetchCrypto() {
  try {
    const ids = Object.values(CRYPTO_IDS).join(",");
    const data = await fetch(`https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`).then(r => r.json());
    const out = {};
    Object.entries(CRYPTO_IDS).forEach(([sym, id]) => {
      if (data[id]) out[sym] = { price: data[id].usd, change: data[id].usd_24h_change };
    });
    return out;
  } catch { return {}; }
}

const MOCK_STOCKS = {
  NVDA: { price: 875.4, change: 2.3, name: "NVIDIA" },
  TSLA: { price: 177.9, change: -1.8, name: "Tesla" },
  XYL:  { price: 118.2, change: 0.9, name: "Xylem" },
  MU:   { price: 96.4,  change: 1.4, name: "Micron" },
  VRT:  { price: 88.7,  change: 3.2, name: "Vertiv" },
};

const SIG_COLORS = { STRONG_BUY: "#00ff9f", BUY: "#4cc9f0", WATCH: "#ffd166", HOLD: "#888", AVOID: "#ff4d6d", BUY_: "#00ff9f", SELL: "#ff4d6d" };
const MOM_ICON = { accelerating: "▲▲", stable: "▶", decelerating: "▼" };

// ─── COMPONENTS ───────────────────────────────────────────────────────────────
function Pulse({ color }) {
  return <span style={{ display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: color, boxShadow: `0 0 8px ${color}`, animation: "pulse 2s infinite", marginRight: 6 }} />;
}

function ScoreBar({ score, color }) {
  return (
    <div style={{ height: 3, background: "#1a2535", borderRadius: 2, overflow: "hidden", margin: "6px 0" }}>
      <div style={{ height: "100%", width: `${score}%`, background: `linear-gradient(90deg, ${color}88, ${color})`, borderRadius: 2, transition: "width 1s ease" }} />
    </div>
  );
}

function Badge({ label, color }) {
  return <span style={{ padding: "2px 7px", borderRadius: 3, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", fontFamily: "monospace", background: `${color || "#888"}22`, color: color || "#888", border: `1px solid ${color || "#888"}44` }}>{label}</span>;
}

function TgPanel({ cfg, onChange }) {
  const [open, setOpen] = useState(false);
  const [tok, setTok] = useState(cfg.token);
  const [cid, setCid] = useState(cfg.chatId);
  const [status, setStatus] = useState(null);

  const test = async () => {
    setStatus("testing");
    const ok = await sendTelegram(tok, cid, `✅ *SIGNAL//OPS* connesso!\n\nRiceverai alert da:\n• Trend Radar (5 topic)\n• Trading Dashboard\n\nTutto in un feed unificato.`);
    setStatus(ok ? "ok" : "fail");
  };

  const inp = { width: "100%", padding: "7px 10px", background: "#0d1520", border: "1px solid #1a2535", borderRadius: 4, color: "#c8d3dc", fontSize: 11, fontFamily: "monospace", outline: "none", marginTop: 5 };

  return (
    <div style={{ marginBottom: 12 }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "9px 13px", background: cfg.token ? "#0a1a12" : "#13100a", border: `1px solid ${cfg.token ? "#00ff9f33" : "#ffd16633"}`, borderRadius: open ? "6px 6px 0 0" : 6, cursor: "pointer" }}>
        <span style={{ fontSize: 11, fontWeight: 700, fontFamily: "monospace", color: cfg.token ? "#00ff9f" : "#ffd166" }}>✈️ TELEGRAM {cfg.token ? "● LIVE" : "○ OFF"}</span>
        <span style={{ color: "#2a4a3a", fontSize: 10 }}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{ padding: 13, background: "#050810", border: "1px solid #1a2535", borderTop: "none", borderRadius: "0 0 6px 6px" }}>
          <div style={{ fontSize: 10, color: "#4a7a5a", lineHeight: 1.9, marginBottom: 10, fontFamily: "monospace" }}>
            @BotFather → /newbot → copia token<br/>@userinfobot → copia chat ID
          </div>
          <input value={tok} onChange={e => setTok(e.target.value)} placeholder="Bot Token" style={inp} />
          <input value={cid} onChange={e => setCid(e.target.value)} placeholder="Chat ID" style={inp} />
          <div style={{ display: "flex", gap: 6, marginTop: 10 }}>
            <button onClick={() => { onChange({ token: tok, chatId: cid }); setOpen(false); }} style={{ padding: "6px 14px", border: "1px solid #00ff9f44", background: "#00ff9f18", color: "#00ff9f", fontSize: 11, fontWeight: 700, borderRadius: 4, cursor: "pointer", fontFamily: "monospace" }}>SALVA</button>
            <button onClick={test} disabled={!tok || !cid} style={{ padding: "6px 14px", border: "1px solid #ffd16644", background: "#ffd16618", color: !tok || !cid ? "#2a4a3a" : "#ffd166", fontSize: 11, fontWeight: 700, borderRadius: 4, cursor: "pointer", fontFamily: "monospace" }}>TEST</button>
          </div>
          {status && <div style={{ marginTop: 8, fontSize: 10, fontFamily: "monospace", color: status === "ok" ? "#00ff9f" : status === "testing" ? "#ffd166" : "#ff4d6d" }}>{status === "ok" ? "✓ Inviato!" : status === "testing" ? "..." : "✗ Errore"}</div>}
        </div>
      )}
    </div>
  );
}

// ─── MAIN APP ─────────────────────────────────────────────────────────────────
export default function SignalOps() {
  const [view, setView] = useState("radar");
  const [trendData, setTrendData] = useState({});
  const [trendArticles, setTrendArticles] = useState({});
  const [scanning, setScanning] = useState(null);
  const [lastScan, setLastScan] = useState(null);
  const [crypto, setCrypto] = useState({});
  const [tradingSignals, setTradingSignals] = useState({});
  const [analyzingAsset, setAnalyzingAsset] = useState(null);
  const [alerts, setAlerts] = useState([]);
  const [tgCfg, setTgCfg] = useState({ token: "", chatId: "" });
  const [tgSent, setTgSent] = useState({});
  const [expandedTopic, setExpandedTopic] = useState(null);
  const [autoScan, setAutoScan] = useState(false);
  const [autoInterval, setAutoInterval] = useState(6); // hours
  const [nextScan, setNextScan] = useState(null);
  const autoScanRef = useRef(null);

  // Fetch crypto
  useEffect(() => {
    fetchCrypto().then(setCrypto);
    const i = setInterval(() => fetchCrypto().then(setCrypto), 30000);
    return () => clearInterval(i);
  }, []);

  // Scan single topic
  const scanTopic = useCallback(async (key) => {
    setScanning(key);
    const topic = TOPICS[key];
    try {
      // Fetch from multiple sources in parallel
      const [hnStories, ...redditResults] = await Promise.all([
        fetchHNStories(60),
        ...topic.subreddits.map(sub => fetchReddit(sub, 15)),
      ]);
      const allArticles = [...hnStories, ...redditResults.flat()];
      const relevant = scoreArticles(allArticles, topic.keywords);
      setTrendArticles(prev => ({ ...prev, [key]: relevant }));

      // AI analysis
      const analysis = await analyzeTrend(key, topic, relevant);
      if (analysis) {
        setTrendData(prev => ({ ...prev, [key]: { ...analysis, scannedAt: new Date() } }));

        // Generate alert if strong signal
        if (analysis.signal === "STRONG_BUY" || analysis.signal === "BUY") {
          const alert = {
            id: Date.now(),
            type: "TREND",
            topic: key,
            topicLabel: topic.short,
            signal: analysis.signal,
            score: analysis.score,
            momentum: analysis.momentum,
            summary: analysis.summary,
            catalyst: analysis.catalyst,
            investable: topic.investable,
            time: new Date().toLocaleTimeString("it-IT"),
            color: topic.color,
          };
          setAlerts(prev => [alert, ...prev].slice(0, 40));

          if (tgCfg.token && tgCfg.chatId) {
            const msg = `📡 *TREND RADAR — ${topic.short}*\n\n🎯 Segnale: \`${analysis.signal}\`\nScore: \`${analysis.score}/100\` ${MOM_ICON[analysis.momentum] || ""}\n\n💡 ${analysis.summary}\n\n⚡ Catalyst: _${analysis.catalyst}_\n\n🏦 Asset: ${topic.investable.map(a => `\`${a}\``).join(" ")}\n\n⏱ ${new Date().toLocaleTimeString("it-IT")}`;
            const ok = await sendTelegram(tgCfg.token, tgCfg.chatId, msg);
            if (ok) setTgSent(prev => ({ ...prev, [alert.id]: true }));
          }
        }
      }
    } catch (e) { console.error(e); }
    finally { setScanning(null); }
  }, [tgCfg]);

  // Scan all topics
  const scanAll = useCallback(async () => {
    for (const key of Object.keys(TOPICS)) {
      await scanTopic(key);
      await new Promise(r => setTimeout(r, 800));
    }
    setLastScan(new Date());
  }, [scanTopic]);

  // Auto-scan interval
  useEffect(() => {
    if (autoScanRef.current) clearInterval(autoScanRef.current);
    if (!autoScan) { setNextScan(null); return; }
    const ms = autoInterval * 60 * 60 * 1000;
    const next = new Date(Date.now() + ms);
    setNextScan(next);
    autoScanRef.current = setInterval(async () => {
      await scanAll();
      setNextScan(new Date(Date.now() + ms));
    }, ms);
    return () => clearInterval(autoScanRef.current);
  }, [autoScan, autoInterval, scanAll]);

  // Analyze trading asset
  const analyzeAsset = useCallback(async (symbol, data, type) => {
    setAnalyzingAsset(symbol);
    try {
      const prompt = `Sei un analista quantitativo. Analizza ${symbol} (${type}):
- Prezzo: $${typeof data.price === "number" ? data.price.toFixed(2) : data.price}
- Variazione 24h: ${typeof data.change === "number" ? data.change.toFixed(2) : data.change}%
Rispondi SOLO con JSON valido:
{"signal":"BUY","confidence":75,"reasoning":"due frasi","entry":100,"stop_loss":90,"take_profit":115}
signal può essere: BUY, SELL, HOLD, WATCH`;

      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: "claude-sonnet-4-20250514", max_tokens: 1000, messages: [{ role: "user", content: prompt }] }),
      });
      const result = await res.json();
      const parsed = JSON.parse((result.content?.[0]?.text || "{}").replace(/```json|```/g, "").trim());
      setTradingSignals(prev => ({ ...prev, [symbol]: parsed }));

      if (parsed.signal === "BUY" || parsed.signal === "SELL") {
        const alert = {
          id: Date.now(),
          type: "TRADE",
          symbol,
          signal: parsed.signal,
          price: data.price,
          confidence: parsed.confidence,
          reasoning: parsed.reasoning,
          entry: parsed.entry,
          stop_loss: parsed.stop_loss,
          take_profit: parsed.take_profit,
          time: new Date().toLocaleTimeString("it-IT"),
          color: parsed.signal === "BUY" ? "#00ff9f" : "#ff4d6d",
        };
        setAlerts(prev => [alert, ...prev].slice(0, 40));

        if (tgCfg.token && tgCfg.chatId) {
          const emoji = parsed.signal === "BUY" ? "🟢" : "🔴";
          const msg = `${emoji} *TRADE SIGNAL — ${symbol}*\n\nSegnale: \`${parsed.signal}\`\n💰 Prezzo: \`$${Number(data.price).toFixed(2)}\`\nConfidence: \`${parsed.confidence}%\`\n${parsed.entry ? `🎯 Entry: \`$${parsed.entry}\`\n` : ""}${parsed.stop_loss ? `🛑 Stop: \`$${parsed.stop_loss}\`\n` : ""}${parsed.take_profit ? `✅ TP: \`$${parsed.take_profit}\`\n` : ""}\n💬 _${parsed.reasoning}_`;
          const ok = await sendTelegram(tgCfg.token, tgCfg.chatId, msg);
          if (ok) setTgSent(prev => ({ ...prev, [alert.id]: true }));
        }
      }
    } catch (e) { console.error(e); }
    finally { setAnalyzingAsset(null); }
  }, [tgCfg]);

  const allAssets = [
    ...Object.entries(crypto).map(([sym, d]) => ({ sym, ...d, type: "crypto" })),
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
        input{outline:none}
      `}</style>

      {/* Scanline effect */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0 }}>
        <div style={{ position: "absolute", inset: 0, backgroundImage: "linear-gradient(rgba(0,255,159,0.018) 1px,transparent 1px),linear-gradient(90deg,rgba(0,255,159,0.018) 1px,transparent 1px)", backgroundSize: "32px 32px" }} />
        <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 1, background: "linear-gradient(90deg, transparent, #00ff9f22, transparent)", animation: "scan 8s linear infinite", opacity: 0.4 }} />
      </div>

      {/* HEADER */}
      <div style={{ position: "sticky", top: 0, zIndex: 200, borderBottom: "1px solid #1a2535", background: "#06090eee", backdropFilter: "blur(12px)", padding: "12px 24px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div>
            <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 15, color: "#00ff9f", letterSpacing: "0.2em" }}>SIGNAL//OPS</div>
            <div style={{ fontFamily: "'Space Mono', monospace", fontSize: 9, color: "#2a4a3a", letterSpacing: "0.15em" }}>TREND RADAR + MARKETS</div>
          </div>
          <div style={{ display: "flex", gap: 3 }}>
            {[["radar", "📡 RADAR"], ["markets", "📈 MARKETS"]].map(([key, label]) => (
              <button key={key} onClick={() => setView(key)} style={{ padding: "5px 14px", border: `1px solid ${view === key ? "#00ff9f44" : "#1a2535"}`, borderRadius: 4, background: view === key ? "#00ff9f18" : "transparent", color: view === key ? "#00ff9f" : "#2a4a5a", fontSize: 10, fontWeight: 700, cursor: "pointer", fontFamily: "'Space Mono', monospace", letterSpacing: "0.1em" }}>{label}</button>
            ))}
          </div>
        </div>
        <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
          <div style={{ display: "flex", gap: 16 }}>
            {[["TREND", trendAlerts.length, "#4cc9f0"], ["TRADE", tradeAlerts.length, "#00ff9f"], ["TOT", alerts.length, "#ffd166"]].map(([l, v, c]) => (
              <div key={l} style={{ textAlign: "center" }}>
                <div style={{ fontSize: 8, color: "#1a3a3a", fontFamily: "'Space Mono', monospace", letterSpacing: "0.15em" }}>{l}</div>
                <div style={{ fontSize: 16, fontWeight: 700, color: c, fontFamily: "'Space Mono', monospace" }}>{v}</div>
              </div>
            ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 10, color: "#1a4a3a", fontFamily: "'Space Mono', monospace" }}>
            <Pulse color="#00ff9f" />
            {lastScan ? lastScan.toLocaleTimeString("it-IT") : "NO SCAN"}
          </div>
        </div>
      </div>

      {/* BODY */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 320px", height: "calc(100vh - 57px)", position: "relative", zIndex: 1 }}>

        {/* MAIN PANEL */}
        <div style={{ overflowY: "auto", padding: "20px 24px", borderRight: "1px solid #1a2535" }}>

          {/* ── RADAR VIEW ── */}
          {view === "radar" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
                <div>
                  <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: "#c8d3dc", letterSpacing: "0.05em" }}>Trend Intelligence Radar</div>
                  <div style={{ fontSize: 11, color: "#2a4a3a", marginTop: 2, fontFamily: "'Space Mono', monospace" }}>Fonti: HackerNews · Reddit · analisi AI su 5 topic</div>
                </div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  onClick={scanAll}
                  disabled={!!scanning}
                  style={{ padding: "8px 20px", border: "1px solid #00ff9f44", background: scanning ? "#00ff9f18" : "#00ff9f0a", color: scanning ? "#00ff9f" : "#4a8a5a", fontSize: 10, fontWeight: 700, borderRadius: 5, cursor: scanning ? "not-allowed" : "pointer", fontFamily: "'Space Mono', monospace", letterSpacing: "0.1em" }}
                >
                  {scanning ? `SCANNING ${TOPICS[scanning]?.short}...` : "⬡ SCAN ALL"}
                </button>
                <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 12px", border: `1px solid ${autoScan ? "#4cc9f044" : "#1a2535"}`, borderRadius: 5, background: autoScan ? "#4cc9f010" : "transparent" }}>
                  <span style={{ fontSize: 9, color: autoScan ? "#4cc9f0" : "#2a4a5a", fontFamily: "'Space Mono', monospace" }}>AUTO</span>
                  <div onClick={() => setAutoScan(a => !a)} style={{ width: 28, height: 14, borderRadius: 7, background: autoScan ? "#4cc9f044" : "#1a2535", cursor: "pointer", position: "relative", transition: "background 0.3s" }}>
                    <div style={{ position: "absolute", top: 2, left: autoScan ? 14 : 2, width: 10, height: 10, borderRadius: "50%", background: autoScan ? "#4cc9f0" : "#2a4a5a", transition: "left 0.3s" }} />
                  </div>
                  <select value={autoInterval} onChange={e => setAutoInterval(Number(e.target.value))} style={{ background: "transparent", border: "none", color: autoScan ? "#4cc9f0" : "#2a4a5a", fontSize: 9, fontFamily: "'Space Mono', monospace", cursor: "pointer", outline: "none" }}>
                    {[1, 3, 6, 12, 24].map(h => <option key={h} value={h} style={{ background: "#0d1520" }}>{h}h</option>)}
                  </select>
                </div>
                {autoScan && nextScan && (
                  <span style={{ fontSize: 9, color: "#1a4a3a", fontFamily: "'Space Mono', monospace" }}>
                    next {nextScan.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                )}
              </div>
              </div>

              {Object.entries(TOPICS).map(([key, topic]) => {
                const td = trendData[key];
                const arts = trendArticles[key] || [];
                const isScanning = scanning === key;
                const isExpanded = expandedTopic === key;

                return (
                  <div key={key} style={{ background: td ? `${topic.color}06` : "#0a0f16", border: `1px solid ${td ? topic.color + "22" : "#1a2535"}`, borderRadius: 8, padding: "14px 16px", marginBottom: 10, transition: "all 0.3s", animation: "fadeUp 0.4s ease" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", alignItems: "center", gap: 12 }}>
                      <div>
                        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                          <Pulse color={isScanning ? "#ffd166" : td ? topic.color : "#1a3535"} />
                          <span style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 13, color: "#e8e8e8" }}>{topic.label}</span>
                          {td && <Badge label={`${MOM_ICON[td.momentum] || ""} ${td.momentum?.toUpperCase()}`} color={td.momentum === "accelerating" ? "#00ff9f" : td.momentum === "decelerating" ? "#ff4d6d" : "#ffd166"} />}
                        </div>
                        <div style={{ fontSize: 11, color: "#2a4a3a", marginTop: 3, fontFamily: "'Space Mono', monospace" }}>
                          {arts.length > 0 ? `${arts.length} articoli rilevanti trovati` : "Non ancora scansionato"}
                          {td && ` · Confidence ${td.confidence}%`}
                        </div>
                      </div>

                      {td && (
                        <div style={{ textAlign: "center", minWidth: 50 }}>
                          <div style={{ fontSize: 22, fontWeight: 700, color: topic.color, fontFamily: "'Space Mono', monospace" }}>{td.score}</div>
                          <div style={{ fontSize: 9, color: "#2a4a3a", fontFamily: "'Space Mono', monospace" }}>SCORE</div>
                        </div>
                      )}

                      {td ? (
                        <Badge label={td.signal} color={SIG_COLORS[td.signal] || "#888"} />
                      ) : (
                        <button onClick={() => scanTopic(key)} disabled={isScanning} style={{ padding: "5px 12px", border: "1px solid #1a3a2a", background: isScanning ? "#1a3a2a" : "transparent", color: isScanning ? "#00ff9f" : "#3a5a4a", fontSize: 10, borderRadius: 4, cursor: "pointer", fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap" }}>
                          {isScanning ? "..." : "SCAN"}
                        </button>
                      )}

                      <button onClick={() => setExpandedTopic(isExpanded ? null : key)} style={{ padding: "5px 10px", border: "1px solid #1a2535", background: "transparent", color: "#2a4a5a", fontSize: 10, borderRadius: 4, cursor: "pointer", fontFamily: "'Space Mono', monospace" }}>
                        {isExpanded ? "▲" : "▼"}
                      </button>
                    </div>

                    {td && <ScoreBar score={td.score} color={topic.color} />}

                    {td && (
                      <div style={{ fontSize: 11, color: "#5a8a6a", lineHeight: 1.7, marginTop: 4 }}>
                        {td.summary}
                        {td.catalyst && <span style={{ color: "#3a6a5a" }}> — <i>{td.catalyst}</i></span>}
                      </div>
                    )}

                    {isExpanded && (
                      <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid #1a2535" }}>
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 }}>
                          <span style={{ fontSize: 10, color: "#2a4a3a", fontFamily: "'Space Mono', monospace" }}>INVESTABLE:</span>
                          {topic.investable.map(a => <Badge key={a} label={a} color={topic.color} />)}
                        </div>
                        <div style={{ fontSize: 11, color: "#3a6a5a", lineHeight: 1.7, marginBottom: 10, fontStyle: "italic" }}>"{topic.thesis}"</div>
                        {arts.length > 0 && (
                          <div>
                            <div style={{ fontSize: 9, color: "#1a3a2a", fontFamily: "'Space Mono', monospace", letterSpacing: "0.1em", marginBottom: 6 }}>ARTICOLI TROVATI</div>
                            {arts.slice(0, 5).map((a, i) => (
                              <div key={i} style={{ padding: "6px 0", borderBottom: "1px solid #0d1520", fontSize: 11, color: "#4a6a5a", display: "flex", justifyContent: "space-between", gap: 8 }}>
                                <span style={{ flex: 1 }}>{a.title}</span>
                                <span style={{ fontSize: 9, color: "#1a3a2a", fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap" }}>{a.source}</span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* ── MARKETS VIEW ── */}
          {view === "markets" && (
            <div>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontFamily: "'Syne', sans-serif", fontWeight: 700, fontSize: 14, color: "#c8d3dc" }}>Trading Dashboard</div>
                <div style={{ fontSize: 11, color: "#2a4a3a", marginTop: 2, fontFamily: "'Space Mono', monospace" }}>Crypto live (CoinGecko) · Azioni simulate · Analisi AI on-demand</div>
              </div>

              {allAssets.map(asset => {
                const sig = tradingSignals[asset.sym];
                const loading = analyzingAsset === asset.sym;
                const sc = sig ? (SIG_COLORS[sig.signal + "_"] || SIG_COLORS[sig.signal]) : null;
                return (
                  <div key={asset.sym} style={{ background: sc ? `${sc}07` : "#0a0f16", border: `1px solid ${sc ? sc + "25" : "#1a2535"}`, borderRadius: 8, padding: "11px 14px", marginBottom: 8, transition: "all 0.3s" }}>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto auto", alignItems: "center", gap: 12 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: "#e8e8e8", fontFamily: "'Space Mono', monospace" }}>{asset.sym}</div>
                        <div style={{ fontSize: 10, color: "#1a3a3a", marginTop: 1 }}>{asset.name || asset.sym} · {asset.type}</div>
                      </div>
                      <div style={{ textAlign: "right", fontSize: 13, fontWeight: 600, fontFamily: "'Space Mono', monospace", color: "#d8e8e0" }}>
                        ${typeof asset.price === "number" ? asset.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : asset.price}
                      </div>
                      <div style={{ textAlign: "right", fontSize: 11, fontWeight: 600, color: (asset.change || 0) >= 0 ? "#00ff9f" : "#ff4d6d", fontFamily: "'Space Mono', monospace" }}>
                        {(asset.change || 0) >= 0 ? "▲" : "▼"} {Math.abs(asset.change || 0).toFixed(2)}%
                      </div>
                      {sig ? <Badge label={sig.signal} color={sc} /> : (
                        <button disabled={loading} onClick={() => !loading && analyzeAsset(asset.sym, asset, asset.type)} style={{ padding: "4px 10px", border: "1px solid #1a3a2a", background: loading ? "#1a3a2a" : "transparent", color: loading ? "#00ff9f" : "#3a5a4a", fontSize: 9, borderRadius: 3, cursor: "pointer", fontFamily: "'Space Mono', monospace", whiteSpace: "nowrap" }}>
                          {loading ? "..." : "ANALIZZA"}
                        </button>
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

        {/* RIGHT PANEL: config + unified alerts */}
        <div style={{ overflowY: "auto", padding: 18, background: "#050810" }}>
          <TgPanel cfg={tgCfg} onChange={setTgCfg} />

          {/* Alert filter */}
          <div style={{ fontSize: 9, color: "#1a3a3a", fontFamily: "'Space Mono', monospace", letterSpacing: "0.15em", marginBottom: 10, display: "flex", justifyContent: "space-between" }}>
            <span>⚡ ALERT UNIFICATI ({alerts.length})</span>
            {alerts.length > 0 && <button onClick={() => setAlerts([])} style={{ fontSize: 9, color: "#1a3a3a", background: "none", border: "none", cursor: "pointer", fontFamily: "'Space Mono', monospace" }}>CLEAR</button>}
          </div>

          {alerts.length === 0 ? (
            <div style={{ textAlign: "center", padding: "28px 0", color: "#1a3a2a", fontSize: 10, fontFamily: "'Space Mono', monospace", lineHeight: 2.2 }}>
              Feed vuoto.<br/>Scan un topic o analizza<br/>un asset per iniziare.
            </div>
          ) : alerts.map(a => (
            <div key={a.id} style={{ background: "#080d14", border: `1px solid ${a.color}1a`, borderLeft: `3px solid ${a.color}55`, borderRadius: 6, padding: "10px 12px", marginBottom: 8, animation: "fadeUp 0.3s ease" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 5 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 9, fontFamily: "'Space Mono', monospace", color: "#1a3a3a", background: "#0d1520", padding: "1px 5px", borderRadius: 2 }}>{a.type}</span>
                  <span style={{ fontWeight: 700, color: "#d8e8e0", fontFamily: "'Space Mono', monospace", fontSize: 12 }}>{a.topicLabel || a.symbol}</span>
                  <Badge label={a.signal} color={SIG_COLORS[a.signal] || a.color} />
                  {tgSent[a.id] && <span style={{ fontSize: 10 }}>✈️</span>}
                </div>
                <span style={{ fontSize: 9, color: "#1a3a2a", fontFamily: "'Space Mono', monospace" }}>{a.time}</span>
              </div>

              {a.type === "TREND" && (
                <div>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                    <span style={{ fontSize: 16, fontWeight: 700, color: a.color, fontFamily: "'Space Mono', monospace" }}>{a.score}</span>
                    <span style={{ fontSize: 9, color: "#1a4a3a" }}>score</span>
                    {a.momentum && <Badge label={MOM_ICON[a.momentum] + " " + a.momentum} color={a.momentum === "accelerating" ? "#00ff9f" : "#ffd166"} />}
                  </div>
                  {a.summary && <div style={{ fontSize: 11, color: "#4a7a5a", lineHeight: 1.6, marginBottom: 5 }}>{a.summary}</div>}
                  <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                    {a.investable?.map(t => <Badge key={t} label={t} color={a.color} />)}
                  </div>
                </div>
              )}

              {a.type === "TRADE" && (
                <div>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontFamily: "'Space Mono', monospace", fontSize: 12, color: "#c8d3dc" }}>${Number(a.price || 0).toFixed(2)}</span>
                    <span style={{ fontSize: 10, color: "#1a4a3a", fontFamily: "'Space Mono', monospace" }}>CONF {a.confidence}%</span>
                  </div>
                  {a.reasoning && <div style={{ fontSize: 11, color: "#4a7a5a", lineHeight: 1.5, marginBottom: 5 }}>{a.reasoning}</div>}
                  <div style={{ display: "flex", gap: 10, fontSize: 10, fontFamily: "'Space Mono', monospace" }}>
                    {a.entry && <span style={{ color: "#2a5a3a" }}>E ${a.entry}</span>}
                    {a.stop_loss && <span style={{ color: "#5a2a2a" }}>SL ${a.stop_loss}</span>}
                    {a.take_profit && <span style={{ color: "#1a5a2a" }}>TP ${a.take_profit}</span>}
                  </div>
                </div>
              )}
            </div>
          ))}

          {/* Topic quick-scan */}
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 9, color: "#1a3a3a", fontFamily: "'Space Mono', monospace", letterSpacing: "0.15em", marginBottom: 8 }}>SCAN RAPIDO</div>
            {Object.entries(TOPICS).map(([key, topic]) => {
              const td = trendData[key];
              return (
                <div key={key} onClick={() => !scanning && scanTopic(key)} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 0", borderBottom: "1px solid #0d1520", cursor: "pointer" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <Pulse color={scanning === key ? "#ffd166" : td ? topic.color : "#1a2535"} />
                    <span style={{ fontSize: 10, color: td ? "#8a9aaa" : "#2a4a3a" }}>{topic.short}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {td && <span style={{ fontSize: 11, fontWeight: 700, color: topic.color, fontFamily: "'Space Mono', monospace" }}>{td.score}</span>}
                    {td && <Badge label={td.signal} color={SIG_COLORS[td.signal]} />}
                    {!td && <span style={{ fontSize: 9, color: "#1a3a2a", fontFamily: "'Space Mono', monospace" }}>NO DATA</span>}
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ marginTop: 14, padding: "10px 12px", background: "#080d14", borderRadius: 6, border: "1px solid #1a2030" }}>
            <div style={{ fontSize: 9, color: "#1a3a2a", lineHeight: 1.8, fontFamily: "'Space Mono', monospace" }}>
              ⚠ Trend basati su fonti pubbliche.<br/>Segnali AI, non consulenza.<br/>Verifica prima di investire.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
