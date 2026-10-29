#!/usr/bin/env node
// html-qa: 議題 JSON (vN.json) を、1 ファイルで完結する対話用 HTML に変換する。
//
//   node ai-skills/html-qa/scripts/build.mjs <topic-dir | vN.json> [...]
//
// - 同じ議題フォルダの v*.json をすべて作り直す (版の切り替え一覧を最新にするため)
// - <topic>/index.html は最新版の写し。F5 で最新が見られる
// - 親フォルダ (既定 .tmp/html-qa/) に議題一覧 index.html を作る
// - 形式の誤りは一覧にして終了コード 1
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pageUrls } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "..", "assets");
const MAX_IMAGE = 8 * 1024 * 1024;
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

const COMMON = ["type"];
const QCOMMON = ["id", "q", "md", "required"];
const SPEC = {
  text: { req: ["md"], opt: [] },
  note: { req: ["md"], opt: ["kind", "title"] },
  table: { req: ["rows"], opt: ["columns", "caption", "highlight"] },
  code: { req: ["code"], opt: ["lang", "caption"] },
  image: { req: ["src"], opt: ["caption", "alt"] },
  svg: { req: ["svg"], opt: ["caption"] },
  html: { req: ["html"], opt: [] },
  compare: { req: ["options"], opt: [] },
  steps: { req: ["items"], opt: [] },
  kv: { req: ["items"], opt: [] },
  metrics: { req: ["items"], opt: [] },
  bars: { req: ["items"], opt: ["title", "unit", "max"] },
  details: { req: ["title"], opt: ["md", "blocks", "open"] },
  choice: { req: [...QCOMMON.slice(0, 2), "options"], opt: ["md", "required", "allowOther"], q: true },
  multi: { req: [...QCOMMON.slice(0, 2), "options"], opt: ["md", "required", "allowOther"], q: true },
  input: { req: QCOMMON.slice(0, 2), opt: ["md", "required", "placeholder", "lines"], q: true },
  scale: { req: QCOMMON.slice(0, 2), opt: ["md", "required", "min", "max", "step", "default", "unit", "minLabel", "maxLabel"], q: true },
  rank: { req: [...QCOMMON.slice(0, 2), "items"], opt: ["md", "required"], q: true },
  review: { req: [...QCOMMON.slice(0, 2), "items"], opt: ["md", "required"], q: true },
};
const NOTE_KINDS = ["info", "tip", "warn", "danger", "ok"];
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

