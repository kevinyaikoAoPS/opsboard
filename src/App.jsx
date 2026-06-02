import { useState, useMemo, useRef, useCallback, createContext, useContext, useEffect } from "react";

// NOTE: Add this to index.html <head> for Roboto:
// <link href="https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap" rel="stylesheet">
// Or it will be injected automatically below.

function useGoogleFont(href) {
  useEffect(() => {
    if (document.querySelector(`link[href="${href}"]`)) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    document.head.appendChild(link);
  }, [href]);
}
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar, Cell
} from "recharts";

// ─── DESIGN TOKENS ────────────────────────────────────────────────────────────

const C = {
  bg:        "#f4f6f9",
  surface:   "#ffffff",
  surfaceAlt:"#eef1f5",
  border:    "#d1d3d4",
  borderHi:  "#b0b4b8",
  text:      "#1b365d",
  textMuted: "#5a6a7e",
  textDim:   "#a0aab4",
  accent:    "#1fa8ae",
  accentDim: "#1fa8ae18",
  navy:      "#1b365d",
  navyDark:  "#122544",
  gray:      "#d1d3d4",
  warn:      "#f59e0b",
  danger:    "#e03e3e",
  blue:      "#1b365d",
};

const PALETTE = ["#1fa8ae","#1b365d","#f59e0b","#e03e3e","#3b82f6","#ec4899","#8b5cf6","#14b8a6","#f97316","#84cc16"];

const FONT = "'IBM Plex Mono', 'Courier New', monospace";  // data/timestamps
const FONT_UI = "'Roboto', 'Arial', sans-serif";  // UI text

// ─── SHELF CONTEXT ────────────────────────────────────────────────────────────

const ShelfContext = createContext(null);

function useShelf() { return useContext(ShelfContext); }

// ─── CONSTANTS ────────────────────────────────────────────────────────────────

const BUCKETS = [
  { label: "0–30s",   max: 0.5 },
  { label: "30s–45s", max: 0.75 },
  { label: "45s–1m",  max: 1 },
  { label: "1m–1.5m", max: 1.5 },
  { label: "1.5m–2m", max: 2 },
  { label: "2m–2.5m", max: 2.5 },
  { label: "2.5m–3m", max: 3 },
  { label: "3–4m",    max: 4 },
  { label: "4–5m",    max: 5 },
  { label: "5m+",     max: Infinity },
];

// ─── HTML → TEXT EXTRACTION ───────────────────────────────────────────────────

function extractTextFromHTML(html) {
  const mainMatch =
    html.match(/<div[^>]+id="main-column"[^>]*>([\s\S]*?)<div[^>]+id="main-footer"/i) ||
    html.match(/<div[^>]+id="main-content"[^>]*>([\s\S]*?)<div[^>]+id="main-footer"/i);
  let h = mainMatch ? mainMatch[1] : html;

  h = h.replace(/<svg[\s\S]*?<\/svg>/gi, "");
  h = h.replace(/<span[^>]+class="MJX_Assistive_MathML"[^>]*>[\s\S]*?<\/span>/gi, "");
  h = h.replace(/<span[^>]+class="MathJax_Preview"[^>]*>[\s\S]*?<\/span>/gi, "");
  h = h.replace(/<span[^>]+class="MathJax_SVG"[^>]*>[\s\S]*?<\/span>/gi, "");

  h = h.replace(
    /<script[^>]*type="math\/tex"[^>]*>([\s\S]*?)<\/script>/gi,
    (_, l) => ` $${l.trim()}$ `
  );

  h = h
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(div|p|h[1-6]|tr|li)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&gt;/g, ">").replace(/&lt;/g, "<").replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ").replace(/&#x2212;/g, "-")
    .replace(/&#\d+;/g, "").replace(/&[a-z]+;/g, "");

  return h.split("\n").map(l => l.trim()).join("\n").replace(/\n{3,}/g, "\n\n");
}

// ─── LOG PARSER ───────────────────────────────────────────────────────────────

function parseLogFromText(text) {
  const normalized = text
    .replace(/\u2212/g, "-")
    .replace(/&#x2212;/g, "-")
    .replace(/\[(\d{4}-\d{2}-\d{2})(\d{2}:\d{2}:\d{2})\]/g, "[$1 $2]");

  const tsRe = /\[(\d{4}-\d{2}-\d{2})\s*(\d{2}:\d{2}:\d{2})\]/g;
  const blocks = [];
  let last = null, m;
  while ((m = tsRe.exec(normalized)) !== null) {
    if (last !== null)
      blocks.push({ date: last.date, time: last.time, rest: normalized.slice(last.end, m.index).trim() });
    last = { date: m[1], time: m[2], end: m.index + m[0].length };
  }
  if (last !== null)
    blocks.push({ date: last.date, time: last.time, rest: normalized.slice(last.end).trim() });

  let detectedClassId = null;
  const rows = [];

  for (const { date, time, rest } of blocks) {
    const arrowPos = rest.indexOf("->");
    if (arrowPos === -1) continue;
    const sender = rest.slice(0, arrowPos).trim();
    const afterArrow = rest.slice(arrowPos + 2).trim();
    const colonPos = afterArrow.indexOf(":");
    let recipient, body;
    if (colonPos !== -1) {
      recipient = afterArrow.slice(0, colonPos).trim();
      body = afterArrow.slice(colonPos + 1).trim();
    } else {
      recipient = afterArrow.trim();
      body = "";
    }
    if (!sender || !recipient) continue;

    if (/^\d{4}$/.test(recipient)) detectedClassId = recipient;
    const modM = recipient.match(/^MOD-(\d+)$/i);
    if (modM) detectedClassId = modM[1];

    let messageType = "whisper";
    if (/^\d{4}$/.test(recipient)) messageType = "class";
    else if (/^MOD-/i.test(recipient)) messageType = "mod";

    const isImageOnly = !body || /^\{"motor_ref"/.test(body);

    rows.push({
      timestamp: `${date} ${time}`, date, time, sender, recipient,
      message_type: messageType,
      class_id: detectedClassId || "",
      message: isImageOnly ? "" : body,
      is_image_only: isImageOnly,
      char_count: isImageOnly ? 0 : body.length,
    });
  }

  // dedup
  const seen = {};
  return rows.filter(r => {
    const key = `${r.timestamp}|${r.sender}|${r.recipient}`;
    if (seen[key]) return false;
    seen[key] = true;
    return true;
  });
}

// ─── CSV HELPERS ──────────────────────────────────────────────────────────────

function toCSV(rows) {
  const headers = ["timestamp","date","time","sender","recipient","message_type","class_id","message","is_image_only","char_count"];
  const escape = v => {
    const s = String(v == null ? "" : v);
    if (s.includes(",") || s.includes('"') || s.includes("\n"))
      return '"' + s.replace(/"/g, '""') + '"';
    return s;
  };
  return [headers.join(",")]
    .concat(rows.map(r => headers.map(h => escape(r[h])).join(",")))
    .join("\n");
}

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines.length < 2) return [];
  const parseRow = line => {
    const cells = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        i++;
        let cell = "";
        while (i < line.length) {
          if (line[i] === '"' && line[i+1] === '"') { cell += '"'; i += 2; }
          else if (line[i] === '"') { i++; break; }
          else { cell += line[i++]; }
        }
        cells.push(cell);
        if (line[i] === ',') i++;
      } else {
        let cell = "";
        while (i < line.length && line[i] !== ',') cell += line[i++];
        cells.push(cell.trim());
        if (line[i] === ',') i++;
      }
    }
    return cells;
  };
  const headers = parseRow(lines[0]);
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = parseRow(lines[i]);
    const obj = {};
    headers.forEach((h, j) => { obj[h] = cells[j] ?? ""; });
    rows.push(obj);
  }
  return rows;
}

