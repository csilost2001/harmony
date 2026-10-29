// html-qa: 議題の一覧 (index.html) を作る。build.mjs と serve.mjs (回答の保存後) の両方から使う。
//   検索 (題名・議題名・最新版の lead と質問・各版の回答) と、回答待ち / 回答済みの絞り込みつき
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CSS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "assets", "style.css");
const MAX_ANS = 20_000;
const QTYPES = new Set(["choice", "multi", "input", "scale", "rank", "review"]);
const escHtml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const jsonForScript = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
const nz = (s) => String(s).normalize("NFKC").toLowerCase();
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

export function versionsIn(dir) {
  return fs.readdirSync(dir).map((f) => f.match(/^v(\d+)\.json$/)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
}

const SCRIPT = `(() => {
  const D = JSON.parse(document.getElementById("qa-index").textContent), nz = (s) => s.normalize("NFKC").toLowerCase();
  const rows = [...document.querySelectorAll(".topics .t")], qi = document.getElementById("qs"), cnt = document.getElementById("cnt"), none = document.getElementById("none");
  const btns = [...document.querySelectorAll("[data-filter]")], P = new URLSearchParams(location.search);
  let filter = ["waiting", "answered"].includes(P.get("filter")) ? P.get("filter") : "all";
  qi.value = P.get("q") || "";
  const apply = () => {
    const words = nz(qi.value).split(/\\s+/).filter(Boolean); let n = 0;
    rows.forEach((el, i) => {
      const d = D[i], ok = words.every((w) => d.h.includes(w)) && (filter === "all" || (filter === "answered") === d.answered);
      el.hidden = !ok; if (ok) n++;
    });
    cnt.textContent = n + " 件"; none.hidden = n > 0;
    btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === filter)));
    const p = new URLSearchParams(); if (qi.value.trim()) p.set("q", qi.value); if (filter !== "all") p.set("filter", filter);
    try { history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "")); } catch { /* file:// など */ }
  };
  qi.addEventListener("input", apply);
  btns.forEach((b) => b.addEventListener("click", () => { filter = b.dataset.filter; apply(); }));
  apply();
})();`;

export function buildIndex(root) {
  const rows = [];
  for (const e of fs.readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    const dir = path.join(root, e.name);
    const vs = versionsIn(dir);
    if (!vs.length) continue;
    const v = vs[vs.length - 1];
    const doc = readJson(path.join(dir, `v${v}.json`));
    const title = doc?.title || e.name;
    const qs = [];
    const walk = (blocks) => { for (const b of blocks || []) { if (b?.type === "details") walk(b.blocks); else if (QTYPES.has(b?.type) && b.q) qs.push(b.q); } };
    for (const s of doc?.sections || []) walk(s?.blocks);
    let ans = "";
    for (const n of vs) {
      const f = path.join(dir, `v${n}.answer.md`);
      if (fs.existsSync(f) && ans.length < MAX_ANS) ans += `${fs.readFileSync(f, "utf8").replace(/^<!--.*?-->\n/, "")}\n`;
    }
    const mtime = fs.statSync(path.join(dir, `v${v}.json`)).mtime;
    const answered = fs.existsSync(path.join(dir, `v${v}.answer.md`));
    rows.push({ name: e.name, title, v, mtime, answered, h: nz([title, e.name, doc?.lead || "", ...qs, ans.slice(0, MAX_ANS)].join("\n")) });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  const list = rows.map((r) => `<a class="t" href="${encodeURIComponent(r.name)}/index.html"><span><b>${escHtml(r.title)}</b><br><span class="muted mono">${escHtml(r.name)}</span></span><span class="badge">v${r.v}${r.answered ? " · 回答済み" : ""}</span><span class="muted">${escHtml(r.mtime.toLocaleString("ja-JP"))}</span></a>`).join("\n");
  const tool = rows.length ? `<div class="tfilter"><input type="search" id="qs" placeholder="題名・質問・回答から探す (空白で絞り込み)" aria-label="議題を探す"><span class="fbtns"><button class="btn" data-filter="all">すべて</button><button class="btn" data-filter="waiting">回答待ち</button><button class="btn" data-filter="answered">回答済み</button></span><span class="muted" id="cnt"></span></div>` : "";
  const body = `<div class="topics"><h1>議題の一覧</h1><p class="muted">AI とのやりとりの資料 (新しい順)。各議題の index.html はいつも最新版です。</p>${tool}${list || '<p class="muted">まだありません。</p>'}<p class="muted" id="none" hidden>一致する議題がありません。</p></div>
<script type="application/json" id="qa-index">${jsonForScript(rows.map((r) => ({ answered: r.answered, h: r.h })))}</script>
${rows.length ? `<script>${SCRIPT}</script>` : ""}`;
  const html = `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>議題の一覧</title>
<style>${fs.readFileSync(CSS, "utf8")}</style>
</head>
<body>
${body}
</body>
</html>
`;
  fs.writeFileSync(path.join(root, "index.html"), html);
}