function validate(doc, file) {
  const errs = [];
  const warns = [];
  const e = (p, m) => errs.push(`${p}: ${m}`);
  const w = (p, m) => warns.push(`${p}: ${m}`);
  if (!doc || typeof doc !== "object") return { errs: ["(全体): JSON のオブジェクトではありません"], warns };
  const m = path.basename(file).match(/^v(\d+)\.json$/);
  if (!m) e("(ファイル名)", "vN.json の形にしてください (例: v1.json)");
  if (!TOPIC_RE.test(doc.topic ?? "")) e("topic", "英小文字・数字・ハイフンで指定してください (例: login-redesign)");
  else if (doc.topic !== path.basename(path.dirname(file))) e("topic", `フォルダ名 (${path.basename(path.dirname(file))}) と同じにしてください`);
  if (!Number.isInteger(doc.version) || doc.version < 1) e("version", "1 以上の整数にしてください");
  else if (m && Number(m[1]) !== doc.version) e("version", `ファイル名 v${m[1]} と一致しません`);
  if (typeof doc.title !== "string" || !doc.title.trim()) e("title", "必須です");
  for (const k of Object.keys(doc)) if (!["topic", "version", "title", "lead", "decisions", "sections", "$comment"].includes(k)) w(k, "不明な項目です (無視されます)");
  if (doc.decisions != null) {
    if (!Array.isArray(doc.decisions)) e("decisions", "配列にしてください");
    else doc.decisions.forEach((d, i) => { if (!d?.title) e(`decisions[${i}]`, "title が必須です"); });
  }
  if (!Array.isArray(doc.sections) || !doc.sections.length) { e("sections", "1 つ以上の章が必要です"); return { errs, warns }; }
  const qids = new Map();
  const walk = (blocks, base) => {
    if (!Array.isArray(blocks)) { e(base, "blocks は配列にしてください"); return; }
    blocks.forEach((b, i) => {
      const p = `${base}[${i}]`;
      const spec = SPEC[b?.type];
      if (!spec) { e(p, `type "${b?.type}" は使えません (使えるもの: ${Object.keys(SPEC).join(", ")})`); return; }
      const where = `${p} (${b.type}${b.id ? ` ${b.id}` : ""})`;
      for (const r of spec.req) if (b[r] == null || b[r] === "") e(where, `${r} が必要です`);
      for (const k of Object.keys(b)) if (![...COMMON, ...spec.req, ...spec.opt].includes(k)) w(where, `不明な項目 "${k}" (無視されます)`);
      if (spec.q) {
        if (!ID_RE.test(b.id ?? "")) e(where, "id は英数字・_・- で指定してください (版をまたいで同じ質問には同じ id)");
        else if (qids.has(b.id)) e(where, `id "${b.id}" が ${qids.get(b.id)} と重複しています`);
        else qids.set(b.id, p);
      }
      const arr = (k) => { if (b[k] != null && !Array.isArray(b[k])) { e(where, `${k} は配列にしてください`); return false; } return Array.isArray(b[k]); };
      switch (b.type) {
        case "note": if (b.kind && !NOTE_KINDS.includes(b.kind)) e(where, `kind は ${NOTE_KINDS.join(" / ")} のどれかです`); break;
        case "table": if (arr("rows")) b.rows.forEach((r, ri) => { if (!Array.isArray(r)) e(where, `rows[${ri}] は配列にしてください`); else if (b.columns && r.length !== b.columns.length) w(where, `rows[${ri}] の列数 ${r.length} が columns の ${b.columns.length} と違います`); }); break;
        case "choice": case "multi": case "rank": {
          const k = b.type === "rank" ? "items" : "options";
          if (arr(k)) {
            if (b[k].length < 2) e(where, `${k} は 2 つ以上必要です`);
            const seen = new Set();
            b[k].forEach((o, oi) => {
              const v = typeof o === "string" ? o : o?.value ?? o?.label;
              if (typeof o !== "string" && !o?.label) e(where, `${k}[${oi}] は文字列か { label } にしてください`);
              if (seen.has(v)) e(where, `${k}[${oi}] の値 "${v}" が重複しています`);
              seen.add(v);
            });
          }
          break;
        }
        case "review": if (arr("items")) { const seen = new Set(); b.items.forEach((it, ii) => { if (!ID_RE.test(it?.id ?? "")) e(where, `items[${ii}] に id が必要です`); else if (seen.has(it.id)) e(where, `items[${ii}] の id "${it.id}" が重複しています`); seen.add(it?.id); if (!it?.title && !it?.md) e(where, `items[${ii}] に title か md が必要です`); }); } break;
        case "compare": if (arr("options")) b.options.forEach((o, oi) => { if (!o?.title) e(where, `options[${oi}] に title が必要です`); }); break;
        case "steps": case "metrics": case "bars": arr("items"); break;
        case "kv": if (arr("items")) b.items.forEach((x, xi) => { if (!Array.isArray(x) || x.length !== 2) e(where, `items[${xi}] は ["項目", "値"] の形にしてください`); }); break;
        case "scale": if (b.min != null && b.max != null && !(b.min < b.max)) e(where, "min は max より小さくしてください"); break;
        case "details": if (b.blocks) walk(b.blocks, `${p}.blocks`); break;
      }
    });
  };
  doc.sections.forEach((s, si) => {
    if (!s?.title) e(`sections[${si}]`, "title が必要です");
    walk(s?.blocks ?? [], `sections[${si}].blocks`);
  });
  if (!qids.size) w("(全体)", "質問がありません。説明だけの資料として作ります");
  return { errs, warns };
}

// 画像はデータ URI で埋め込み、HTML 1 つで持ち運べるようにする
function embedImages(blocks, dir, errs) {
  for (const b of blocks || []) {
    if (b.type === "details") embedImages(b.blocks, dir, errs);
    if (b.type !== "image" || /^(https?:|data:)/.test(b.src)) continue;
    const f = path.resolve(dir, b.src);
    const mime = MIME[path.extname(f).toLowerCase()];
    if (!fs.existsSync(f)) { errs.push(`image "${b.src}": ファイルがありません (${f})`); continue; }
    if (!mime) { errs.push(`image "${b.src}": 使えない形式です (${Object.keys(MIME).join(" ")})`); continue; }
    const size = fs.statSync(f).size;
    if (size > MAX_IMAGE) { errs.push(`image "${b.src}": ${(size / 1048576).toFixed(1)}MB は大きすぎます (8MB まで)`); continue; }
    b.src = `data:${mime};base64,${fs.readFileSync(f).toString("base64")}`;
  }
}

const jsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function page(title, body, css) {
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(title)}</title>
<style>${css}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

