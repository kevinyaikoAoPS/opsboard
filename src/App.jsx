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
  const rows = getAnalyticsRows(text).filter(r => {
    if (r.sender !== instructor || r.message_type !== "class") return false;
    // Ignore messages before 7:29 PM (pre-class setup)
    const h = parseInt(r.time.slice(0, 2), 10);
    const min = parseInt(r.time.slice(3, 5), 10);
    if (h < 19 || (h === 19 && min < 29)) return false;
    return true;
  });
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
  const [stripMessages, setStripMessages] = useState(false);

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
    const exportRows = stripMessages
      ? rows.map(({ message, ...rest }) => ({ ...rest, message: "" }))
      : rows;
    const csv = toCSV(exportRows);
    const sender = rows[0]?.sender || "log";
    const allDates = [...new Set(rows.map(r => r.date))].sort();
    const suffix = stripMessages ? "_no_messages" : "";
    const uri = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
    const a = document.createElement("a");
    a.href = uri;
    a.download = `${sender}_${allDates[0]}_to_${allDates[allDates.length-1]}${suffix}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  };

  const handleClear = () => {
    setParsed(false); setInput(""); setRows([]); setFileLoaded(""); setStatus(""); setAddedToShelf(false); setStripMessages(false);
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

          {/* Action row: shelf / download / strip toggle / clear */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
            <button onClick={handleAddToShelf} disabled={addedToShelf}
              style={{ padding: "7px 16px", background: addedToShelf ? C.accentDim : C.accent, color: addedToShelf ? C.accent : "#ffffff", border: `1px solid ${C.accent}`, borderRadius: 6, cursor: addedToShelf ? "default" : "pointer", fontSize: 12, fontWeight: 700, fontFamily: FONT_UI }}>
              {addedToShelf ? "✓ On Shelf" : "📦 Add to Shelf"}
            </button>
            <button onClick={handleDownload}
              style={{ padding: "7px 16px", background: C.accent, color: "#ffffff", border: `1px solid ${C.accent}`, borderRadius: 6, cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: FONT_UI }}>
              ⬇ Download CSV
            </button>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 12, color: C.textMuted, fontFamily: FONT_UI, padding: "7px 12px", border: `1px solid ${stripMessages ? C.accent : C.border}`, borderRadius: 6, background: stripMessages ? C.accentDim : "transparent", userSelect: "none" }}>
              <input type="checkbox" checked={stripMessages} onChange={e => setStripMessages(e.target.checked)} style={{ accentColor: C.accent, width: 14, height: 14 }} />
              <span style={{ color: stripMessages ? C.accent : C.textMuted, fontWeight: stripMessages ? 700 : 400 }}>Strip message content</span>
            </label>
            <button onClick={handleClear}
              style={{ padding: "7px 20px", background: C.danger, color: "#ffffff", border: "none", borderRadius: 6, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: FONT_UI, marginLeft: "auto" }}>
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

// ─── ASSISTANT SCORER TAB ─────────────────────────────────────────────────────

const COURSE_TIERS = {"prealgebra1":"intro_math","prealgebra2":"intro_math","algebra-a":"intro_math","algebra-b":"intro_math","intro-geometry":"intro_math","intro-counting":"intro_math","intro-numbertheory":"intro_math","paradoxes-camp":"intro_math","intermediate-algebra":"interm_math","intermediate-counting":"interm_math","intermediate-numbertheory":"interm_math","precalc":"interm_math","mathcounts-basics":"interm_math","mathcounts-advanced":"interm_math","maa-amc10":"interm_math","maa-amc10-final-five":"interm_math","maa-amc12":"interm_math","maa-aimea":"interm_math","maa-aimeb":"interm_math","calculus":"adv_math","olympiad-geometry":"adv_math","grouptheory":"adv_math","fma":"woot","relativity-camp":"woot","intro-physics":"physics","physics1":"physics","python1":"cs","python2":"cs","cs-bronze":"cs"};

const TIER_LABELS = { intro_math: "Intro Math", interm_math: "Interm. Math", adv_math: "Adv. Math", woot: "WOOT", physics: "Physics", cs: "CS" };

const TIER_STATS = {"wps_p25":{"adv_math":1.344,"cs":0.743,"interm_math":1.0,"intro_math":1.212,"physics":1.401,"woot":1.145},"wps_p50":{"adv_math":1.725,"cs":1.0,"interm_math":1.412,"intro_math":1.885,"physics":1.96,"woot":1.5},"wps_p75":{"adv_math":2.152,"cs":1.398,"interm_math":2.083,"intro_math":2.705,"physics":2.445,"woot":2.302},"wpq_p25":{"adv_math":0.0586,"cs":0.033,"interm_math":0.0437,"intro_math":0.0414,"physics":0.0578,"woot":0.052},"wpq_p50":{"adv_math":0.0845,"cs":0.0505,"interm_math":0.0668,"intro_math":0.0638,"physics":0.0858,"woot":0.0734},"wpq_p75":{"adv_math":0.1352,"cs":0.0744,"interm_math":0.1047,"intro_math":0.0901,"physics":0.125,"woot":0.1111},"cov1_p25":{"adv_math":0.5,"cs":0.3582,"interm_math":0.4516,"intro_math":0.5354,"physics":0.5619,"woot":0.4787},"cov1_p50":{"adv_math":0.5849,"cs":0.4545,"interm_math":0.5797,"intro_math":0.6818,"physics":0.6472,"woot":0.6165},"cov1_p75":{"adv_math":0.7205,"cs":0.5901,"interm_math":0.7143,"intro_math":0.7887,"physics":0.7517,"woot":0.7907},"cov2_p25":{"adv_math":0.3077,"cs":0.1698,"interm_math":0.2333,"intro_math":0.2893,"physics":0.3333,"woot":0.2537},"cov2_p50":{"adv_math":0.381,"cs":0.2321,"interm_math":0.3455,"intro_math":0.4302,"physics":0.4249,"woot":0.3418},"cov2_p75":{"adv_math":0.4753,"cs":0.3282,"interm_math":0.4615,"intro_math":0.5656,"physics":0.5374,"woot":0.4615},"gap_p25":{"adv_math":46.5,"cs":55.0,"interm_math":34.5,"intro_math":30.375,"physics":43.375,"woot":44.0},"gap_p50":{"adv_math":64.0,"cs":82.25,"interm_math":48.0,"intro_math":44.0,"physics":57.75,"woot":69.5},"gap_p75":{"adv_math":90.0,"cs":107.625,"interm_math":72.0,"intro_math":65.5,"physics":78.625,"woot":94.625},"praise_p75":{"adv_math":0.0582,"cs":0.0,"interm_math":0.0526,"intro_math":0.0702,"physics":0.0936,"woot":0.0318},"praise_p90":{"adv_math":0.091,"cs":0.0664,"interm_math":0.1278,"intro_math":0.1466,"physics":0.2212,"woot":0.0861},"lg_p25":{"adv_math":0.1692,"cs":0.2796,"interm_math":0.08,"intro_math":0.0,"physics":0.0615,"woot":0.1158},"lg_p50":{"adv_math":0.2916,"cs":0.4401,"interm_math":0.2285,"intro_math":0.1214,"physics":0.1702,"woot":0.283},"lg_p75":{"adv_math":0.4444,"cs":0.6073,"interm_math":0.4239,"intro_math":0.2991,"physics":0.3771,"woot":0.4768}};

function scoreMetric(val, p25, p50, p75, invert = false, maxPts = 20) {
  if (val == null || isNaN(val)) return maxPts * 0.5;
  const full = maxPts, hi = maxPts * 0.75, mid = maxPts * 0.4;
  if (invert) {
    if (val <= p25) return full;
    if (val <= p50) return full - (maxPts*0.25) * (val-p25)/(p50-p25);
    if (val <= p75) return hi - (maxPts*0.35) * (val-p50)/(p75-p50);
    return Math.max(0, mid - mid * (val-p75)/p75);
  } else {
    if (val >= p75) return full;
    if (val >= p50) return full - (maxPts*0.25) * (p75-val)/(p75-p50);
    if (val >= p25) return hi - (maxPts*0.35) * (p50-val)/(p50-p25);
    return Math.max(0, mid - mid * (p25-val)/p25);
  }
}

const COURSE_DURATION = {
  prealgebra1: 75, prealgebra2: 75,
  calculus: 120, grouptheory: 120, 'olympiad-geometry': 120,
  'relativity-camp': 180,
};
function getCourseDuration(courseId) {
  return COURSE_DURATION[courseId] || 90;
}

function getLongGapStats(gapsSec, activeSec, thresholdSec = 300) {
  const longGaps = gapsSec.filter(g => g >= thresholdSec);
  const maxGap = gapsSec.length ? Math.max(...gapsSec) : 0;
  const totalLongGapSec = longGaps.reduce((a, b) => a + b, 0);
  const longGapPct = activeSec > 0 ? totalLongGapSec / activeSec : 0;
  return { longGapCount: longGaps.length, maxGap, longGapPct };
}

function getFlags(pctPraise, praise_p75, praise_p90, pctIdle, nChains, longGapCount, longGapPct, maxGap, activeMinutes, courseId) {
  const flags = [];
  const expectedMin = getCourseDuration(courseId);

  // Idle chain flags
  if (nChains === 1 || nChains === 2)
    flags.push({ level: "critical", text: `${nChains} idle-whisper chain${nChains > 1 ? "s" : ""} detected` });
  else if (nChains >= 3)
    flags.push({ level: "warning", text: `${nChains} idle-whisper chains detected` });

  // Long gap flags — based on % of active session in gaps > 5 min
  if (longGapPct >= 0.40)
    flags.push({ level: "critical", text: `${(longGapPct*100).toFixed(0)}% of session in long gaps (max ${Math.round(maxGap/60)}m ${Math.round(maxGap%60)}s)` });
  else if (longGapPct >= 0.20 || (longGapCount >= 3 && longGapPct > 0))
    flags.push({ level: "warning", text: `${(longGapPct*100).toFixed(0)}% of session in long gaps (${longGapCount} gap${longGapCount !== 1 ? "s" : ""} over 5 min)` });

  // Praise blast flags
  if (pctPraise > praise_p90)
    flags.push({ level: "warning", text: `High praise blast rate (${(pctPraise*100).toFixed(0)}%)` });
  else if (pctPraise > praise_p75)
    flags.push({ level: "note", text: `Elevated praise blast rate (${(pctPraise*100).toFixed(0)}%)` });

  return flags;
}

function detectIdleChains(whispers) {
  // whispers: [{timestamp (ms), char_count}] sorted by time, same sender/session
  let nChains = 0, idleCount = 0;
  const gaps = [];
  for (let i = 1; i < whispers.length; i++) gaps.push(whispers[i].timestamp - whispers[i-1].timestamp);
  const validGaps = gaps.filter(g => g > 0 && g < 7200000);
  const sessionMedian = validGaps.length >= 3
    ? [...validGaps].sort((a,b)=>a-b)[Math.floor(validGaps.length/2)] : null;

  let i = 0;
  while (i < whispers.length - 4) {
    let j = i + 1;
    while (j < whispers.length) {
      const dt = (whispers[j].timestamp - whispers[j-1].timestamp) / 1000;
      const dc = Math.abs(whispers[j].char_count - whispers[i].char_count);
      if (dc <= 2 && dt >= 1 && dt <= 6) j++;
      else break;
    }
    if (j - i >= 5) {
      // Check if anomalously fast
      const chainGaps = [];
      for (let k = i+1; k < j; k++) chainGaps.push(whispers[k].timestamp - whispers[k-1].timestamp);
      const avgChainGap = chainGaps.reduce((s,g)=>s+g,0)/chainGaps.length;
      if (sessionMedian && avgChainGap < sessionMedian * 0.5) {
        nChains++;
        idleCount += (j - i);
      }
      i = j;
    } else i++;
  }
  return { nChains, idleCount };
}

function scoreSession(whispers, numStudents, numQueued, courseId) {
  const tier = COURSE_TIERS[courseId] || null;
  const ts = tier ? TIER_STATS : null;

  // Filter to whispers only
  const ws = whispers.filter(r => r.message_type === "whisper" && r.is_image_only !== true && r.is_image_only !== "true");
  if (!ws.length || !tier || !ts) return null;

  const sorted = [...ws].sort((a,b) => new Date(a.timestamp) - new Date(b.timestamp));
  const nWhispers = sorted.length;
  // Coverage split: 1+ and 2+
  const recipientCounts = {};
  sorted.forEach(r => { recipientCounts[r.recipient] = (recipientCounts[r.recipient] || 0) + 1; });
  const n1plus = Object.values(recipientCounts).filter(c => c >= 1).length;
  const n2plus = Object.values(recipientCounts).filter(c => c >= 2).length;
  const coverage1plus = numStudents > 0 ? n1plus / numStudents : 0;
  const coverage2plus = numStudents > 0 ? n2plus / numStudents : 0;

  const uniqueRecipients = n1plus;
  const wps = numStudents > 0 ? nWhispers / numStudents : 0;
  const wpq = numQueued > 0 ? nWhispers / numQueued : 0;

  // Median gap
  const tsorted = sorted.map(r => new Date(r.timestamp).getTime());
  const gapsSec = [];
  for (let i = 1; i < tsorted.length; i++) {
    const g = (tsorted[i] - tsorted[i-1]) / 1000;
    if (g > 0 && g < 7200) gapsSec.push(g);
  }
  const medianGap = gapsSec.length
    ? [...gapsSec].sort((a,b)=>a-b)[Math.floor(gapsSec.length/2)] : 0;

  // Multi-whisper / praise flags
  const tsMap = {};
  sorted.forEach(r => {
    const key = `${r.timestamp}|${r.char_count}`;
    tsMap[key] = (tsMap[key]||0) + 1;
  });
  let nPraiseMulti = 0;
  sorted.forEach(r => {
    const key = `${r.timestamp}|${r.char_count}`;
    if (tsMap[key] > 1 && r.char_count <= 15) nPraiseMulti++;
  });
  const pctPraise = nWhispers > 0 ? nPraiseMulti / nWhispers : 0;

  // Idle chain detection
  const wsForChain = sorted.map(r => ({ timestamp: new Date(r.timestamp).getTime(), char_count: r.char_count }));
  const { nChains, idleCount } = detectIdleChains(wsForChain);
  const pctIdle = nWhispers > 0 ? idleCount / nWhispers : 0;

  const activeMinutes = (tsorted[tsorted.length-1] - tsorted[0]) / 60000;
  const activeSec = activeMinutes * 60;
  const { longGapCount, maxGap, longGapPct } = getLongGapStats(gapsSec, activeSec);

  const t = TIER_STATS;
  const sVol   = scoreMetric(wps, t.wps_p25[tier], t.wps_p50[tier], t.wps_p75[tier], false, 20);
  const sQueue = scoreMetric(wpq, t.wpq_p25[tier], t.wpq_p50[tier], t.wpq_p75[tier], false, 30);
  const sCov1  = scoreMetric(coverage1plus, t.cov1_p25[tier], t.cov1_p50[tier], t.cov1_p75[tier], false, 10);
  const sCov2  = scoreMetric(coverage2plus, t.cov2_p25[tier], t.cov2_p50[tier], t.cov2_p75[tier], false, 10);
  const sPace  = scoreMetric(medianGap, t.gap_p25[tier], t.gap_p50[tier], t.gap_p75[tier], true, 20);
  const sLongGap = scoreMetric(longGapPct, t.lg_p25[tier], t.lg_p50[tier], t.lg_p75[tier], true, 10);
  const total  = sVol + sQueue + sCov1 + sCov2 + sPace + sLongGap;

  const flags = getFlags(pctPraise, t.praise_p75[tier], t.praise_p90[tier], pctIdle, nChains,
                         longGapCount, longGapPct, maxGap, activeMinutes, courseId);

  return {
    tier, tierLabel: TIER_LABELS[tier],
    nWhispers, uniqueRecipients, numStudents, numQueued,
    wps: +wps.toFixed(3), wpq: +wpq.toFixed(4),
    coverage1plus: +coverage1plus.toFixed(3), coverage2plus: +coverage2plus.toFixed(3),
    medianGap: +medianGap.toFixed(1), pctPraise: +pctPraise.toFixed(3),
    pctIdle: +pctIdle.toFixed(3), nChains, flags,
    longGapCount, longGapPct: +longGapPct.toFixed(3),
    maxGap: +maxGap.toFixed(0), activeMinutes: +activeMinutes.toFixed(1),
    expectedMinutes: getCourseDuration(courseId),
    scores: {
      volume: +sVol.toFixed(1), queue: +sQueue.toFixed(1),
      cov1: +sCov1.toFixed(1), cov2: +sCov2.toFixed(1),
      pacing: +sPace.toFixed(1), longGap: +sLongGap.toFixed(1),
      total: +total.toFixed(1),
    }
  };
}

function ScoreMeter({ label, value, max = 20, color }) {
  const pct = Math.min(100, (value / max) * 100);
  const barColor = value < max * 0.4 ? C.danger : value < max * 0.7 ? C.warn : color || C.accent;
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
        <span style={{ fontSize: 11, color: C.textMuted, fontFamily: FONT_UI }}>{label}</span>
        <span style={{ fontSize: 12, fontWeight: 700, color: barColor, fontFamily: FONT }}>{value} <span style={{ color: C.textDim, fontWeight: 400 }}>/ {max}</span></span>
      </div>
      <div style={{ height: 6, background: C.surfaceAlt, borderRadius: 3, overflow: "hidden", border: `1px solid ${C.border}` }}>
        <div style={{ height: "100%", width: `${pct}%`, background: barColor, borderRadius: 3, transition: "width 0.4s ease" }} />
      </div>
    </div>
  );
}

function ScoreBadge({ score }) {
  const color = score >= 80 ? C.accent : score >= 60 ? C.warn : C.danger;
  const label = score >= 80 ? "Strong" : score >= 60 ? "Average" : "Flag";
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      width: 80, height: 80, borderRadius: "50%", border: `3px solid ${color}`,
      background: `${color}12`, flexShrink: 0 }}>
      <span style={{ fontSize: 22, fontWeight: 700, color, fontFamily: FONT, lineHeight: 1 }}>{Math.round(score)}</span>
      <span style={{ fontSize: 9, color, fontFamily: FONT_UI, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</span>
    </div>
  );
}

function SessionScoreCard({ result, sessionLabel }) {
  const { scores, tier, tierLabel, nWhispers, uniqueRecipients, numStudents, numQueued,
    wps, coverage1plus, coverage2plus, medianGap, pctPraise, pctIdle, nChains, flags,
    longGapCount, longGapPct, maxGap, activeMinutes, expectedMinutes } = result;

  const [expanded, setExpanded] = useState(false);

  // Activity-based flags (always shown in header)
  const activityFlags = [];
  if (scores.total < 50) activityFlags.push({ text: "Low overall — recommend observation", color: C.danger });
  if (scores.pacing < 8) activityFlags.push({ text: "Long idle gaps detected", color: C.danger });
  if (scores.volume < 8) activityFlags.push({ text: "Low whisper volume vs. peers", color: C.warn });
  if (scores.cov1 < 4) activityFlags.push({ text: "Low broad coverage", color: C.warn });
  if (scores.cov2 < 4) activityFlags.push({ text: "Low deep coverage", color: C.warn });

  // Quality flags styling
  const flagColors = { critical: C.danger, warning: C.warn, note: C.accent };
  const flagIcons  = { critical: "⚑", warning: "⚠", note: "ℹ" };

  return (
    <div style={{ ...sx.card, borderTop: `3px solid ${scores.total >= 80 ? C.accent : scores.total >= 60 ? C.warn : C.danger}`, marginBottom: 16 }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "center", gap: 16, marginBottom: 14 }}>
        <ScoreBadge score={scores.total} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontWeight: 700, fontSize: 14, color: C.text, fontFamily: FONT_UI, marginBottom: 2 }}>{sessionLabel}</div>
          <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FONT_UI }}>
            {tierLabel} &nbsp;·&nbsp; {nWhispers} whispers &nbsp;·&nbsp; {numStudents} students &nbsp;·&nbsp; {numQueued} queued
          </div>
          {activityFlags.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
              {activityFlags.map((f, i) => (
                <span key={i} style={{ fontSize: 10, background: `${f.color}18`, color: f.color,
                  border: `1px solid ${f.color}44`, borderRadius: 10, padding: "2px 8px",
                  fontFamily: FONT_UI, fontWeight: 600 }}>
                  ⚠ {f.text}
                </span>
              ))}
            </div>
          )}
        </div>
        <button onClick={() => setExpanded(e => !e)}
          style={{ ...sx.btn(expanded), fontSize: 11, whiteSpace: "nowrap" }}>
          {expanded ? "Hide details ▲" : "Details ▼"}
        </button>
      </div>

      {/* Score bars */}
      <ScoreMeter label="Volume (whispers/student)" value={scores.volume} max={20} />
      <ScoreMeter label="Queue engagement (whispers per 100 queued)" value={scores.queue} max={30} />
      <ScoreMeter label="Broad coverage (students reached 1+ times)" value={scores.cov1} max={10} />
      <ScoreMeter label="Deep coverage (students reached 2+ times)" value={scores.cov2} max={10} />
      <ScoreMeter label="Pacing (median gap between whispers)" value={scores.pacing} max={20} />
      <ScoreMeter label="Long gap % (% of session in 5+ min gaps)" value={scores.longGap} max={10} />

      {/* Quality flags section */}
      {flags.length > 0 && (
        <div style={{ marginTop: 10, padding: "8px 12px", borderRadius: 7,
          background: C.surfaceAlt, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: C.textMuted, fontFamily: FONT_UI,
            textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 6 }}>Quality Flags</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {flags.map((f, i) => {
              const color = flagColors[f.level];
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={{ fontSize: 11, color, fontWeight: 700 }}>{flagIcons[f.level]}</span>
                  <span style={{ fontSize: 11, color, fontFamily: FONT_UI, fontWeight: 600 }}>{f.text}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Expanded detail */}
      {expanded && (
        <div style={{ marginTop: 14, padding: "12px 14px", background: C.surfaceAlt, borderRadius: 8, border: `1px solid ${C.border}` }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
            {[
              { label: "Tier", value: tierLabel },
              { label: "Whispers / Student", value: wps },
              { label: "Whispers / 100 Queued", value: (result.wpq * 100).toFixed(2) },
              { label: "Broad Coverage (1+)", value: (coverage1plus * 100).toFixed(0) + "%" },
              { label: "Deep Coverage (2+)", value: (coverage2plus * 100).toFixed(0) + "%" },
              { label: "Median Gap", value: medianGap + "s" },
              { label: "Max Gap", value: maxGap >= 60 ? `${Math.round(maxGap/60)}m ${Math.round(maxGap%60)}s` : `${maxGap}s`, warn: maxGap > 300 },
              { label: "Long Gaps (5+ min)", value: longGapCount, warn: longGapCount >= 1 },
              { label: "% Session in Long Gaps", value: (longGapPct * 100).toFixed(1) + "%", warn: longGapPct >= 0.20 },
              { label: "Unique Recipients", value: `${uniqueRecipients} / ${numStudents}` },
              { label: "Praise Blast (short multi) %", value: (pctPraise * 100).toFixed(1) + "%", warn: pctPraise > 0.12 },
              { label: "Idle Chains", value: nChains, warn: nChains >= 1 },
              { label: "Idle Whisper %", value: (pctIdle * 100).toFixed(1) + "%", warn: pctIdle > 0.1 },
            ].map(item => (
              <div key={item.label} style={{ background: C.surface, borderRadius: 6, padding: "7px 10px", border: `1px solid ${C.border}` }}>
                <div style={{ ...sx.label, marginBottom: 2 }}>{item.label}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: item.warn ? C.warn : C.text, fontFamily: FONT }}>{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function AssistantQualityTab() {
  const { shelf } = useShelf();
  const [zoomText, setZoomText]       = useState("");
  const [zoomLoaded, setZoomLoaded]   = useState("");
  // whisper sources: array of { text, name }
  const [whisperSources, setWhisperSources] = useState([]);
  const [results, setResults]         = useState(null);
  const [warnings, setWarnings]       = useState([]);
  const [error, setError]             = useState("");
  const [filterTier, setFilterTier]   = useState("all");
  const [sortBy, setSortBy]           = useState("date");
  const [activeAsst, setActiveAsst]   = useState(null);
  const [whisperMode, setWhisperMode] = useState(shelf.length > 0 ? "shelf" : "upload");

  // Reset active assistant when results change
  useEffect(() => {
    if (results) setActiveAsst(results.assistants[0]?.assistant || null);
  }, [results]);

  const handleZoom = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    setZoomText(await f.text()); setZoomLoaded(f.name); setResults(null); setError("");
  };

  const handleWhisperUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (!files.length) return;
    const sources = await Promise.all(files.map(async f => ({ text: await f.text(), name: f.name })));
    setWhisperSources(sources); setResults(null); setError("");
  };

  const handleShelfPick = (item) => {
    const text = toCSV(item.rows);
    setWhisperSources(prev => {
      // Toggle: if already in list, remove; else add
      const exists = prev.find(s => s.name === item.label);
      if (exists) return prev.filter(s => s.name !== item.label);
      return [...prev, { text, name: item.label }];
    });
    setResults(null); setError("");
  };

  const handleScore = () => {
    setError(""); setWarnings([]); setResults(null);
    try {
      // Parse zoom CSV
      const zoomRows = parseCSV(zoomText).filter(r => r.lesson_date && r.class_id);
      if (!zoomRows.length) { setError("Could not parse ZoomData CSV. Check the file format."); return; }
      if (!whisperSources.length) { setError("No whisper log files loaded."); return; }

      // Parse and combine all whisper log sources
      const allRows = [];
      for (const src of whisperSources) {
        const rows = parseCSV(src.text).filter(r => r.message_type && r.sender);
        allRows.push(...rows);
      }
      if (!allRows.length) { setError("Could not parse any whisper rows. Check the file format."); return; }

      // Username mismatch check
      const senders = [...new Set(allRows.filter(r => r.message_type === "whisper").map(r => r.sender))];
      const warn = [];
      if (senders.length > 2) {
        warn.push(`Whisper logs contain ${senders.length} different senders: ${senders.join(", ")}. Each will be scored separately if matched in ZoomData.`);
      }

      // Expand multi-assistant zoom sessions
      const sessions = [];
      for (const z of zoomRows) {
        const assistants = (z.assistants || "").split(",").map(a => a.trim()).filter(Boolean);
        for (const asst of assistants) sessions.push({ ...z, assistant: asst });
      }

      // Group whispers by sender + date
      const whispersByKey = {};
      for (const r of allRows) {
        if (r.message_type !== "whisper") continue;
        const date = (r.timestamp || r.date || "").slice(0, 10);
        const key = `${r.sender}|${date}`;
        if (!whispersByKey[key]) whispersByKey[key] = [];
        whispersByKey[key].push({ ...r, char_count: parseInt(r.char_count) || 0 });
      }

      // Score each matching session
      const scoredSessions = [];
      for (const s of sessions) {
        const date = (s.lesson_date || "").slice(0, 10);
        const key = `${s.assistant}|${date}`;
        const whispers = whispersByKey[key] || [];
        if (!whispers.length) continue;
        const result = scoreSession(whispers, parseInt(s.num_students) || 0, parseInt(s.num_queued) || 0, s.course_id || "");
        if (!result) continue;
        scoredSessions.push({ assistant: s.assistant, date, courseId: s.course_id, classId: s.class_id, lesson: s.lesson, result });
      }

      if (!scoredSessions.length) {
        setError("No matching sessions found. Make sure assistant names and dates align between the ZoomData and whisper log files.");
        return;
      }

      // Warn about senders in whisper logs not found in ZoomData
      const matchedAssistants = new Set(scoredSessions.map(s => s.assistant));
      const unmatched = senders.filter(s => !matchedAssistants.has(s));
      if (unmatched.length) warn.push(`Sender(s) in whisper logs not found in ZoomData: ${unmatched.join(", ")}`);

      // Aggregate per assistant
      const byAsst = {};
      for (const s of scoredSessions) {
        if (!byAsst[s.assistant]) byAsst[s.assistant] = { sessions: [], assistant: s.assistant };
        byAsst[s.assistant].sessions.push(s);
      }
      const assistants = Object.values(byAsst).map(a => {
        const totals = a.sessions.map(s => s.result.scores.total);
        return {
          ...a,
          avgScore: +(totals.reduce((x,y)=>x+y,0)/totals.length).toFixed(1),
          minScore: +Math.min(...totals).toFixed(1),
          sessionCount: a.sessions.length,
        };
      }).sort((a,b) => b.avgScore - a.avgScore);

      setWarnings(warn);
      setResults({ assistants, totalSessions: scoredSessions.length });
    } catch(e) {
      setError("Error processing files: " + e.message);
    }
  };

  const allTiers = results
    ? [...new Set(results.assistants.flatMap(a => a.sessions.map(s => s.result.tier)))]
    : [];

  const activeData = results?.assistants.find(a => a.assistant === activeAsst);

  const filteredSessions = useMemo(() => {
    if (!activeData) return [];
    let ss = [...activeData.sessions];
    if (filterTier !== "all") ss = ss.filter(s => s.result.tier === filterTier);
    if (sortBy === "date") ss.sort((a,b) => a.date.localeCompare(b.date));
    else if (sortBy === "score_asc") ss.sort((a,b) => a.result.scores.total - b.result.scores.total);
    else ss.sort((a,b) => b.result.scores.total - a.result.scores.total);
    return ss;
  }, [activeData, filterTier, sortBy]);

  const ready = zoomText && whisperSources.length > 0;

  return (
    <div>
      <p style={{ fontSize: 12, color: C.textMuted, marginBottom: 16, fontFamily: FONT_UI, lineHeight: 1.7 }}>
        Load a <strong style={{ color: C.text }}>ZoomData CSV</strong> and one or more <strong style={{ color: C.text }}>WhisperLog files</strong> to score assistant performance across sessions.
        Scores are tier-adjusted across six dimensions: volume, queue engagement, broad coverage, deep coverage, pacing, and quality flags.
      </p>

      {/* ── File loading card ── */}
      <div style={{ ...sx.card, marginBottom: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: C.text, fontFamily: FONT_UI, marginBottom: 12 }}>Load Files</div>

        <div style={{ display: "flex", gap: 16, flexWrap: "wrap", alignItems: "flex-start" }}>
          {/* ZoomData upload */}
          <div style={{ flex: "1 1 200px" }}>
            <div style={{ ...sx.label, marginBottom: 6 }}>ZoomData CSV</div>
            <label style={{ display: "flex", alignItems: "center", gap: 10,
              border: `2px dashed ${zoomLoaded ? C.accent : C.border}`, borderRadius: 8,
              padding: "10px 14px", cursor: "pointer",
              background: zoomLoaded ? C.accentDim : C.surfaceAlt }}>
              <span style={{ fontSize: 18 }}>{zoomLoaded ? "✓" : "📂"}</span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: zoomLoaded ? C.accent : C.textMuted, fontFamily: FONT_UI }}>
                  {zoomLoaded || "Select CSV file"}
                </div>
              </div>
              <input type="file" accept=".csv" onChange={handleZoom} style={{ display: "none" }} />
            </label>
          </div>

          {/* Whisper log source selector */}
          <div style={{ flex: "2 1 300px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ ...sx.label }}>WhisperLog(s)</div>
              {shelf.length > 0 && (
                <>
                  <button style={sx.btn(whisperMode === "shelf")} onClick={() => setWhisperMode("shelf")}>From Shelf</button>
                  <button style={sx.btn(whisperMode === "upload")} onClick={() => setWhisperMode("upload")}>Upload</button>
                </>
              )}
            </div>

            {whisperMode === "upload" ? (
              <label style={{ display: "flex", alignItems: "center", gap: 10,
                border: `2px dashed ${whisperSources.length ? C.accent : C.border}`, borderRadius: 8,
                padding: "10px 14px", cursor: "pointer",
                background: whisperSources.length ? C.accentDim : C.surfaceAlt }}>
                <span style={{ fontSize: 18 }}>{whisperSources.length ? "✓" : "📂"}</span>
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: whisperSources.length ? C.accent : C.textMuted, fontFamily: FONT_UI }}>
                    {whisperSources.length
                      ? `${whisperSources.length} file${whisperSources.length > 1 ? "s" : ""} loaded: ${whisperSources.map(s=>s.name).join(", ")}`
                      : "Select one or more CSV files"}
                  </div>
                  <div style={{ fontSize: 10, color: C.textDim, fontFamily: FONT_UI }}>Hold Ctrl/Cmd to select multiple</div>
                </div>
                <input type="file" accept=".csv" multiple onChange={handleWhisperUpload} style={{ display: "none" }} />
              </label>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 160, overflowY: "auto",
                border: `1px solid ${C.border}`, borderRadius: 8, padding: 6, background: C.surfaceAlt }}>
                {shelf.length === 0
                  ? <span style={{ fontSize: 11, color: C.textDim, fontFamily: FONT_UI, padding: "4px 6px" }}>Shelf is empty</span>
                  : shelf.map(item => {
                    const selected = whisperSources.some(s => s.name === item.label);
                    return (
                      <button key={item.id} onClick={() => handleShelfPick(item)}
                        style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 10px",
                          border: `1px solid ${selected ? C.accent : C.border}`, borderRadius: 6,
                          background: selected ? C.accentDim : C.surface, cursor: "pointer", textAlign: "left" }}>
                        <span style={{ fontSize: 12 }}>{selected ? "☑" : "☐"}</span>
                        <span style={{ fontSize: 11, fontWeight: selected ? 700 : 400,
                          color: selected ? C.accent : C.text, fontFamily: FONT_UI }}>{item.label}</span>
                        <span style={{ fontSize: 10, color: C.textDim, fontFamily: FONT_UI, marginLeft: "auto" }}>
                          {item.rows.length} rows
                        </span>
                      </button>
                    );
                  })
                }
              </div>
            )}
            {whisperSources.length > 0 && whisperMode === "shelf" && (
              <div style={{ fontSize: 10, color: C.accent, fontFamily: FONT_UI, marginTop: 4 }}>
                {whisperSources.length} file{whisperSources.length > 1 ? "s" : ""} selected
              </div>
            )}
          </div>
        </div>

        {/* Action row */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14, flexWrap: "wrap" }}>
          <button onClick={handleScore} disabled={!ready}
            style={{ padding: "9px 24px", background: C.accent, color: "#ffffff", border: "none",
              borderRadius: 7, cursor: ready ? "pointer" : "not-allowed",
              fontSize: 13, fontWeight: 700, fontFamily: FONT_UI, opacity: ready ? 1 : 0.4 }}>
            Score Sessions →
          </button>
          {results && (
            <span style={{ fontSize: 12, color: C.accent, fontWeight: 700, fontFamily: FONT_UI }}>
              ✓ {results.totalSessions} session{results.totalSessions !== 1 ? "s" : ""} scored across {results.assistants.length} assistant{results.assistants.length !== 1 ? "s" : ""}
            </span>
          )}
          {error && <span style={{ fontSize: 12, color: C.danger, fontFamily: FONT_UI }}>⚠ {error}</span>}
        </div>
        {warnings.map((w, i) => (
          <div key={i} style={{ marginTop: 8, fontSize: 11, color: C.warn, fontFamily: FONT_UI }}>⚠ {w}</div>
        ))}
      </div>

      {/* ── Results ── */}
      {results && (
        <div style={{ display: "flex", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>

          {/* Left: assistant roster */}
          <div style={{ ...sx.card, width: 220, flexShrink: 0, padding: 0, overflow: "hidden" }}>
            <div style={{ padding: "10px 14px", background: C.navy, borderBottom: `1px solid ${C.navyDark}` }}>
              <span style={{ fontFamily: FONT_UI, fontWeight: 700, color: "#ffffff", fontSize: 12 }}>Assistants</span>
            </div>
            <div style={{ overflowY: "auto", maxHeight: 560 }}>
              {results.assistants.map(a => {
                const color = a.avgScore >= 80 ? C.accent : a.avgScore >= 60 ? C.warn : C.danger;
                const isActive = a.assistant === activeAsst;
                return (
                  <button key={a.assistant} onClick={() => setActiveAsst(a.assistant)}
                    style={{ display: "flex", alignItems: "center", gap: 10, width: "100%",
                      padding: "9px 14px", border: "none", borderBottom: `1px solid ${C.border}`,
                      background: isActive ? C.accentDim : "transparent", cursor: "pointer", textAlign: "left",
                      borderLeft: isActive ? `3px solid ${C.accent}` : "3px solid transparent" }}>
                    <div style={{ width: 32, height: 32, borderRadius: "50%", background: `${color}18`,
                      border: `2px solid ${color}`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color, fontFamily: FONT }}>{Math.round(a.avgScore)}</span>
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: isActive ? C.accent : C.text,
                        fontFamily: FONT_UI, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 130 }}>
                        {a.assistant}
                      </div>
                      <div style={{ fontSize: 10, color: C.textMuted, fontFamily: FONT_UI }}>
                        {a.sessionCount} session{a.sessionCount !== 1 ? "s" : ""}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Right: detail pane */}
          {activeData && (
            <div style={{ flex: "1 1 400px", minWidth: 0 }}>
              {/* Assistant header */}
              <div style={{ ...sx.card, marginBottom: 14, display: "flex", alignItems: "center", gap: 16, flexWrap: "wrap" }}>
                <ScoreBadge score={activeData.avgScore} />
                <div>
                  <div style={{ fontSize: 16, fontWeight: 700, color: C.text, fontFamily: FONT_UI }}>{activeData.assistant}</div>
                  <div style={{ fontSize: 11, color: C.textMuted, fontFamily: FONT_UI, marginTop: 2 }}>
                    {activeData.sessionCount} sessions &nbsp;·&nbsp; avg {activeData.avgScore} &nbsp;·&nbsp; low {activeData.minScore}
                  </div>
                  {activeData.avgScore < 55 && (
                    <div style={{ marginTop: 6, fontSize: 11, color: C.danger, fontWeight: 700, fontFamily: FONT_UI }}>
                      ⚑ Recommend live observation
                    </div>
                  )}
                </div>
                {/* Dimension averages */}
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
                  {[
                    { key: "volume",  label: "Volume",   max: 20 },
                    { key: "queue",   label: "Queue",    max: 30 },
                    { key: "cov1",    label: "Broad Cov",max: 10 },
                    { key: "cov2",    label: "Deep Cov", max: 10 },
                    { key: "pacing",  label: "Pacing",   max: 20 },
                    { key: "longGap", label: "Long Gap", max: 10 },
                  ].map(({ key, label, max }) => {
                    const vals = activeData.sessions.map(s => s.result.scores[key] ?? 0);
                    const avg = vals.reduce((a,b)=>a+b,0)/vals.length;
                    const color = avg < max * 0.4 ? C.danger : avg < max * 0.7 ? C.warn : C.accent;
                    return (
                      <div key={key} style={{ textAlign: "center", background: C.surfaceAlt,
                        borderRadius: 6, padding: "5px 10px", border: `1px solid ${C.border}`, borderTop: `2px solid ${color}` }}>
                        <div style={{ ...sx.label, marginBottom: 1 }}>{label}</div>
                        <div style={{ fontSize: 13, fontWeight: 700, color, fontFamily: FONT }}>
                          {avg.toFixed(1)}<span style={{ fontSize: 10, fontWeight: 400, color: C.textDim }}>/{max}</span>
                        </div>
                      </div>
                    );
                  })}
                  {/* Flag count cards */}
                  {(() => {
                    const idleCount   = activeData.sessions.reduce((n, s) => n + (s.result.flags?.filter(f => f.text.includes("idle")).length || 0), 0);
                    const praiseCount = activeData.sessions.reduce((n, s) => n + (s.result.flags?.filter(f => f.text.includes("praise")).length || 0), 0);
                    const idleCrit    = activeData.sessions.reduce((n, s) => n + (s.result.flags?.filter(f => f.level === "critical").length || 0), 0);
                    const iColor = idleCrit > 0 ? C.danger : idleCount > 0 ? C.warn : C.accent;
                    const pColor = praiseCount > 0 ? C.warn : C.accent;
                    return (
                      <>
                        <div style={{ textAlign: "center", background: C.surfaceAlt,
                          borderRadius: 6, padding: "5px 10px", border: `1px solid ${C.border}`, borderTop: `2px solid ${iColor}` }}>
                          <div style={{ ...sx.label, marginBottom: 1 }}>Idle Chains</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: iColor, fontFamily: FONT }}>
                            {idleCount}
                            {idleCrit > 0 && <span style={{ fontSize: 10, color: C.danger, fontWeight: 700 }}> ({idleCrit}⚑)</span>}
                          </div>
                        </div>
                        <div style={{ textAlign: "center", background: C.surfaceAlt,
                          borderRadius: 6, padding: "5px 10px", border: `1px solid ${C.border}`, borderTop: `2px solid ${pColor}` }}>
                          <div style={{ ...sx.label, marginBottom: 1 }}>Praise Blasts</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: pColor, fontFamily: FONT }}>{praiseCount}</div>
                        </div>
                      </>
                    );
                  })()}
                </div>
              </div>

              {/* Filter / sort bar */}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
                <span style={{ fontSize: 11, color: C.textMuted, fontFamily: FONT_UI }}>Filter:</span>
                <button onClick={() => setFilterTier("all")} style={sx.btn(filterTier === "all")}>All tiers</button>
                {allTiers.map(t => (
                  <button key={t} onClick={() => setFilterTier(t)} style={sx.btn(filterTier === t)}>
                    {TIER_LABELS[t] || t}
                  </button>
                ))}
                <span style={{ fontSize: 11, color: C.textMuted, fontFamily: FONT_UI, marginLeft: 8 }}>Sort:</span>
                <select value={sortBy} onChange={e => setSortBy(e.target.value)}
                  style={{ padding: "4px 8px", borderRadius: 5, border: `1px solid ${C.border}`,
                    fontSize: 11, fontFamily: FONT_UI, background: C.surface, color: C.text, cursor: "pointer" }}>
                  <option value="date">By date</option>
                  <option value="score_asc">Score ↑</option>
                  <option value="score_desc">Score ↓</option>
                </select>
                <span style={{ fontSize: 11, color: C.textMuted, marginLeft: "auto", fontFamily: FONT_UI }}>
                  {filteredSessions.length} session{filteredSessions.length !== 1 ? "s" : ""}
                </span>
              </div>

              {/* Session cards */}
              {filteredSessions.map((s, i) => (
                <SessionScoreCard
                  key={`${s.assistant}-${s.date}-${i}`}
                  result={s.result}
                  sessionLabel={`${s.date} · ${s.courseId} · Class ${s.classId}${s.lesson ? ` · Lesson ${s.lesson}` : ""}`}
                />
              ))}
            </div>
          )}
        </div>
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
  { id: "scorer",  label: "⭐ Asst. Quality" },
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
          {tab === "scorer"  && <AssistantQualityTab />}
        </div>
      </div>
    </ShelfContext.Provider>
  );
}