function detectFormat(text) {
  return text.split(/\r?\n/)[0].includes("sender") ? "new" : "old";
}

// ─── ANALYTICS PARSING (supports both formats) ────────────────────────────────

function getAnalyticsRows(text) {
  if (detectFormat(text) === "new") {
    return parseCSV(text);
  }
  // old format: parse raw log strings
  function extractFirstColumn(t) {
    const results = [];
    let i = 0;
    while (i < t.length) {
      let cell = "";
      if (t[i] === '"') {
        i++;
        while (i < t.length) {
          if (t[i] === '"' && t[i+1] === '"') { cell += '"'; i += 2; }
          else if (t[i] === '"') { i++; break; }
          else { cell += t[i++]; }
        }
      } else {
        while (i < t.length && t[i] !== ',' && t[i] !== '\n' && t[i] !== '\r') cell += t[i++];
      }
      results.push(cell.trim());
      while (i < t.length && t[i] !== '\n') i++;
      if (i < t.length) i++;
    }
    return results;
  }
  // detect instructor/class from old format
  const dm = text.match(/\[(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}\]\s*(\w+)\s*->\s*(\d+):/m);
  if (!dm) return [];
  const instructor = dm[2], classId = dm[3];
  const lines = extractFirstColumn(text).filter(l => l.startsWith("["));
  const re = new RegExp(`^\\[(\\d{4}-\\d{2}-\\d{2})\\s+(\\d{2}:\\d{2}:\\d{2})\\]\\s*(\\S+)\\s*->\\s*(\\S+):\\s*(.*)`);
  return lines.map(line => {
    const m = line.match(re);
    if (!m) return null;
    const [, date, time, sender, recipient, message] = m;
    let message_type = "whisper";
    if (/^\d{4}$/.test(recipient)) message_type = "class";
    else if (/^MOD-/i.test(recipient)) message_type = "mod";
    return { timestamp: `${date} ${time}`, date, time, sender, recipient, message_type, class_id: classId, message, is_image_only: false, char_count: message.length };
  }).filter(Boolean);
}

function detectInstructorAndClass(text) {
  if (detectFormat(text) === "new") {
    const rows = parseCSV(text);
    const classMsg = rows.find(r => r.message_type === "class" || /^\d{4}$/.test(r.recipient));
    if (classMsg) return { instructor: classMsg.sender, classId: classMsg.class_id || classMsg.recipient };
    if (rows.length) return { instructor: rows[0].sender, classId: rows[0].class_id || "" };
    return null;
  }
  const m = text.match(/\[(\d{4}-\d{2}-\d{2})\s+\d{2}:\d{2}:\d{2}\]\s*(\w+)\s*->\s*(\d+):/m);
  return m ? { instructor: m[2], classId: m[3] } : null;
}

function parseLogForAnalytics(text, instructor) {
  const rows = getAnalyticsRows(text).filter(r =>
    r.sender === instructor && r.message_type === "class"
  );
  return rows
    .filter(r => {
      const h = parseInt(r.time.slice(0, 2), 10);
      const min = parseInt(r.time.slice(3, 5), 10);
      return !(h < 19 || (h === 19 && min < 29) || h >= 21);
    })
    .map(r => ({ ts: new Date(`${r.date}T${r.time}`), date: r.date, raw: r.timestamp, msg: r.message }))
    .sort((a, b) => a.ts - b.ts);
}

function countByDateForAnalytics(text, instructor) {
  const rows = getAnalyticsRows(text).filter(r => r.sender === instructor && r.message_type === "class");
  const counts = {};
  rows.forEach(r => { counts[r.date] = (counts[r.date] || 0) + 1; });
  return counts;
}

// ─── ANALYTICS MATH ───────────────────────────────────────────────────────────

function computeGaps(rows) {
  const gaps = [];
  for (let i = 1; i < rows.length; i++) {
    const diff = (rows[i].ts - rows[i-1].ts) / 1000;
    if (diff > 0 && diff < 7200)
      gaps.push({ diff, diffMin: +(diff/60).toFixed(2), from: rows[i-1].raw, to: rows[i].raw, fromMsg: rows[i-1].msg });
  }
  return gaps;
}

function pct(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a,b)=>a-b);
  return s[Math.min(Math.floor(p/100*s.length), s.length-1)];
}

function buildHistogram(gaps) {
  const counts = BUCKETS.map(b => ({ label: b.label, count: 0 }));
  for (const g of gaps) {
    for (let i = 0; i < BUCKETS.length; i++) {
      if (g.diffMin <= BUCKETS[i].max) { counts[i].count++; break; }
    }
  }
  return counts;
}

function computeStats(rows, gaps) {
  const diffs = gaps.map(g => g.diffMin);
  if (!diffs.length) return null;
  const avg = diffs.reduce((s,x)=>s+x,0)/diffs.length;
  const variance = diffs.reduce((s,x)=>s+(x-avg)**2,0)/diffs.length;
  const byDate = {};
  for (const r of rows) {
    const d = r.raw.split(" ")[0];
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(r.ts);
  }
  const mpms = Object.values(byDate).map(ts => {
    const dur = (ts[ts.length-1]-ts[0])/60000;
    return dur > 0 ? ts.length/dur : 0;
  });
  return {
    total: rows.length, totalGaps: gaps.length,
    median: +pct(diffs,50).toFixed(2), p90: +pct(diffs,90).toFixed(2),
    avg: +avg.toFixed(2), stdDev: +Math.sqrt(variance).toFixed(2),
    avgMsgPerMin: +(mpms.reduce((s,x)=>s+x,0)/mpms.length).toFixed(2),
    longWaits: gaps.filter(g=>g.diffMin>5).length,
    longWaitPct: +((gaps.filter(g=>g.diffMin>5).length/gaps.length)*100).toFixed(1),
  };
}

function buildSessionData(gaps) {
  const byDate = {};
  for (const g of gaps) {
    const d = g.from.split(" ")[0];
    if (!byDate[d]) byDate[d] = [];
    byDate[d].push(g.diffMin);
  }
  return Object.entries(byDate)
    .map(([date, diffs]) => ({ date, median: +pct(diffs,50).toFixed(2), p90: +pct(diffs,90).toFixed(2) }))
    .sort((a,b)=>a.date.localeCompare(b.date));
}

// ─── SHARED UI COMPONENTS ─────────────────────────────────────────────────────