function versionsIn(dir) {
  return fs.readdirSync(dir).map((f) => f.match(/^v(\d+)\.json$/)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
}

function buildTopic(dir, css, js) {
  const vs = versionsIn(dir);
  if (!vs.length) return { ok: false, out: [`${dir}: v*.json がありません`] };
  const docs = [];
  const problems = [];
  for (const v of vs) {
    const file = path.join(dir, `v${v}.json`);
    let doc;
    try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (err) { problems.push({ file, errs: [`JSON として読めません: ${err.message}`], warns: [] }); continue; }
    const { errs, warns } = validate(doc, file);
    for (const s of doc.sections || []) embedImages(s.blocks, dir, errs);
    problems.push({ file, errs, warns });
    docs.push({ v, doc, file, errs });
  }
  const good = docs.filter((d) => !d.errs.length);
  if (!good.length) return { ok: false, problems };
  const latest = good[good.length - 1].v;
  const meta = good.map((d) => ({ version: d.v, file: `v${d.v}.html`, title: d.doc.title }));
  const rel = (f) => path.relative(process.cwd(), f).split(path.sep).join("/");
  for (const d of docs) {
    if (d.errs.length) continue;
    const metaFor = { versions: meta, latest, jsonPath: rel(d.file), indexHref: "../index.html" };
    const body = `<script type="application/json" id="qa-doc">${jsonForScript(d.doc)}</script>
<script type="application/json" id="qa-meta">${jsonForScript(metaFor)}</script>
<noscript>この資料の表示には JavaScript が必要です。</noscript>
<script>${js}</script>`;
    const html = page(`${d.doc.title} — v${d.v}`, body, css);
    fs.writeFileSync(path.join(dir, `v${d.v}.html`), html);
    if (d.v === latest) fs.writeFileSync(path.join(dir, "index.html"), html);
  }
  return { ok: problems.every((p) => !p.errs.length), problems, latest, dir };
}

function buildIndex(root, css) {
  const rows = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    const vs = versionsIn(dir);
    if (!vs.length) continue;
    const v = vs[vs.length - 1];
    let title = e.name;
    try { title = JSON.parse(fs.readFileSync(path.join(dir, `v${v}.json`), "utf8")).title || title; } catch { /* 壊れた JSON は名前だけ出す */ }
    const mtime = fs.statSync(path.join(dir, `v${v}.json`)).mtime;
    const answered = fs.existsSync(path.join(dir, `v${v}.answer.md`));
    rows.push({ name: e.name, title, v, mtime, answered });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  const list = rows.map((r) => `<a class="t" href="${encodeURIComponent(r.name)}/index.html"><span><b>${escHtml(r.title)}</b><br><span class="muted mono">${escHtml(r.name)}</span></span><span class="badge">v${r.v}${r.answered ? " · 回答済み" : ""}</span><span class="muted">${r.mtime.toLocaleString("ja-JP")}</span></a>`).join("\n");
  const body = `<div class="topics"><h1>議題の一覧</h1><p class="muted">AI とのやりとりの資料 (新しい順)。各議題の index.html はいつも最新版です。</p>${list || '<p class="muted">まだありません。</p>'}</div>`;
  fs.writeFileSync(path.join(root, "index.html"), page("議題の一覧", body, css));
}

function main() {
  const args = process.argv.slice(2);
  if (!args.length || args.includes("-h") || args.includes("--help")) {
    console.log("使い方: node ai-skills/html-qa/scripts/build.mjs <議題フォルダ | vN.json> [...]");
    process.exit(args.length ? 0 : 1);
  }
  const css = fs.readFileSync(path.join(ASSETS, "style.css"), "utf8");
  const js = fs.readFileSync(path.join(ASSETS, "runtime.js"), "utf8").replace(/<\/script/gi, "<\\/script");
  const dirs = [...new Set(args.map((a) => { const p = path.resolve(a); return fs.existsSync(p) && fs.statSync(p).isDirectory() ? p : path.dirname(p); }))];
  let ok = true;
  const roots = new Set();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) { console.error(`✗ ${dir} がありません`); ok = false; continue; }
    const r = buildTopic(dir, css, js);
    roots.add(path.dirname(dir));
    for (const p of r.problems || []) {
      const name = path.relative(process.cwd(), p.file);
      for (const m of p.errs) console.error(`✗ ${name} ${m}`);
      for (const m of p.warns) console.warn(`△ ${name} ${m}`);
    }
    if (!r.ok) { ok = false; continue; }
    const relDir = path.relative(process.cwd(), dir).split(path.sep).join("/");
    console.log(`✓ ${relDir}/v${r.latest}.html (index.html も最新に更新)`);
    const u = pageUrls(path.dirname(dir), path.basename(dir));
    console.log(`  開く: ${u.local}`);
    if (u.lan) console.log(`  スマホ (家庭内 LAN): ${u.lan}`);
  }
  for (const root of roots) buildIndex(root, css);
  process.exit(ok ? 0 : 1);
}

main();
