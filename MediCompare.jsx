import { useState, useCallback, useRef, useEffect, Fragment } from "react";

const MODEL = "claude-sonnet-4-20250514";
// Ścieżka względna: w trybie dev Vite przekierowuje /api → :3001 (proxy w vite.config.js),
// a po zbudowaniu backend serwuje frontend i obsługuje /api na tym samym porcie.
const API_URL = import.meta.env.VITE_API_URL || "/api/claude";

// ── File utilities ─────────────────────────────────────────────────────────
const readAsArrayBuffer = (f) =>
  new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsArrayBuffer(f); });
const readAsBase64 = (f) =>
  new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result.split(",")[1]); r.onerror = rej; r.readAsDataURL(f); });
const readAsText = (f) =>
  new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsText(f, "utf-8"); });

async function extractContent(file) {
  const name = file.name.toLowerCase();
  const type = file.type || "";
  try {
    if (name.endsWith(".docx")) {
      if (!window.mammoth) throw new Error("Biblioteka mammoth nie jest jeszcze załadowana, spróbuj ponownie za chwilę.");
      const ab = await readAsArrayBuffer(file);
      const result = await window.mammoth.extractRawText({ arrayBuffer: ab });
      return { kind: "text", content: result.value };
    }
    if (name.endsWith(".xlsx") || name.endsWith(".xls")) {
      if (window.XLSX) {
        const ab = await readAsArrayBuffer(file);
        const wb = window.XLSX.read(ab, { type: "array" });
        const texts = wb.SheetNames.map((sn) => {
          const ws = wb.Sheets[sn];
          return `=== Arkusz: ${sn} ===\n` + window.XLSX.utils.sheet_to_csv(ws);
        });
        return { kind: "text", content: texts.join("\n\n") };
      }
      return { kind: "text", content: "[Plik Excel – odczyt w toku, spróbuj ponownie za chwilę]" };
    }
    if (name.endsWith(".csv") || type.includes("csv")) {
      const text = await readAsText(file);
      return { kind: "text", content: text };
    }
    if (name.endsWith(".pdf") || type === "application/pdf") {
      const base64 = await readAsBase64(file);
      return { kind: "pdf", base64 };
    }
    if (type.startsWith("image/") || name.match(/\.(jpg|jpeg|png|gif|webp)$/i)) {
      const base64 = await readAsBase64(file);
      return { kind: "image", base64, mediaType: type || "image/jpeg" };
    }
    const text = await readAsText(file);
    return { kind: "text", content: text };
  } catch (e) {
    return { kind: "text", content: `[Błąd odczytu pliku: ${e.message}]` };
  }
}

// ── Claude API ─────────────────────────────────────────────────────────────
function buildContent(extracted, instruction) {
  if (extracted.kind === "text")
    return [{ type: "text", text: `${instruction}\n\n---DOKUMENT---\n${extracted.content}` }];
  if (extracted.kind === "pdf")
    return [
      { type: "document", source: { type: "base64", media_type: "application/pdf", data: extracted.base64 } },
      { type: "text", text: instruction },
    ];
  if (extracted.kind === "image")
    return [
      { type: "image", source: { type: "base64", media_type: extracted.mediaType, data: extracted.base64 } },
      { type: "text", text: instruction },
    ];
}

async function callClaude(messages, system, maxTokens = 4096) {
  let res;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: MODEL, max_tokens: maxTokens, system, messages }),
    });
  } catch (e) {
    throw new Error(
      "Nie można połączyć się z serwerem proxy. " +
      "Upewnij się, że backend działa: w osobnym terminalu, w głównym folderze aplikacji, uruchom 'node server.js'."
    );
  }
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const e = await res.json(); msg = e.error?.message || msg; } catch (_) {}
    throw new Error(msg);
  }
  const data = await res.json();
  if (!data.content) throw new Error("Nieoczekiwana odpowiedź serwera (brak pola 'content').");
  return data.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

function safeParseJSON(text) {
  const clean = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();
  return JSON.parse(clean);
}