const sx = {
  card: {
    background: C.surface, border: `1px solid ${C.border}`,
    borderRadius: 10, padding: 16,
    boxShadow: "0 1px 4px rgba(27,54,93,0.07)",
  },
  label: {
    fontSize: 10, color: C.textMuted, textTransform: "uppercase",
    letterSpacing: "0.08em", marginBottom: 3, fontFamily: FONT_UI,
  },
  btn: (active, color) => ({
    padding: "4px 12px", borderRadius: 5,
    border: `1px solid ${active ? (color||C.accent) : C.border}`,
    cursor: "pointer", fontSize: 11, fontFamily: FONT_UI,
    background: active ? (color||C.accent) : C.surface,
    color: active ? '#ffffff' : C.textMuted, fontWeight: active ? 700 : 400,
    transition: "all 0.15s",
  }),
  th: { padding: "7px 10px", textAlign: "left", borderBottom: `1px solid ${C.border}`, background: C.surfaceAlt, fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: FONT_UI, whiteSpace: "nowrap" },
  td: { padding: "6px 10px", borderBottom: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT_UI },
};

function StatCard({ label, value, color, sub }) {
  return (
    <div style={{ ...sx.card, flex: "1 1 80px", borderTop: `3px solid ${color || C.accent}`, padding: "10px 12px" }}>
      <div style={sx.label}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color || C.accent, fontFamily: FONT_UI }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: C.textMuted, marginTop: 2, fontFamily: FONT }}>{sub}</div>}
    </div>
  );
}

function Badge({ type }) {
  const map = {
    class:   { bg: "#00d4aa18", color: C.accent,  label: "Class" },
    whisper: { bg: "#3b82f618", color: C.blue,    label: "Whisper" },
    mod:     { bg: "#f59e0b18", color: C.warn,    label: "MOD" },
  };
  const s = map[type] || { bg: C.border, color: C.textMuted, label: type };
  return (
    <span style={{ background: s.bg, color: s.color, padding: "2px 8px", borderRadius: 10, fontSize: 10, fontWeight: 700, fontFamily: FONT_UI, border: `1px solid ${s.color}44` }}>
      {s.label}
    </span>
  );
}

