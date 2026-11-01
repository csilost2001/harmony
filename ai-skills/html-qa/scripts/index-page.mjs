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
    document.querySelectorAll("section.grp").forEach((g) => { g.hidden = !g.querySelector(".t:not([hidden])"); });
    btns.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === filter)));
    const p = new URLSearchParams(); if (qi.value.trim()) p.set("q", qi.value); if (filter !== "all") p.set("filter", filter);
    try { history.replaceState(null, "", location.pathname + (p.toString() ? "?" + p : "")); } catch { /* file:// など */ }
  };
  qi.addEventListener("input", apply);
  btns.forEach((b) => b.addEventListener("click", () => { filter = b.dataset.filter; apply(); }));
  apply();
})();`;

// baseDir 直下の議題フォルダを、一覧の 1 行ごとのデータにする。hrefPrefix は一覧から議題へのリンクの前置き
export function collectRows(baseDir, hrefPrefix = "") {
  const rows = [];
  if (!fs.existsSync(baseDir)) return rows;
  for (const e of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith(".")) continue;
    const dir = path.join(baseDir, e.name);
    // ハブに預かった議題は json が無いこともある (html だけ)。版は json と html の両方から数える
    const vs = [...new Set([...versionsIn(dir), ...fs.readdirSync(dir).map((f) => f.match(/^v(\d+)\.html$/)).filter(Boolean).map((m) => Number(m[1]))])].sort((a, b) => a - b);
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
    const mtime = fs.statSync(path.join(dir, fs.existsSync(path.join(dir, `v${v}.json`)) ? `v${v}.json` : `v${v}.html`)).mtime;
    const answered = fs.existsSync(path.join(dir, `v${v}.answer.md`));
    rows.push({ name: e.name, href: `${hrefPrefix}${encodeURIComponent(e.name)}/index.html`, title, v, mtime, answered, h: nz([title, e.name, doc?.lead || "", ...qs, ans.slice(0, MAX_ANS)].join("\n")) });
  }
  rows.sort((a, b) => b.mtime - a.mtime);
  return rows;
}

// groups: [{ label?, href?, rows }]。label のあるグループは見出し (プロジェクト名) つきで分けて出す。検索・絞り込みは全グループにかかる
export function renderIndex(groups, { heading = "議題の一覧", lead = "AI とのやりとりの資料 (新しい順)。各議題の index.html はいつも最新版です。", back = null } = {}) {
  const all = groups.flatMap((g) => g.rows);
  const rowHtml = (r) => `<a class="t" href="${r.href}"><span><b>${escHtml(r.title)}</b><br><span class="muted mono">${escHtml(r.name)}</span></span><span class="badge">v${r.v}${r.answered ? " · 回答済み" : ""}</span><span class="muted">${escHtml(r.mtime.toLocaleString("ja-JP"))}</span></a>`;
  const list = groups.map((g) => {
    const inner = g.rows.map(rowHtml).join("\n");
    if (!g.label) return inner;
    const head = g.href ? `<a href="${g.href}">${escHtml(g.label)}</a>` : escHtml(g.label);
    return `<section class="grp"><h2>${head} <span class="muted">${g.rows.length} 件</span></h2>\n${inner}</section>`;
  }).join("\n");
  const tool = all.length ? `<div class="tfilter"><input type="search" id="qs" placeholder="題名・質問・回答から探す (空白で絞り込み)" aria-label="議題を探す"><span class="fbtns"><button class="btn" data-filter="all">すべて</button><button class="btn" data-filter="waiting">回答待ち</button><button class="btn" data-filter="answered">回答済み</button></span><span class="muted" id="cnt"></span></div>` : "";
  const backHtml = back ? `<p><a href="${back.href}">${escHtml(back.label)}</a></p>` : "";
  const body = `<div class="topics">${backHtml}<h1>${escHtml(heading)}</h1><p class="muted">${escHtml(lead)}</p>${tool}${list || '<p class="muted">まだありません。</p>'}<p class="muted" id="none" hidden>一致する議題がありません。</p></div>
<script type="application/json" id="qa-index">${jsonForScript(all.map((r) => ({ answered: r.answered, h: r.h })))}</script>
${all.length ? `<script>${SCRIPT}</script>` : ""}`;
  return `<!doctype html>
<html lang="ja">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escHtml(heading)}</title>
<style>${fs.readFileSync(CSS, "utf8")}</style>
</head>
<body>
${body}
</body>
</html>
`;
}

export function buildIndex(root) {
  fs.writeFileSync(path.join(root, "index.html"), renderIndex([{ rows: collectRows(root) }]));
}