async function extractPolicy(extracted, fileName) {
  const system = `Jesteś ekspertem ds. ubezpieczeń zdrowotnych w Polsce, znającym klasyfikację ICD-9 PL (NFZ).
Odpowiadaj WYŁĄCZNIE poprawnym obiektem JSON — żadnego tekstu poza nim, żadnych znaczników markdown.`;

  const instruction = `Przeanalizuj dokument ubezpieczenia zdrowotnego: "${fileName}"

Zwróć JSON w formacie:
{
  "insurerName": "nazwa towarzystwa ubezpieczeniowego",
  "productName": "pełna nazwa produktu/planu",
  "categories": [
    {
      "name": "Kategoria (np. Hospitalizacja, Ambulatorium, Diagnostyka, Rehabilitacja, Stomatologia, Leki, Pomoc zagraniczna)",
      "items": [
        {
          "name": "nazwa świadczenia",
          "icd9": "kod ICD-9 PL lub null",
          "covered": true,
          "limit": "opis limitu (np. '30 dni/rok', 'do 5000 zł') lub null",
          "conditions": "warunki/wyłączenia lub null",
          "notes": "dodatkowe uwagi lub null"
        }
      ]
    }
  ]
}

Uwzględnij WSZYSTKIE świadczenia, procedury, badania, zabiegi i usługi wymienione w dokumencie.
Grupuj w logiczne kategorie medyczne. Jeśli pozycja jest wykluczona z ochrony, ustaw covered: false.`;

  const text = await callClaude([{ role: "user", content: buildContent(extracted, instruction) }], system, 4096);
  return safeParseJSON(text);
}

async function compareAll(policies) {
  const system = `Jesteś doświadczonym brokerem ubezpieczeniowym i ekspertem medycznym, znającym klasyfikację ICD-9 PL (NFZ).
Twoim zadaniem jest normalizacja i porównanie 1:1 zakresów polis ubezpieczeń zdrowotnych.
Odpowiadaj WYŁĄCZNIE poprawnym obiektem JSON — żadnego tekstu poza nim, żadnych znaczników markdown.`;

  const n = policies.length;
  const header = policies.map((p, i) => `Polisa ${i}: ${p.insurerName} – ${p.productName}`).join("\n");

  const instruction = `Mam ${n} polis ubezpieczeń zdrowotnych:
${header}

Dane wyodrębnione z każdej polisy:
${JSON.stringify(policies, null, 2)}

Stwórz PEŁNĄ znormalizowaną tabelę porównawczą 1:1. ZASADY NORMALIZACJI:
1. Każde unikalne świadczenie (nawet jeśli występuje tylko w 1 polisie) musi być osobnym wierszem.
2. Świadczenia równoważne medycznie — choć NAZWANE RÓŻNIE w różnych polisach — MUSZĄ trafić do jednego wiersza. Przykłady równoważności:
   - "RTG klatki piersiowej" = "Zdjęcie rentgenowskie płuc" = "Radiografia klatki piersiowej"
   - "Konsultacja kardiologiczna" = "Wizyta u kardiologa" = "Porada specjalisty - kardiologia"
   - "Morfologia krwi" = "Badanie morfologiczne" = "Pełna morfologia z rozmazem"
3. Identyfikuj równoważność na podstawie ZNACZENIA MEDYCZNEGO i kodu ICD-9 PL, nie dosłownej nazwy.
4. Dla każdego znormalizowanego świadczenia przypisz właściwy kod ICD-9 PL (Klasyfikacja Procedur Medycznych NFZ) jeśli dotyczy procedury/badania.
5. Użyj standardowej, znormalizowanej nazwy zgodnej z nazewnictwem ICD-9 PL.
6. Dla każdego wiersza podaj stan pokrycia we WSZYSTKICH ${n} polisach (policyIndex 0–${n - 1}).
7. Jeśli polisa nie pokrywa danego świadczenia, ustaw covered: false dla tej polisy.
8. W polu originalName zachowaj oryginalną nazwę użytą w danej polisie (do weryfikacji mapowania).

Zwróć JSON:
{
  "summary": {
    "totalItems": <liczba wszystkich pozycji>,
    "fullyMatched": <liczba pokrytych przez WSZYSTKIE polisy>,
    "partiallyMatched": <liczba pokrytych przez część polis>,
    "unique": <liczba występujących tylko w 1 polisie>
  },
  "categories": [
    {
      "name": "Nazwa kategorii medycznej",
      "icon": "emoji pasujące do kategorii",
      "items": [
        {
          "normalizedName": "znormalizowana nazwa świadczenia wg ICD-9 PL",
          "icd9": "kod ICD-9 PL lub null",
          "coverages": [
            {
              "policyIndex": 0,
              "covered": true,
              "limit": "opis limitu lub null",
              "conditions": "warunki/wyłączenia lub null",
              "originalName": "oryginalna nazwa z tej polisy lub null",
              "notes": "uwagi lub null"
            }
          ]
        }
      ]
    }
  ]
}`;

  const text = await callClaude([{ role: "user", content: [{ type: "text", text: instruction }] }], system, 8192);
  return safeParseJSON(text);
}