function GapTable({ gaps, lo, hi }) {
  const filtered = gaps.filter(g => g.diffMin > lo && g.diffMin <= hi).sort((a,b) => b.diffMin - a.diffMin);
  return (
    <div style={{ overflowX: "auto", maxHeight: 280, overflowY: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead style={{ position: "sticky", top: 0, background: C.surface }}>
          <tr>{["#","Gap","From","To","Message"].map(h => <th key={h} style={sx.th}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {filtered.length === 0
            ? <tr><td colSpan={5} style={{ ...sx.td, color: C.textMuted, textAlign: "center", padding: 16 }}>No gaps in this range.</td></tr>
            : filtered.map((g, i) => (
              <tr key={i}>
                <td style={{ ...sx.td, color: C.textMuted }}>{i+1}</td>
                <td style={{ ...sx.td, fontWeight: 700, color: C.accent }}>{g.diffMin}m</td>
                <td style={{ ...sx.td, color: C.textMuted, whiteSpace: "nowrap" }}>{g.from}</td>
                <td style={{ ...sx.td, color: C.textMuted, whiteSpace: "nowrap" }}>{g.to}</td>
                <td style={{ ...sx.td, maxWidth: 260, wordBreak: "break-word", color: C.text }}>{g.fromMsg || "—"}</td>
              </tr>
            ))
          }
        </tbody>
      </table>
    </div>
  );
}

// ─── FILE SOURCE SELECTOR ─────────────────────────────────────────────────────
// Used by Gap/Session/Counter tabs — lets user pick from shelf OR upload directly

function FileSourceSelector({ label, onData, multiple = false }) {
  const { shelf } = useShelf();
  const [mode, setMode] = useState(shelf.length > 0 ? "shelf" : "upload");

  const handleUpload = async (files) => {
    const results = [];
    for (const f of files) {
      const text = await f.text();
      results.push({ text, name: f.name });
    }
    onData(results);
  };

  const handleShelfPick = (item) => {
    onData([{ text: toCSV(item.rows), name: item.label, shelfItem: item }]);
  };

  return (
    <div style={{ ...sx.card, marginBottom: 16 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
        <span style={{ fontSize: 13, color: C.text, fontFamily: FONT_UI, fontWeight: 600 }}>{label}</span>
        <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
          {shelf.length > 0 && (
            <button style={sx.btn(mode === "shelf")} onClick={() => setMode("shelf")}>From Shelf</button>
          )}
          <button style={sx.btn(mode === "upload")} onClick={() => setMode("upload")}>Upload File</button>
        </div>
      </div>
      {mode === "shelf" && shelf.length > 0 && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {shelf.map(item => (
            <button key={item.id} onClick={() => handleShelfPick(item)}
              style={{ padding: "6px 14px", borderRadius: 6, border: `1px solid ${C.accent}`, background: C.accentDim, color: C.accent, cursor: "pointer", fontSize: 12, fontFamily: FONT_UI }}>
              {item.label}
            </button>
          ))}
        </div>
      )}
      {mode === "upload" && (
        <label style={{ display: "flex", alignItems: "center", gap: 10, border: `2px dashed ${C.border}`, borderRadius: 8, padding: "12px 16px", cursor: "pointer", background: C.surfaceAlt }}>
          <span style={{ fontSize: 18 }}>📂</span>
          <span style={{ fontSize: 12, color: C.textMuted, fontFamily: FONT }}>
            {multiple ? "Select one or more CSV files" : "Select a CSV file"}
          </span>
          <input type="file" accept=".csv,.txt" multiple={multiple}
            onChange={e => { const f = Array.from(e.target.files); if (f.length) handleUpload(f); e.target.value = ""; }}
            style={{ display: "none" }} />
        </label>
      )}
    </div>
  );
}

// ─── THE SHELF ────────────────────────────────────────────────────────────────

function Shelf() {
  const { shelf, removeFromShelf } = useShelf();
  if (!shelf.length) return null;

  const downloadCSV = (item) => {
    const csv = toCSV(item.rows);
    const uri = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    const a = document.createElement("a");
    a.href = uri;
    a.download = item.label.replace(/\s+/g, "_") + ".csv";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div style={{ background: C.surfaceAlt, borderBottom: `1px solid ${C.border}`, padding: "8px 20px", display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      <span style={{ fontSize: 10, color: C.textMuted, textTransform: "uppercase", letterSpacing: "0.1em", fontFamily: FONT_UI, marginRight: 4, whiteSpace: "nowrap" }}>
        📦 Shelf
      </span>
      {shelf.map(item => (
        <div key={item.id} style={{ display: "flex", alignItems: "center", gap: 0, border: `1px solid ${C.accent}`, borderRadius: 6, overflow: "hidden", background: C.accentDim }}>
          <span style={{ fontSize: 11, color: C.accent, fontFamily: FONT_UI, padding: "3px 10px" }}>{item.label}</span>
          <span style={{ fontSize: 10, color: C.textMuted, fontFamily: FONT_UI, padding: "3px 8px", borderLeft: `1px solid ${C.accent}33` }}>{item.rows.length} msgs</span>
          <button onClick={() => downloadCSV(item)} title="Download CSV"
            style={{ padding: "3px 7px", background: "transparent", border: "none", borderLeft: `1px solid ${C.accent}33`, cursor: "pointer", color: C.textMuted, fontSize: 11 }}>⬇</button>
          <button onClick={() => removeFromShelf(item.id)} title="Remove"
            style={{ padding: "3px 7px", background: "transparent", border: "none", borderLeft: `1px solid ${C.accent}33`, cursor: "pointer", color: C.textMuted, fontSize: 11 }}>✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── PARSER TAB ───────────────────────────────────────────────────────────────

const PAGE_SIZE = 50;

function ParserTab() {
  const { addToShelf } = useShelf();
  const [input, setInput] = useState("");
  const [rows, setRows] = useState([]);
  const [parsed, setParsed] = useState(false);
  const [filterType, setFilterType] = useState("all");
  const [filterDate, setFilterDate] = useState("all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [fileLoaded, setFileLoaded] = useState("");
  const [status, setStatus] = useState("");
  const [addedToShelf, setAddedToShelf] = useState(false);

  const handleFile = (file) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      let text = e.target.result;
      if (file.name.endsWith(".html") || file.name.endsWith(".htm") || text.trimStart().startsWith("<!"))
        text = extractTextFromHTML(text);
      setInput(text);
      setFileLoaded(file.name);
    };
    reader.readAsText(file);
  };

  const handleParse = () => {
    const result = parseLogFromText(input);
    setRows(result);
    setStatus(`Found ${result.length} message${result.length !== 1 ? "s" : ""}`);
    if (result.length > 0) {
      setParsed(true); setPage(1);
      setFilterType("all"); setFilterDate("all"); setSearch("");
      setAddedToShelf(false);
    }
  };

  const handleAddToShelf = () => {
    if (!rows.length) return;
    const sender = rows[0].sender;
    const classId = rows[0].class_id;
    const dates = [...new Set(rows.map(r => r.date))].sort();
    const label = `${sender} · ${classId} · ${dates[0]}${dates.length > 1 ? `–${dates[dates.length-1].slice(5)}` : ""}`;
    addToShelf({ label, rows });
    setAddedToShelf(true);
  };

  const handleDownload = () => {
    const csv = toCSV(rows);
    const sender = rows[0]?.sender || "log";
    const dates = [...new Set(rows.map(r => r.date))].sort();
    const uri = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    const a = document.createElement("a");
    a.href = uri;
    a.download = `${sender}_${dates[0]}_to_${dates[dates.length-1]}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleClear = () => {
    setParsed(false); setInput(""); setRows([]); setFileLoaded(""); setStatus(""); setAddedToShelf(false);
  };

  const dates = useMemo(() => [...new Set(rows.map(r => r.date))].sort(), [rows]);
  const stats = useMemo(() => {
    const byType = { class: 0, whisper: 0, mod: 0 };
    rows.forEach(r => { byType[r.message_type] = (byType[r.message_type] || 0) + 1; });
    return { total: rows.length, byType, imageOnly: rows.filter(r => r.is_image_only).length, sender: rows[0]?.sender || "—", classId: rows[0]?.class_id || "—" };
  }, [rows]);

  const filtered = useMemo(() => rows.filter(r => {
    if (filterType !== "all" && r.message_type !== filterType) return false;
    if (filterDate !== "all" && r.date !== filterDate) return false;
    if (search && !r.message.toLowerCase().includes(search.toLowerCase()) && !r.recipient.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  }), [rows, filterType, filterDate, search]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageRows = filtered.slice((page-1)*PAGE_SIZE, page*PAGE_SIZE);

  return (
    <div>
      {!parsed ? (
        <div>
          <div onDrop={e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFile(f); }}
            onDragOver={e => e.preventDefault()}
            style={{ border: `2px dashed ${C.border}`, borderRadius: 8, padding: "14px 18px", background: C.surfaceAlt, marginBottom: 12, display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 20 }}>📄</span>
            <span style={{ fontSize: 13, color: C.textMuted, flex: 1, fontFamily: FONT_UI }}>
              {fileLoaded ? `✓ ${fileLoaded}` : "Drop a saved classroom message log (.html) here, or browse"}
            </span>
            <label style={{ padding: "6px 14px", background: C.accent, color: "#ffffff", borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: FONT_UI }}>
              Browse
              <input type="file" accept=".html,.htm,.txt,.csv"
                onChange={e => { const f = e.target.files[0]; if (f) handleFile(f); }}
                style={{ display: "none" }} />
            </label>
          </div>
          <textarea value={input} onChange={e => setInput(e.target.value)}
            placeholder="Or paste raw log text here..."
            style={{ width: "100%", height: 180, fontFamily: FONT, fontSize: 11, padding: 12, border: `1px solid ${C.border}`, borderRadius: 8, resize: "vertical", boxSizing: "border-box", background: C.surfaceAlt, color: C.text, lineHeight: 1.6 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 10 }}>
            <button onClick={handleParse} disabled={!input.trim()}
              style={{ padding: "9px 22px", background: C.accent, color: "#ffffff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: FONT_UI, opacity: input.trim() ? 1 : 0.4 }}>
              Parse Log
            </button>
            {status && <span style={{ fontSize: 12, color: C.accent, fontWeight: 700, fontFamily: FONT_UI }}>{status}</span>}
          </div>
        </div>
      ) : (
        <>
          {/* Stat cards */}
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
            <StatCard label="Sender"   value={stats.sender}         />
            <StatCard label="Class ID" value={stats.classId}        />
            <StatCard label="Sessions" value={dates.length}         color={C.blue} />
            <StatCard label="Total"    value={stats.total}          />
            <StatCard label="To Class" value={stats.byType.class}   color={C.accent} />
            <StatCard label="Whispers" value={stats.byType.whisper} color={C.blue} />
            <StatCard label="MOD"      value={stats.byType.mod}     color={C.warn} />
            <StatCard label="Images"   value={stats.imageOnly}      color={C.textMuted} />
          </div>

          {/* Action row: shelf / download / clear */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            <button onClick={handleAddToShelf} disabled={addedToShelf}
              style={{ padding: "7px 16px", background: addedToShelf ? C.accentDim : C.accent, color: addedToShelf ? C.accent : "#ffffff", border: `1px solid ${C.accent}`, borderRadius: 6, cursor: addedToShelf ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: FONT_UI }}>
              {addedToShelf ? "✓ On Shelf" : "📦 Add to Shelf"}
            </button>
            <button onClick={handleDownload}
              style={{ padding: "7px 16px", background: C.accent, color: "#ffffff", border: `1px solid ${C.accent}`, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: FONT_UI }}>
              ⬇ Download CSV
            </button>
            <button onClick={handleClear}
              style={{ padding: "7px 16px", background: "transparent", color: C.danger, border: `1px solid ${C.danger}44`, borderRadius: 6, cursor: "pointer", fontSize: 12, fontFamily: FONT_UI, marginLeft: "auto" }}>
              ✕ Clear
            </button>
          </div>

          {/* By-date table */}
          <div style={{ ...sx.card, marginBottom: 16, overflowX: "auto" }}>
            <div style={sx.label}>Messages by Date</div>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Date","Total","Class","Whispers","MOD"].map(h => <th key={h} style={sx.th}>{h}</th>)}</tr></thead>
              <tbody>
                {dates.map(d => {
                  const dr = rows.filter(r => r.date === d);
                  return (
                    <tr key={d}>
                      <td style={{ ...sx.td, fontWeight: 600, color: C.text }}>{d}</td>
                      <td style={sx.td}>{dr.length}</td>
                      <td style={{ ...sx.td, color: C.accent }}>{dr.filter(r => r.message_type === "class").length}</td>
                      <td style={{ ...sx.td, color: C.blue }}>{dr.filter(r => r.message_type === "whisper").length}</td>
                      <td style={{ ...sx.td, color: C.warn }}>{dr.filter(r => r.message_type === "mod").length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Filter row */}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
            <select value={filterType} onChange={e => { setFilterType(e.target.value); setPage(1); }}
              style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT, background: C.surface, color: C.text, cursor: 'pointer', fontFamily: FONT_UI }}>
              <option value="all">All types</option>
              <option value="class">Class</option>
              <option value="whisper">Whisper</option>
              <option value="mod">MOD</option>
            </select>
            <select value={filterDate} onChange={e => { setFilterDate(e.target.value); setPage(1); }}
              style={{ padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT, background: C.surface, color: C.text, fontFamily: FONT_UI }}>
              <option value="all">All dates</option>
              {dates.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }}
              placeholder="Search messages or recipients…"
              style={{ flex: "1 1 200px", padding: "6px 10px", borderRadius: 6, border: `1px solid ${C.border}`, fontSize: 12, fontFamily: FONT_UI, background: C.surface, color: C.text }} />
          </div>

          <div style={{ fontSize: 11, color: C.textMuted, marginBottom: 6, fontFamily: FONT_UI }}>
            Showing {Math.min((page-1)*PAGE_SIZE+1, filtered.length)}–{Math.min(page*PAGE_SIZE, filtered.length)} of {filtered.length}
          </div>

          {/* Message table */}
          <div style={{ ...sx.card, overflowX: "auto", padding: 0 }}>
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead><tr>{["Timestamp","Type","Recipient","Message","Chars"].map(h => <th key={h} style={sx.th}>{h}</th>)}</tr></thead>
              <tbody>
                {pageRows.map((r, i) => (
                  <tr key={i} style={{ background: r.is_image_only ? C.surfaceAlt : "transparent" }}>
                    <td style={{ ...sx.td, whiteSpace: "nowrap", color: C.textMuted }}>{r.timestamp}</td>
                    <td style={sx.td}><Badge type={r.message_type} /></td>
                    <td style={{ ...sx.td, whiteSpace: "nowrap", fontWeight: 600, color: C.text }}>{r.recipient}</td>
                    <td style={{ ...sx.td, maxWidth: 400, wordBreak: "break-word", color: r.is_image_only ? C.textMuted : C.text }}>
                      {r.is_image_only ? <em style={{ color: C.textDim }}>[ image ]</em> : r.message}
                    </td>
                    <td style={{ ...sx.td, color: C.textMuted, textAlign: "right" }}>{r.char_count || "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div style={{ display: "flex", gap: 5, justifyContent: "center", marginTop: 12, flexWrap: "wrap" }}>
              <button onClick={() => setPage(p => Math.max(1, p-1))} disabled={page===1}
                style={{ ...sx.btn(false), opacity: page===1?0.4:1 }}>← Prev</button>
              {Array.from({ length: Math.min(totalPages, 10) }, (_, idx) => {
                const p = totalPages <= 10 ? idx+1 : Math.max(1, page-4)+idx;
                if (p > totalPages) return null;
                return <button key={p} onClick={() => setPage(p)} style={{ ...sx.btn(page===p), minWidth: 32 }}>{p}</button>;
              })}
              <button onClick={() => setPage(p => Math.min(totalPages, p+1))} disabled={page===totalPages}
                style={{ ...sx.btn(false), opacity: page===totalPages?0.4:1 }}>Next →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── GAP ANALYZER TAB ─────────────────────────────────────────────────────────

function GapPanel({ instructor, classId, color, gaps, stats, hist, sessionData }) {
  const [view, setView] = useState("histogram");
  const tabs = [{id:"histogram",label:"Distribution"},{id:"sessions",label:"By Session"},{id:"gaps_3_4",label:"3–4m"},{id:"gaps_4_5",label:"4–5m"},{id:"gaps_5plus",label:"5m+"}];
  if (!stats) return null;
  return (
    <div style={{ ...sx.card, flex: "1 1 300px", minWidth: 0, borderTop: `3px solid ${color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
        <strong style={{ color: C.text, fontFamily: FONT_UI, fontSize: 13 }}>{instructor}</strong>
        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: FONT_UI }}>class {classId} · {stats.total} msgs</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {[{l:"Median",v:`${stats.median}m`},{l:"P90",v:`${stats.p90}m`},{l:"Msg/Min",v:stats.avgMsgPerMin},{l:"Std Dev",v:`${stats.stdDev}m`,c:stats.stdDev>3?C.danger:stats.stdDev>1.5?C.warn:color},{l:">5min",v:`${stats.longWaitPct}%`,c:stats.longWaitPct>20?C.danger:C.warn}].map(k=>(
          <div key={k.l} style={{ flex:"1 1 60px", background: C.surfaceAlt, borderRadius: 6, padding: "6px 8px", borderTop: `2px solid ${k.c||color}` }}>
            <div style={sx.label}>{k.l}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: k.c||color, fontFamily: FONT }}>{k.v}</div>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 4, marginBottom: 10, flexWrap: "wrap" }}>
        {tabs.map(t => <button key={t.id} onClick={() => setView(t.id)} style={sx.btn(view===t.id, color)}>{t.label}</button>)}
      </div>
      {view==="histogram" && (
        <ResponsiveContainer width="100%" height={170}>
          <BarChart data={hist} margin={{top:2,right:5,left:-20,bottom:30}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed"/>
            <XAxis dataKey="label" tick={{fontSize:8,fill:C.textMuted}} interval={0} angle={-35} textAnchor="end"/>
            <YAxis tick={{fontSize:10,fill:C.textMuted}}/>
            <Tooltip contentStyle={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,fontFamily:FONT_UI,fontSize:11,color:C.text}}/>
            <Bar dataKey="count" fill={color} radius={[2,2,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      )}
      {view==="sessions" && (
        <ResponsiveContainer width="100%" height={170}>
          <LineChart data={sessionData} margin={{top:2,right:5,left:-20,bottom:30}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed"/>
            <XAxis dataKey="date" tick={{fontSize:8,fill:C.textMuted}} angle={-35} textAnchor="end"/>
            <YAxis tick={{fontSize:10,fill:C.textMuted}}/>
            <Tooltip contentStyle={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,fontFamily:FONT_UI,fontSize:11,color:C.text}}/>
            <Legend wrapperStyle={{fontFamily:FONT_UI,fontSize:11}}/>
            <Line type="monotone" dataKey="median" name="Median" stroke={color} strokeWidth={2} dot={{r:3}}/>
            <Line type="monotone" dataKey="p90" name="P90" stroke={color} strokeWidth={2} strokeDasharray="5 5" dot={{r:3}} opacity={0.6}/>
          </LineChart>
        </ResponsiveContainer>
      )}
      {view==="gaps_3_4" && <GapTable gaps={gaps} lo={3} hi={4}/>}
      {view==="gaps_4_5" && <GapTable gaps={gaps} lo={4} hi={5}/>}
      {view==="gaps_5plus" && <GapTable gaps={gaps} lo={5} hi={Infinity}/>}
    </div>
  );
}

function GapComparison({ instructors }) {
  const [metric, setMetric] = useState("median");
  const metrics = [{id:"median",label:"Median Gap"},{id:"p90",label:"P90 Gap"},{id:"avgMsgPerMin",label:"Msg/Min"},{id:"stdDev",label:"Std Dev"}];
  const barData = instructors.map(i => ({ name: i.instructor, value: i.stats[metric], color: i.color }));
  return (
    <div style={{ ...sx.card, marginTop: 16 }}>
      <div style={{ fontFamily: FONT_UI, fontWeight: 700, color: C.text, marginBottom: 10 }}>Comparison</div>
      <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
        {metrics.map(m => <button key={m.id} onClick={() => setMetric(m.id)} style={sx.btn(metric===m.id)}>{m.label}</button>)}
      </div>
      <ResponsiveContainer width="100%" height={150}>
        <BarChart data={barData} margin={{top:20,right:20,left:0,bottom:5}}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed"/>
          <XAxis dataKey="name" tick={{fontSize:12,fill:C.textMuted}}/>
          <YAxis tick={{fontSize:11,fill:C.textMuted}}/>
          <Tooltip contentStyle={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,fontFamily:FONT_UI,fontSize:11,color:C.text}}/>
          <Bar dataKey="value" radius={[4,4,0,0]} label={{position:"top",fontSize:11,fill:C.textMuted}}>
            {barData.map((e,i) => <Cell key={i} fill={e.color}/>)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <table style={{ width:"100%", borderCollapse:"collapse", marginTop:12 }}>
        <thead><tr style={{background:C.surfaceAlt}}>
          <th style={sx.th}>Metric</th>
          {instructors.map(i => <th key={i.instructor} style={{...sx.th,color:i.color}}>{i.instructor}</th>)}
        </tr></thead>
        <tbody>{metrics.map(m => (
          <tr key={m.id}>
            <td style={{...sx.td,fontWeight:500,color:C.textMuted}}>{m.label}</td>
            {instructors.map(inst => {
              const vals = instructors.map(i => i.stats[m.id]);
              const best = m.id==="avgMsgPerMin" ? Math.max(...vals) : Math.min(...vals);
              const isBest = inst.stats[m.id] === best;
              return <td key={inst.instructor} style={{...sx.td,fontWeight:isBest?700:400,color:isBest?inst.color:C.text}}>{inst.stats[m.id]}{isBest?" ✓":""}</td>;
            })}
          </tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function GapAnalyzerTab({ onGoToParser }) {
  const [slots, setSlots] = useState({ A: null, B: null });
  const hasData = slots.A !== null || slots.B !== null;

  const loadSlot = (slot, results) => {
    const { text } = results[0];
    const d = detectInstructorAndClass(text);
    if (!d) { alert("Could not detect instructor/class."); return; }
    setSlots(prev => ({ ...prev, [slot]: { text, ...d } }));
  };

  const analyzed = useMemo(() => {
    return Object.entries(slots)
      .filter(([, v]) => v !== null)
      .map(([slot, { text, instructor, classId }], idx) => {
        const rows = parseLogForAnalytics(text, instructor);
        const gaps = computeGaps(rows);
        const stats = computeStats(rows, gaps);
        return { slot, instructor, classId, color: PALETTE[idx], rows, gaps, stats, hist: buildHistogram(gaps), sessionData: buildSessionData(gaps) };
      });
  }, [slots]);

  return (
    <div>
      {!hasData && <AnalysisEmptyState onGoToParser={onGoToParser} />}
      <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 16, fontFamily: FONT_UI }}>
        Compare message gap metrics between up to two instructors.
      </p>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ flex: "1 1 260px" }}>
          <FileSourceSelector label="Instructor A" onData={r => loadSlot("A", r)} />
          {slots.A && <div style={{ fontSize: 11, color: PALETTE[0], marginBottom: 8, fontFamily: FONT_UI }}>✓ {slots.A.instructor} · class {slots.A.classId}</div>}
        </div>
        <div style={{ flex: "1 1 260px" }}>
          <FileSourceSelector label="Instructor B (optional)" onData={r => loadSlot("B", r)} />
          {slots.B && <div style={{ fontSize: 11, color: PALETTE[1], marginBottom: 8, fontFamily: FONT_UI }}>✓ {slots.B.instructor} · class {slots.B.classId}</div>}
        </div>
      </div>
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {analyzed.map(a => <GapPanel key={a.slot} {...a} />)}
      </div>
      {analyzed.length === 2 && analyzed.every(a => a.stats) && <GapComparison instructors={analyzed} />}
    </div>
  );
}

// ─── SESSION ANALYZER TAB ─────────────────────────────────────────────────────

function SessionCard({ session: s, index: i, color }) {
  const [view, setView] = useState("histogram");
  if (!s.stats) return null;
  return (
    <div style={{ ...sx.card, borderTop: `3px solid ${color}` }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
        <strong style={{ color: C.text, fontFamily: FONT_UI, fontSize: 12 }}>Session {i+1} — {s.date}</strong>
        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: FONT }}>{s.stats.total} msgs</span>
      </div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 }}>
        {[{l:"Median",v:`${s.stats.median}m`},{l:"P90",v:`${s.stats.p90}m`},{l:"Msg/Min",v:s.stats.avgMsgPerMin},{l:"Std Dev",v:`${s.stats.stdDev}m`,c:s.stats.stdDev>3?C.danger:s.stats.stdDev>1.5?C.warn:color},{l:">5min",v:`${s.stats.longWaitPct}%`,c:s.stats.longWaitPct>20?C.danger:C.warn}].map(k=>(
          <div key={k.l} style={{ flex:"1 1 55px", background:C.surfaceAlt, borderRadius:6, padding:"5px 7px", borderTop:`2px solid ${k.c||color}` }}>
            <div style={sx.label}>{k.l}</div>
            <div style={{ fontSize:13, fontWeight:700, color:k.c||color, fontFamily:FONT }}>{k.v}</div>
          </div>
        ))}
      </div>
      <div style={{ display:"flex", gap:4, marginBottom:10, flexWrap:"wrap" }}>
        {[{id:"histogram",label:"Dist"},{id:"gaps_3_4",label:"3–4m"},{id:"gaps_4_5",label:"4–5m"},{id:"gaps_5plus",label:"5m+"}].map(t=>(
          <button key={t.id} onClick={()=>setView(t.id)} style={sx.btn(view===t.id, color)}>{t.label}</button>
        ))}
      </div>
      {view==="histogram" && (
        <ResponsiveContainer width="100%" height={150}>
          <BarChart data={s.hist} margin={{top:2,right:5,left:-20,bottom:28}}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed"/>
            <XAxis dataKey="label" tick={{fontSize:7,fill:C.textMuted}} interval={0} angle={-35} textAnchor="end"/>
            <YAxis tick={{fontSize:9,fill:C.textMuted}}/>
            <Tooltip contentStyle={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,fontFamily:FONT_UI,fontSize:11,color:C.text}}/>
            <Bar dataKey="count" fill={color} radius={[2,2,0,0]}/>
          </BarChart>
        </ResponsiveContainer>
      )}
      {view==="gaps_3_4" && <GapTable gaps={s.gaps} lo={3} hi={4}/>}
      {view==="gaps_4_5" && <GapTable gaps={s.gaps} lo={4} hi={5}/>}
      {view==="gaps_5plus" && <GapTable gaps={s.gaps} lo={5} hi={Infinity}/>}
    </div>
  );
}

function SessionAnalyzerTab({ onGoToParser }) {
  const [fileData, setFileData] = useState(null);
  const [metric, setMetric] = useState("median");
  const metrics = [{id:"median",label:"Median"},{id:"p90",label:"P90"},{id:"msgPerMin",label:"Msg/Min"},{id:"stdDev",label:"Std Dev"},{id:"longWaitPct",label:">5min %"}];

  const load = (results) => {
    const { text } = results[0];
    const d = detectInstructorAndClass(text);
    if (!d) { alert("Could not detect instructor/class."); return; }
    setFileData({ text, ...d });
  };

  const sessions = useMemo(() => {
    if (!fileData) return [];
    const allRows = parseLogForAnalytics(fileData.text, fileData.instructor);
    const byDate = {};
    for (const row of allRows) {
      if (!byDate[row.date]) byDate[row.date] = [];
      byDate[row.date].push(row);
    }
    return Object.entries(byDate).sort(([a],[b])=>a.localeCompare(b)).map(([date, rows]) => {
      const gaps = computeGaps(rows);
      return { date, rows, gaps, stats: computeStats(rows, gaps), hist: buildHistogram(gaps) };
    });
  }, [fileData]);

  const overviewData = useMemo(() => sessions.map((s,i) => ({
    session: `S${i+1} ${s.date.slice(5)}`,
    median: s.stats?.median, p90: s.stats?.p90,
    msgPerMin: s.stats?.avgMsgPerMin, stdDev: s.stats?.stdDev, longWaitPct: s.stats?.longWaitPct,
  })), [sessions]);

  return (
    <div>
      {!fileData && <AnalysisEmptyState onGoToParser={onGoToParser} />}
      <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 16, fontFamily: FONT_UI }}>
        Analyze each session individually from a full-course log.
      </p>
      <FileSourceSelector label="Full course message log" onData={load} />
      {fileData && <p style={{ fontSize:11, color:C.textMuted, marginBottom:12, fontFamily:FONT_UI }}>{fileData.instructor} · class {fileData.classId} · {sessions.length} sessions</p>}
      {sessions.length > 0 && (
        <>
          <div style={{ ...sx.card, marginBottom: 16 }}>
            <div style={{ fontFamily: FONT_UI, fontWeight: 700, color: C.text, marginBottom: 10 }}>All Sessions Overview</div>
            <div style={{ display: "flex", gap: 6, marginBottom: 12, flexWrap: "wrap" }}>
              {metrics.map(m => <button key={m.id} onClick={() => setMetric(m.id)} style={sx.btn(metric===m.id)}>{m.label}</button>)}
            </div>
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={overviewData} margin={{top:25,right:20,left:0,bottom:5}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed"/>
                <XAxis dataKey="session" tick={{fontSize:10,fill:C.textMuted}}/>
                <YAxis tick={{fontSize:11,fill:C.textMuted}}/>
                <Tooltip contentStyle={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,fontFamily:FONT_UI,fontSize:11,color:C.text}}/>
                <Bar dataKey={metric} radius={[4,4,0,0]} label={{position:"top",fontSize:10,fill:C.textMuted}}>
                  {overviewData.map((_,i) => <Cell key={i} fill={PALETTE[i%PALETTE.length]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))", gap:16 }}>
            {sessions.map((s,i) => <SessionCard key={s.date} session={s} index={i} color={PALETTE[i%PALETTE.length]}/>)}
          </div>
        </>
      )}
    </div>
  );
}

// ─── MESSAGE COUNTER TAB ──────────────────────────────────────────────────────

function MessageCounterTab({ onGoToParser }) {
  const accumulated = useRef([]);
  const [results, setResults] = useState([]);
  const [status, setStatus] = useState("");

  const load = async (fileResults) => {
    setStatus(`Reading ${fileResults.length} file(s)...`);
    for (const { text } of fileResults) {
      try {
        const d = detectInstructorAndClass(text);
        if (!d) continue;
        const counts = countByDateForAnalytics(text, d.instructor);
        for (const [date, count] of Object.entries(counts)) {
          const exists = accumulated.current.find(x => x.instructor === d.instructor && x.date === date);
          if (!exists) accumulated.current.push({ date, instructor: d.instructor, classId: d.classId, count, lesson: 0 });
        }
      } catch(e) { console.error(e); }
    }
    const instructors = [...new Set(accumulated.current.map(r => r.instructor))];
    for (const inst of instructors) {
      const rows = accumulated.current.filter(r => r.instructor === inst).sort((a,b) => a.date.localeCompare(b.date));
      rows.forEach((r,i) => r.lesson = i+1);
    }
    setResults([...accumulated.current]);
    setStatus(`Loaded ${accumulated.current.length} lesson(s) across ${instructors.length} instructor(s).`);
  };

  const instructors = [...new Set(results.map(r => r.instructor))];
  const instColors = Object.fromEntries(instructors.map((inst,i) => [inst, PALETTE[i%PALETTE.length]]));
  const maxLesson = Math.max(0, ...results.map(r => r.lesson||0));
  const chartData = Array.from({length:maxLesson}, (_,i) => {
    const row = { lesson: `L${i+1}` };
    const counts = [];
    for (const inst of instructors) {
      const match = results.find(r => r.instructor===inst && r.lesson===i+1);
      row[inst] = match ? match.count : null;
      if (match) counts.push(match.count);
    }
    row["Average"] = counts.length ? +(counts.reduce((s,x)=>s+x,0)/counts.length).toFixed(1) : null;
    return row;
  });

  return (
    <div>
      {results.length === 0 && !status && <AnalysisEmptyState onGoToParser={onGoToParser} />}
      <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 16, fontFamily: FONT_UI }}>
        Count messages per lesson across one or more instructors.
      </p>
      <FileSourceSelector label="Select files (one per instructor or multi-session)" onData={load} multiple={true} />
      {status && <div style={{ fontSize: 11, color: C.accent, marginBottom: 12, fontWeight: 700, fontFamily: FONT_UI }}>{status}</div>}
      {results.length > 0 && (
        <>
          <div style={{ display:"flex", gap:10, flexWrap:"wrap", marginBottom:16 }}>
            {instructors.map(inst => {
              const rows = results.filter(r => r.instructor===inst);
              const total = rows.reduce((s,r) => s+r.count, 0);
              return (
                <StatCard key={inst} label={inst} value={total} color={instColors[inst]}
                  sub={`${rows.length} lessons · avg ${(total/rows.length).toFixed(1)}/lesson`} />
              );
            })}
          </div>
          <div style={{ ...sx.card, marginBottom: 16 }}>
            <div style={{ fontFamily: FONT_UI, fontWeight: 700, color: C.text, marginBottom: 12 }}>Messages per Lesson</div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={chartData} margin={{top:25,right:20,left:0,bottom:5}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8eaed"/>
                <XAxis dataKey="lesson" tick={{fontSize:11,fill:C.textMuted}}/>
                <YAxis tick={{fontSize:11,fill:C.textMuted}}/>
                <Tooltip contentStyle={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:6,fontFamily:FONT_UI,fontSize:11,color:C.text}}/>
                <Legend wrapperStyle={{fontFamily:FONT_UI,fontSize:11}}/>
                {instructors.map(inst => <Bar key={inst} dataKey={inst} fill={instColors[inst]} radius={[3,3,0,0]}/>)}
                <Bar dataKey="Average" fill={C.textMuted} radius={[3,3,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div style={{ ...sx.card, padding: 0, overflow: "hidden", marginBottom: 12 }}>
            <div style={{ padding:"10px 14px", background: C.navy, borderBottom:`1px solid ${C.border}` }}>
              <span style={{ fontFamily:FONT_UI, fontWeight:700, color:"#ffffff", fontSize:13 }}>Lesson Comparison</span>
            </div>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width:"100%", borderCollapse:"collapse", minWidth:400 }}>
                <thead><tr>
                  <th style={sx.th}>Lesson</th>
                  <th style={{...sx.th, color:C.textMuted}}>Avg</th>
                  {instructors.map(inst => <th key={inst} style={{...sx.th, color:instColors[inst]}}>{inst}</th>)}
                </tr></thead>
                <tbody>
                  {Array.from({length:maxLesson}, (_,i) => {
                    const lesson = i+1;
                    const matches = results.filter(r => r.lesson===lesson);
                    if (!matches.length) return null;
                    const avg = matches.reduce((s,r) => s+r.count, 0) / matches.length;
                    return (
                      <tr key={lesson}>
                        <td style={{...sx.td, fontWeight:600, color:C.text}}>L{lesson}</td>
                        <td style={{...sx.td, fontWeight:700, color:C.textMuted}}>{avg.toFixed(1)}</td>
                        {instructors.map(inst => {
                          const match = results.find(r => r.instructor===inst && r.lesson===lesson);
                          const val = match ? match.count : null;
                          const diff = val !== null ? val - avg : null;
                          return (
                            <td key={inst} style={sx.td}>
                              {val !== null
                                ? <span style={{color:C.text}}><strong>{val}</strong><span style={{fontSize:10,marginLeft:6,color:diff>0?C.accent:diff<0?C.danger:C.textMuted}}>{diff>0?`+${diff.toFixed(0)}`:diff<0?diff.toFixed(0):"—"}</span></span>
                                : <span style={{color:C.textDim}}>—</span>}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <button onClick={() => { accumulated.current=[]; setResults([]); setStatus(""); }}
            style={{ padding:"6px 14px", borderRadius:6, border:`1px solid ${C.danger}44`, background:"transparent", color:C.danger, cursor:"pointer", fontSize:12, fontFamily:FONT_UI }}>
            Clear all
          </button>
        </>
      )}
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────

const TABS = [
  { id: "parser",  label: "📥 Parser", startHere: true },
  { id: "gap",     label: "📊 Gap Analyzer" },
  { id: "session", label: "🗓 Session Analyzer" },
  { id: "counter", label: "🔢 Message Counter" },
];

// Empty state shown in analysis tabs when no data is loaded
function AnalysisEmptyState({ onGoToParser }) {
  return (
    <div style={{ border: `2px dashed ${C.border}`, borderRadius: 12, padding: "32px 24px", textAlign: "center", marginBottom: 24, background: C.surfaceAlt }}>
      <div style={{ fontSize: 28, marginBottom: 12 }}>📥</div>
      <div style={{ fontFamily: FONT_UI, fontSize: 13, color: C.text, fontWeight: 700, marginBottom: 8 }}>
        No data loaded yet
      </div>
      <div style={{ fontFamily: FONT_UI, fontSize: 12, color: C.textMuted, marginBottom: 16, lineHeight: 1.7 }}>
        This tool runs on CSVs generated by the <strong style={{ color: C.accent }}>Parser</strong> tab.<br/>
        Parse an AoPS HTML file there first, then add it to the Shelf — or upload a saved CSV directly below.
      </div>
      <button onClick={onGoToParser}
        style={{ padding: "8px 20px", background: C.accent, color: "#ffffff", border: "none", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: FONT_UI }}>
        Go to Parser →
      </button>
    </div>
  );
}

export default function App() {
  useGoogleFont("https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap");
  const [tab, setTab] = useState("parser");
  const [shelf, setShelf] = useState([]);
  const nextId = useRef(1);

  const addToShelf = useCallback((item) => {
    setShelf(prev => [...prev, { ...item, id: nextId.current++ }]);
  }, []);

  const removeFromShelf = useCallback((id) => {
    setShelf(prev => prev.filter(i => i.id !== id));
  }, []);

  const goToParser = useCallback(() => setTab("parser"), []);

  return (
    <ShelfContext.Provider value={{ shelf, addToShelf, removeFromShelf }}>
      <div style={{ fontFamily: FONT_UI, background: C.bg, color: C.text, minHeight: "100vh" }}>
        {/* Header */}
        <div style={{ background: C.navy, borderBottom: `1px solid ${C.navyDark}`, padding: "14px 24px", display: "flex", alignItems: "baseline", gap: 16 }}>
          <h1 style={{ margin: 0, fontSize: 18, color: "#ffffff", fontWeight: 700, letterSpacing: "-0.01em", fontFamily: FONT_UI }}>
            Ops<span style={{ color: C.accent }}>Board</span>
          </h1>
          <span style={{ fontSize: 11, color: "#9ab0c8", fontFamily: FONT_UI }}>Instructor, Assistant &amp; Helper Analytics</span>
        </div>

        {/* Shelf */}
        <Shelf />

        {/* Tabs */}
        <div style={{ display: "flex", borderBottom: `1px solid ${C.border}`, background: C.surface, boxShadow: "0 1px 3px rgba(27,54,93,0.08)" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              style={{ padding: "11px 20px", border: "none", borderBottom: tab===t.id ? `2px solid ${C.accent}` : "2px solid transparent",
                cursor: "pointer", fontSize: 12, fontWeight: tab===t.id ? 700 : 400, fontFamily: FONT_UI,
                background: "transparent", color: tab===t.id ? C.accent : C.textMuted, marginBottom: -1,
                transition: "color 0.15s", display: "flex", alignItems: "center", gap: 6 }}>
              {t.label}
              {t.startHere && tab !== t.id && (
                <span style={{ fontSize: 9, background: C.accent, color: "#ffffff", fontFamily: FONT_UI, borderRadius: 4, padding: "1px 6px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
                  Start here
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Content */}
        <div style={{ padding: 24, maxWidth: 1200, margin: "0 auto" }}>
          {tab === "parser"  && <ParserTab />}
          {tab === "gap"     && <GapAnalyzerTab     onGoToParser={goToParser} />}
          {tab === "session" && <SessionAnalyzerTab onGoToParser={goToParser} />}
          {tab === "counter" && <MessageCounterTab  onGoToParser={goToParser} />}
        </div>
      </div>
    </ShelfContext.Provider>
  );
}