// ── CSV Export ─────────────────────────────────────────────────────────────
function exportCSV(comparison, policies) {
  const headers = ["Kategoria", "Świadczenie (ICD-9 PL)", "Kod ICD-9",
    ...policies.map((p, i) => `${p.insurerName || "Polisa " + (i + 1)} – ${p.productName || ""}`)];
  const rows = [headers];
  comparison.categories.forEach((cat) => {
    cat.items.forEach((item) => {
      const row = [cat.name, item.normalizedName, item.icd9 || "",
        ...policies.map((_, pi) => {
          const c = item.coverages?.find((x) => x.policyIndex === pi);
          if (!c || !c.covered) return "NIE";
          let s = "TAK";
          if (c.limit) s += ` | Limit: ${c.limit}`;
          if (c.conditions) s += ` | Warunki: ${c.conditions}`;
          if (c.notes) s += ` | ${c.notes}`;
          return s;
        })];
      rows.push(row);
    });
  });
  const csv = rows.map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "porownanie_ubezpieczen.csv"; a.click();
  URL.revokeObjectURL(url);
}

// ── Styles ─────────────────────────────────────────────────────────────────
const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Libre+Baskerville:ital,wght@0,400;0,700;1,400&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600&display=swap');
*{box-sizing:border-box;margin:0;padding:0;}
html,body,#root{font-family:'DM Sans',sans-serif;background:#080c18;color:#dde4ef;min-height:100vh;}
::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-track{background:#080c18}::-webkit-scrollbar-thumb{background:#243050;border-radius:3px}
@keyframes fadeUp{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:none}}
@keyframes spin{to{transform:rotate(360deg)}}
@keyframes pulseGlow{0%,100%{box-shadow:0 0 0 0 rgba(99,179,255,.3)}50%{box-shadow:0 0 24px 4px rgba(99,179,255,.15)}}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}
.fade-up{animation:fadeUp .4s ease both}
.spin{animation:spin .9s linear infinite}
.blink{animation:blink 1.4s ease-in-out infinite}
.glow-pulse{animation:pulseGlow 2s ease-in-out infinite}
.gradient-text{background:linear-gradient(130deg,#63b3ff,#b093ff);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text;}
.drop-zone{border:2px dashed #1c2840;border-radius:18px;transition:all .25s;cursor:pointer;background:rgba(20,28,50,.4)}
.drop-zone:hover,.drop-zone.drag{border-color:#4a8fff;background:rgba(74,143,255,.04)}
.file-chip{background:#0e1525;border:1px solid #1c2840;border-radius:11px;transition:border-color .2s}
.file-chip:hover{border-color:#2a3a5c}
.btn-primary{background:linear-gradient(135deg,#3b75e8,#7c4de8);color:#fff;border:none;border-radius:10px;padding:14px 36px;font-size:16px;font-weight:600;cursor:pointer;transition:all .2s;font-family:'DM Sans',sans-serif;letter-spacing:.2px}
.btn-primary:hover:not(:disabled){opacity:.92;transform:translateY(-2px);box-shadow:0 10px 30px rgba(59,117,232,.35)}
.btn-primary:disabled{opacity:.35;cursor:not-allowed}
.btn-ghost{background:transparent;color:#7a90b8;border:1px solid #1c2840;border-radius:8px;padding:8px 16px;font-size:13px;cursor:pointer;transition:all .2s;font-family:'DM Sans',sans-serif}
.btn-ghost:hover{border-color:#4a8fff;color:#63b3ff}
.btn-ghost.active{border-color:#4a8fff;color:#63b3ff;background:rgba(74,143,255,.06)}
.search-box{background:#0e1525;border:1px solid #1c2840;border-radius:9px;padding:10px 14px;color:#dde4ef;font-size:14px;font-family:'DM Sans',sans-serif;outline:none;transition:border-color .2s;width:280px}
.search-box:focus{border-color:#4a8fff}
.search-box::placeholder{color:#3a4a6a}
.stat-card{background:#0c1122;border:1px solid #1a2540;border-radius:14px;padding:20px 22px}
.table-wrap{overflow-x:auto}
table{width:100%;border-collapse:collapse;min-width:500px}
thead th{background:#080c18;padding:13px 16px;font-size:11.5px;font-weight:600;letter-spacing:.8px;text-transform:uppercase;color:#3f5070;position:sticky;top:0;z-index:10;border-bottom:1px solid #111928}
tbody td{padding:10px 16px;border-bottom:1px solid #0e1525;font-size:13.5px;vertical-align:top}
tbody tr:hover td{background:rgba(74,143,255,.025)}
.cat-row td{background:#0a0f1e;color:#4a8fff;font-size:12px;font-weight:700;letter-spacing:.6px;text-transform:uppercase;padding:10px 16px}
.badge-yes{background:rgba(52,211,153,.12);color:#34d399;border:1px solid rgba(52,211,153,.2);border-radius:5px;padding:2px 8px;font-size:11.5px;font-weight:700;white-space:nowrap}
.badge-no{background:rgba(248,113,113,.1);color:#f87171;border:1px solid rgba(248,113,113,.18);border-radius:5px;padding:2px 8px;font-size:11.5px;font-weight:700}
.badge-na{background:rgba(100,116,139,.1);color:#475569;border:1px solid rgba(100,116,139,.15);border-radius:5px;padding:2px 8px;font-size:11.5px}
.tag-icd{font-family:monospace;font-size:10.5px;color:#3a4a6a;background:#0a0f1e;border:1px solid #131d33;border-radius:4px;padding:1px 6px;margin-top:3px;display:inline-block}
.log-area{background:#060a14;border:1px solid #111928;border-radius:12px;padding:14px 18px;text-align:left;max-height:260px;overflow-y:auto;font-family:monospace;font-size:12.5px}
.progress-bar{height:3px;background:#111928;border-radius:2px;overflow:hidden;margin:10px 0 4px}
.progress-fill{height:100%;background:linear-gradient(90deg,#3b75e8,#7c4de8);border-radius:2px;transition:width .5s ease}
.error-box{background:rgba(248,113,113,.07);border:1px solid rgba(248,113,113,.18);border-radius:10px;padding:12px 16px;color:#f87171;font-size:13.5px}
.policy-col-header{min-width:190px;text-align:center}
.diff-highlight td{background:rgba(251,146,60,.025) !important}
`;

// ── Main Component ─────────────────────────────────────────────────────────
export default function MediCompare() {
  const [files, setFiles] = useState([]);
  const [step, setStep] = useState("upload");
  const [logs, setLogs] = useState([]);
  const [progress, setProgress] = useState(0);
  const [policies, setPolicies] = useState([]);
  const [comparison, setComparison] = useState(null);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef(null);
  const logsRef = useRef(null);

  useEffect(() => {
    const loadScript = (src) => new Promise((res) => {
      if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
      const s = document.createElement("script");
      s.src = src; s.onload = res; s.onerror = res;
      document.head.appendChild(s);
    });
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    loadScript("https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js");
  }, []);

  useEffect(() => {
    if (logsRef.current) logsRef.current.scrollTop = logsRef.current.scrollHeight;
  }, [logs]);

  const addLog = (msg) => setLogs((p) => [...p, { msg, ts: new Date().toLocaleTimeString("pl") }]);

  const handleAdd = useCallback((incoming) => {
    const valid = ["pdf","jpg","jpeg","png","docx","doc","xlsx","xls","csv","txt"];
    const added = Array.from(incoming)
      .filter((f) => valid.includes(f.name.split(".").pop().toLowerCase()))
      .map((f) => ({ id: crypto.randomUUID(), file: f, name: f.name, size: f.size }));
    setFiles((p) => [...p, ...added]);
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault(); setDragging(false); handleAdd(e.dataTransfer.files);
  }, [handleAdd]);

  const removeFile = (id) => setFiles((p) => p.filter((f) => f.id !== id));

  const run = async () => {
    if (!files.length) return;
    setStep("processing"); setLogs([]); setError(null); setProgress(0);
    try {
      const extracted = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        addLog(`📂 Odczyt: ${f.name}`);
        const content = await extractContent(f.file);
        addLog(`🔬 Ekstrakcja polisy ${i + 1}/${files.length}…`);
        const pol = await extractPolicy(content, f.name);
        extracted.push(pol);
        const cnt = pol.categories?.reduce((s, c) => s + (c.items?.length || 0), 0) ?? 0;
        addLog(`✅ ${pol.insurerName || f.name}: ${cnt} świadczeń w ${pol.categories?.length ?? 0} kategoriach`);
        setProgress(Math.round(((i + 1) / files.length) * (files.length >= 2 ? 60 : 100)));
      }
      setPolicies(extracted);

      if (extracted.length >= 2) {
        // Porównanie 1:1 z normalizacją ICD-9 PL
        addLog(`⚖️  Normalizacja i porównanie 1:1 ${extracted.length} polis wg ICD-9 PL…`);
        setProgress(70);
        const cmp = await compareAll(extracted);
        setComparison(cmp);
        setProgress(100);
        addLog(`🎯 Gotowe! ${cmp.summary?.totalItems ?? "?"} pozycji w ${cmp.categories?.length ?? "?"} kategoriach`);
      } else {
        // Pojedyncza polisa — widok bez porównania
        const pol = extracted[0];
        const items = pol.categories?.flatMap(c => c.items?.map(it => ({ ...it, catName: c.name, catIcon: "📋" })) ?? []) ?? [];
        setComparison({
          summary: { totalItems: items.length, fullyMatched: items.filter(i => i.covered).length, partiallyMatched: 0, unique: items.filter(i => !i.covered).length },
          categories: pol.categories?.map(c => ({
            name: c.name, icon: "📋",
            items: (c.items || []).map(it => ({
              normalizedName: it.name, icd9: it.icd9,
              coverages: [{ policyIndex: 0, covered: it.covered, limit: it.limit, conditions: it.conditions, originalName: it.name, notes: it.notes }]
            }))
          })) ?? []
        });
        setProgress(100);
        addLog("✅ Analiza pojedynczej polisy zakończona");
      }
      setTimeout(() => setStep("results"), 700);
    } catch (e) {
      setError(e.message);
      setStep("upload");
    }
  };

  const filteredCats = () => {
    if (!comparison) return [];
    return comparison.categories.map((cat) => ({
      ...cat,
      items: cat.items.filter((item) => {
        if (search && !item.normalizedName.toLowerCase().includes(search.toLowerCase()) &&
            !(item.icd9 || "").toLowerCase().includes(search.toLowerCase())) return false;
        if (filter === "all") return true;
        const covCnt = item.coverages?.filter((c) => c.covered).length ?? 0;
        const total = policies.length || 1;
        if (filter === "covered") return covCnt === total;
        if (filter === "notcovered") return covCnt === 0;
        if (filter === "diff") return covCnt > 0 && covCnt < total;
        return true;
      }),
    })).filter((c) => c.items.length > 0);
  };

  const isDiff = (item) => {
    const cnt = item.coverages?.filter((c) => c.covered).length ?? 0;
    return cnt > 0 && cnt < (policies.length || 1);
  };

  const fmt = (b) => b < 1e3 ? b + " B" : b < 1e6 ? (b / 1e3).toFixed(1) + " KB" : (b / 1e6).toFixed(1) + " MB";
  const icon = (n) => {
    const e = n.split(".").pop().toLowerCase();
    return { pdf: "📕", docx: "📘", doc: "📘", xlsx: "📗", xls: "📗", csv: "📊", jpg: "🖼️", jpeg: "🖼️", png: "🖼️", txt: "📄" }[e] || "📄";
  };

  return (
    <>
      <style>{CSS}</style>

      {/* ── NAV ── */}
      <nav style={{ background: "rgba(8,12,24,.95)", backdropFilter: "blur(24px)", borderBottom: "1px solid #111928", position: "sticky", top: 0, zIndex: 200, padding: "0 28px" }}>
        <div style={{ maxWidth: 1440, margin: "0 auto", height: 60, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 34, height: 34, borderRadius: 9, background: "linear-gradient(135deg,#3b75e8,#7c4de8)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 17 }}>⚕</div>
            <div>
              <span style={{ fontFamily: "'Libre Baskerville',serif", fontSize: 17, fontWeight: 700, letterSpacing: "-.3px" }}>
                Medi<span className="gradient-text">Compare</span> Pro
              </span>
              <div style={{ fontSize: 10, color: "#2a3a5c", letterSpacing: "1px", fontWeight: 600 }}>ANALIZATOR UBEZPIECZEŃ ZDROWOTNYCH</div>
            </div>
          </div>
          {step === "results" && (
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn-ghost" onClick={() => { setStep("upload"); setComparison(null); setFiles([]); setPolicies([]); }}>
                ← Nowa analiza
              </button>
              <button className="btn-ghost" onClick={() => exportCSV(comparison, policies)}
                style={{ borderColor: "#22c55e", color: "#22c55e" }}>
                ↓ Eksport CSV
              </button>
            </div>
          )}
        </div>
      </nav>

      <main style={{ maxWidth: 1440, margin: "0 auto", padding: "36px 28px" }}>

        {/* ── UPLOAD ── */}
        {step === "upload" && (
          <div className="fade-up">
            <div style={{ textAlign: "center", marginBottom: 52 }}>
              <div style={{ display: "inline-flex", alignItems: "center", gap: 8, background: "rgba(59,117,232,.1)", border: "1px solid rgba(59,117,232,.2)", borderRadius: 20, padding: "5px 14px", fontSize: 11, color: "#63b3ff", fontWeight: 600, letterSpacing: ".7px", textTransform: "uppercase", marginBottom: 24 }}>
                <span className="blink" style={{ width: 6, height: 6, borderRadius: "50%", background: "#63b3ff", display: "inline-block" }}/>
                Powered by Claude AI · ICD-9 PL NFZ
              </div>
              <h1 style={{ fontFamily: "'Libre Baskerville',serif", fontSize: 50, fontWeight: 700, lineHeight: 1.12, marginBottom: 18, letterSpacing: "-1.5px" }}>
                Analizuj zakres<br />
                <span className="gradient-text">ubezpieczenia zdrowotnego</span>
              </h1>
              <p style={{ color: "#4a5e80", fontSize: 16.5, maxWidth: 540, margin: "0 auto", lineHeight: 1.65 }}>
                Wgraj polisę. AI wyodrębni świadczenia i znormalizuje je według standardu ICD-9 PL.
              </p>
            </div>

            {/* Features row */}
            <div style={{ display: "flex", gap: 14, justifyContent: "center", marginBottom: 48, flexWrap: "wrap" }}>
              {[
                ["🔍","Inteligentna ekstrakcja","AI wyodrębnia wszystkie świadczenia"],
                ["⚕️","Normalizacja ICD-9 PL","Unifikacja nazw wg standardu NFZ"],
                ["📊","Przejrzysty widok","Tabela świadczeń z limitami i warunkami"],
                ["💾","Eksport CSV","Gotowy raport do dalszej pracy"],
              ].map(([em,t,d]) => (
                <div key={t} style={{ background: "#0c1122", border: "1px solid #1a2540", borderRadius: 12, padding: "14px 18px", width: 200, textAlign: "center" }}>
                  <div style={{ fontSize: 26, marginBottom: 6 }}>{em}</div>
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 3 }}>{t}</div>
                  <div style={{ fontSize: 11.5, color: "#3a4a6a" }}>{d}</div>
                </div>
              ))}
            </div>

            {/* Drop zone */}
            <div
              className={`drop-zone ${dragging ? "drag" : ""}`}
              style={{ padding: "56px 24px", textAlign: "center", marginBottom: 20 }}
              onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
            >
              <input ref={fileRef} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.docx,.doc,.xlsx,.xls,.csv,.txt" style={{ display: "none" }} onChange={(e) => handleAdd(e.target.files)} />
              <div style={{ fontSize: 52, marginBottom: 14 }}>📂</div>
              <div style={{ fontSize: 18, fontWeight: 600, marginBottom: 8 }}>Przeciągnij pliki polis lub kliknij</div>
              <div style={{ color: "#3a4a6a", fontSize: 13.5 }}>PDF · JPG / PNG · DOCX · XLSX · CSV · TXT</div>
            </div>

            {/* File chips */}
            {files.length > 0 && (
              <div style={{ marginBottom: 36 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
                  <div style={{ fontSize: 11.5, fontWeight: 700, color: "#3a4a6a", letterSpacing: ".8px", textTransform: "uppercase" }}>Wgrane dokumenty ({files.length})</div>
                  <button className="btn-ghost" onClick={() => setFiles([])} style={{ fontSize: 12 }}>Usuń wszystkie</button>
                </div>
                <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fill,minmax(270px,1fr))" }}>
                  {files.map((f, i) => (
                    <div key={f.id} className="file-chip" style={{ padding: "11px 14px", display: "flex", alignItems: "center", gap: 11 }}>
                      <div style={{ fontSize: 22, lineHeight: 1 }}>{icon(f.name)}</div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#c8d4e8" }}>
                          Polisa {i + 1}: {f.name}
                        </div>
                        <div style={{ fontSize: 11, color: "#2a3a5c", marginTop: 1 }}>{fmt(f.size)}</div>
                      </div>
                      <button onClick={(e) => { e.stopPropagation(); removeFile(f.id); }}
                        style={{ background: "none", border: "none", cursor: "pointer", color: "#2a3a5c", fontSize: 20, lineHeight: 1, padding: "0 4px" }}>×</button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {error && <div className="error-box" style={{ marginBottom: 20 }}>⚠️ {error}</div>}

            <div style={{ textAlign: "center" }}>
              <button className="btn-primary" onClick={run} disabled={!files.length} style={{ fontSize: 16, padding: "15px 44px" }}>
                {files.length === 0 ? "Wgraj dokumenty" : files.length === 1 ? "Analizuj 1 polisę →" : `Porównaj ${files.length} polisy 1:1 →`}
              </button>
              {files.length === 1 && (
                <div style={{ color: "#3a4a6a", fontSize: 12.5, marginTop: 10 }}>Dodaj 2+ polis, aby uruchomić porównanie 1:1 wg ICD-9</div>
              )}
            </div>
          </div>
        )}

        {/* ── PROCESSING ── */}
        {step === "processing" && (
          <div className="fade-up" style={{ maxWidth: 620, margin: "64px auto", textAlign: "center" }}>
            <div style={{ fontSize: 58, marginBottom: 22 }}>
              <span className="blink">⚕️</span>
            </div>
            <h2 style={{ fontFamily: "'Libre Baskerville',serif", fontSize: 30, fontWeight: 700, marginBottom: 8 }}>
              Analizuję dokumenty…
            </h2>
            <p style={{ color: "#3a4a6a", marginBottom: 36, fontSize: 15 }}>
              Claude przetwarza polisy i normalizuje świadczenia wg ICD-9 PL NFZ
            </p>
            <div className="progress-bar"><div className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <div style={{ fontSize: 12, color: "#2a3a5c", marginBottom: 24 }}>{progress}% ukończono</div>
            <div className="log-area" ref={logsRef}>
              {logs.length === 0
                ? <span style={{ color: "#1a2a4a" }}>Inicjalizacja…</span>
                : logs.map((l, i) => (
                  <div key={i} style={{ color: i === logs.length - 1 ? "#7a90b8" : "#2a3a5c", padding: "2px 0" }}>
                    <span style={{ color: "#1a2840", marginRight: 8 }}>{l.ts}</span>{l.msg}
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* ── RESULTS ── */}
        {step === "results" && comparison && (
          <div className="fade-up">

            {/* Header */}
            <div style={{ marginBottom: 28 }}>
              <h2 style={{ fontFamily: "'Libre Baskerville',serif", fontSize: 30, fontWeight: 700, marginBottom: 6 }}>
                Wyniki analizy
              </h2>
              <div style={{ color: "#3a4a6a", fontSize: 13.5 }}>
                {policies.length} {policies.length === 1 ? "polisa" : policies.length < 5 ? "polisy" : "polis"} · {comparison.categories?.length ?? 0} kategorii · dane znormalizowane wg ICD-9 PL NFZ
              </div>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 14, marginBottom: 28 }}>
              {[
                { label: "Wszystkich świadczeń", val: comparison.summary?.totalItems, color: "#63b3ff" },
                { label: "Objęte ochroną", val: comparison.summary?.fullyMatched, color: "#34d399" },
                { label: "Wyłączone z ochrony", val: comparison.summary?.unique, color: "#f87171" },
              ].map((s) => (
                <div key={s.label} className="stat-card">
                  <div style={{ fontSize: 34, fontWeight: 700, color: s.color, fontFamily: "'Libre Baskerville',serif", lineHeight: 1.1 }}>{s.val ?? "–"}</div>
                  <div style={{ fontSize: 12.5, color: "#2a3a5c", marginTop: 5 }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Policy labels */}
            <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
              {policies.map((p, i) => (
                <div key={i} style={{ background: "#0c1122", border: "1px solid #1a2540", borderRadius: 8, padding: "6px 14px", fontSize: 12.5 }}>
                  <span style={{ color: "#63b3ff", fontWeight: 700 }}>P{i + 1}</span>
                  <span style={{ color: "#3a4a6a", margin: "0 6px" }}>→</span>
                  <span style={{ color: "#8fa8c8" }}>{p.insurerName || `Polisa ${i + 1}`}</span>
                  {p.productName && <span style={{ color: "#2a3a5c" }}> · {p.productName}</span>}
                </div>
              ))}
            </div>

            {/* Controls */}
            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", marginBottom: 20 }}>
              <input className="search-box" type="text" placeholder="🔍 Szukaj świadczenia lub kodu ICD-9…" value={search} onChange={(e) => setSearch(e.target.value)} />
              {[["all","Wszystkie"],["covered","✓ Pokryte"],["notcovered","✗ Brak"]].map(([v,l]) => (
                <button key={v} className={`btn-ghost${filter===v?" active":""}`} onClick={() => setFilter(v)}>{l}</button>
              ))}
              <div style={{ marginLeft: "auto", fontSize: 12, color: "#2a3a5c" }}>
                {filteredCats().reduce((s, c) => s + c.items.length, 0)} wyników
              </div>
            </div>

            {/* Table */}
            <div style={{ background: "#060a14", border: "1px solid #111928", borderRadius: 16, overflow: "hidden" }}>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left", width: 300 }}>Świadczenie / ICD-9</th>
                      {policies.map((p, i) => (
                        <th key={i} className="policy-col-header">
                          <span style={{ color: "#4a8fff" }}>P{i + 1}</span>
                          <br />
                          <span style={{ fontSize: 10, color: "#2a3a5c", textTransform: "none", letterSpacing: 0, fontWeight: 400 }}>
                            {p.insurerName || `Polisa ${i + 1}`}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {filteredCats().map((cat, ci) => (
                      <Fragment key={ci}>
                        <tr className="cat-row">
                          <td colSpan={1 + policies.length}>{cat.icon} {cat.name}</td>
                        </tr>
                        {cat.items.map((item, ii) => (
                          <tr key={ii} className={isDiff(item) ? "diff-highlight" : ""}>
                            <td>
                              <div style={{ fontWeight: 500, color: "#c8d4e8", fontSize: 13.5 }}>{item.normalizedName}</div>
                              {item.icd9 && <span className="tag-icd">{item.icd9}</span>}
                            </td>
                            {policies.map((_, pi) => {
                              const c = item.coverages?.find((x) => x.policyIndex === pi);
                              if (!c || !c.covered) return (
                                <td key={pi} style={{ textAlign: "center" }}><span className="badge-no">NIE</span></td>
                              );
                              return (
                                <td key={pi} style={{ textAlign: "center" }}>
                                  <span className="badge-yes">TAK</span>
                                  {c.limit && <div style={{ fontSize: 11, color: "#4a5e80", marginTop: 4, lineHeight: 1.4 }}>{c.limit}</div>}
                                  {c.conditions && <div style={{ fontSize: 10.5, color: "#334466", marginTop: 2 }}>{c.conditions}</div>}
                                  {c.originalName && c.originalName !== item.normalizedName && (
                                    <div style={{ fontSize: 10, color: "#253050", marginTop: 2, fontStyle: "italic" }}>oryg.: {c.originalName}</div>
                                  )}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </Fragment>
                    ))}
                    {filteredCats().length === 0 && (
                      <tr><td colSpan={1 + policies.length} style={{ textAlign: "center", padding: "48px", color: "#2a3a5c" }}>
                        Brak wyników dla wybranych filtrów
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Legend */}
            <div style={{ display: "flex", gap: 20, marginTop: 16, flexWrap: "wrap", fontSize: 12, color: "#2a3a5c" }}>
              <span><span className="badge-yes" style={{ marginRight: 6 }}>TAK</span>Świadczenie objęte ochroną</span>
              <span><span className="badge-no" style={{ marginRight: 6 }}>NIE</span>Brak w zakresie polisy</span>
            </div>
          </div>
        )}

      </main>
    </>
  );
}
