#!/usr/bin/env node
// html-qa: 議題 JSON (vN.json) を、1 ファイルで完結する対話用 HTML に変換する。
//
//   node ai-skills/html-qa/scripts/build.mjs <topic-dir | vN.json> [...]
//   node ai-skills/html-qa/scripts/build.mjs --hub-url <URL> --project <名前>   ハブの登録 (1 回。以後は省略できる)。鍵は、環境変数 HTML_QA_HUB_KEY / --hub-key-file <ファイル | -> で渡すか、
//                                          渡さなければ共有の場所 (~/.html-qa-shared/hub.key。HTML_QA_HUB_KEY_FILE で変更) から読む (--hub-key <鍵> も使えるが、シェルの履歴と ps に残る)
//   node ai-skills/html-qa/scripts/build.mjs --hub off                                          ハブの登録を解除
//
// - 同じ議題フォルダの v*.json のうち、入力 (その版の JSON・前の版の内容と回答・画面の部品) が変わった版だけ作り直す (#1599。<topic>/.build-state.json に記録)
// - <topic>/index.html は最新版への転送ページ。F5 で最新が見られる
// - 質問 JSON の newDecisions (その版で新しく決まったことだけ) を、前の版の累積に足して、画面の「これまでに決まったこと」にする
// - 親フォルダ (既定 .tmp/html-qa/) に議題一覧 index.html を作る
// - ハブの設定 (.tmp/html-qa/.hub.json) があれば、作り直した版 (と、まだ送っていない版・最新版) をハブへ送り、ハブでの URL を出す。送れなくても
//   ローカルの HTML は作り、理由を △ で出す (終了コードは変えない)。設定が無ければ従来どおりローカルだけ
// - 形式の誤りは一覧にして終了コード 1
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { pageUrls, hubConfig, setHubConfig, readSharedKey, DEFAULT_ROOT } from "./lib.mjs";
import { hubCall, publishTopic, hubUrls, HubClientError } from "./hub-client.mjs";
import { buildIndex, versionsIn } from "./index-page.mjs";
import { SPEC, validate } from "./validate-doc.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(HERE, "..", "assets");
const MAX_IMAGE = 8 * 1024 * 1024;
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

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

// 版どうしの違いを画面で出すための、各版の要約 (質問・選択肢・決まったこと・送った回答)
function summarize(d, dir) {
  const label = (o) => (typeof o === "string" ? o : o?.label ?? o?.value ?? "");
  const questions = [];
  for (const s of d.doc.sections) for (const b of s.blocks || []) {
    if (!SPEC[b.type]?.q) continue;
    questions.push({ id: b.id, type: b.type, q: b.q, opts: b.type === "review" ? b.items.map((i) => i.title || i.id) : (b.options || b.items || []).map(label) });
  }
  let answers = null;
  try { answers = JSON.parse(fs.readFileSync(path.join(dir, `v${d.v}.answer.json`), "utf8")); } catch { /* 無い・壊れていれば null */ }
  return { version: d.v, title: d.doc.title, decisions: (d.doc.decisions || []).map((x) => x.title), questions, answers };
}

// ページごとに、そのページの版に無い質問 (消えた質問になりうるもの) の回答だけを残す。回答の全文は HTML に入れない
function historyFor(history, cur) {
  const ids = new Set(cur.questions.map((x) => x.id));
  return history.map((h) => ({ ...h, answers: h.version >= cur.version || !h.answers ? null : { questions: (h.answers.questions || []).filter((x) => x && !ids.has(x.id)).map((x) => ({ id: x.id, state: x.state, answer: x.answer })) } }));
}

// 決定の累積 (#1599): 版ごとの newDecisions (その版で新しく決まったことだけ) を前の版の累積に足す。
// decisions を書いた従来の JSON は、それを累積の土台にする (後ろ向きの互換)。since は書かなければその版
function accumulateDecisions(goodDocs) {
  let acc = [];
  for (const d of goodDocs) {
    if (Array.isArray(d.doc.decisions) && d.doc.decisions.length) acc = d.doc.decisions.map((x) => ({ ...x }));
    const nd = Array.isArray(d.doc.newDecisions) ? d.doc.newDecisions.map((x) => ({ ...x, since: x.since ?? d.v })) : [];
    if (nd.length) acc = [...acc.filter((x) => !nd.some((n) => n.title === x.title)), ...nd];
    d.doc = { ...d.doc, decisions: acc };
    delete d.doc.newDecisions;
  }
}

const sha = (s) => createHash("sha256").update(s).digest("hex").slice(0, 16);
const STATE = ".build-state.json";
const readState = (dir) => { try { const j = JSON.parse(fs.readFileSync(path.join(dir, STATE), "utf8")); return { built: j.built || {}, published: j.published || {} }; } catch { return { built: {}, published: {} }; } };
const writeState = (dir, st) => fs.writeFileSync(path.join(dir, STATE), `${JSON.stringify(st)}\n`);

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
  accumulateDecisions(good);
  const latest = good[good.length - 1].v;
  const meta = good.map((d) => ({ version: d.v, file: `v${d.v}.html`, title: d.doc.title }));
  const history = good.map((d) => summarize(d, dir));
  const rel = (f) => path.relative(process.cwd(), f).split(path.sep).join("/");
  const state = readState(dir);
  const sigs = {};
  const written = [];
  const unchanged = [];
  const assetSig = sha(css + js);
  for (const d of docs) {
    if (d.errs.length) continue;
    // 各版の HTML は、その版と、それより前の版だけに依存する (版の一覧・最新の版は埋め込まず、画面が /api/latest で知る)。
    // だから、新しい版を足しても、古い版の HTML は変わらない (#1599)
    const metaFor = { versions: meta.filter((m) => m.version <= d.v), latest: d.v, jsonPath: rel(d.file), indexHref: "../index.html", history: historyFor(history.filter((x) => x.version <= d.v), history.find((x) => x.version === d.v)) };
    const sig = sha(assetSig + JSON.stringify(d.doc) + JSON.stringify(metaFor));
    sigs[d.v] = sig;
    const htmlFile = path.join(dir, `v${d.v}.html`);
    if (state.built[d.v] === sig && fs.existsSync(htmlFile)) { unchanged.push(d.v); continue; }
    const body = `<script type="application/json" id="qa-doc">${jsonForScript(d.doc)}</script>
<script type="application/json" id="qa-meta">${jsonForScript(metaFor)}</script>
<noscript>この資料の表示には JavaScript が必要です。</noscript>
<script>${js}</script>`;
    fs.writeFileSync(htmlFile, page(`${d.doc.title} — v${d.v}`, body, css));
    written.push(d.v);
  }
  // index.html は最新版への転送ページ (最新版の丸ごとの写しにしない)
  const redirect = `<!doctype html>\n<html lang="ja"><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=v${latest}.html"><title>v${latest}</title></head><body><a href="v${latest}.html">最新の v${latest} を開く</a></body></html>\n`;
  const indexFile = path.join(dir, "index.html");
  if (!fs.existsSync(indexFile) || fs.readFileSync(indexFile, "utf8") !== redirect) fs.writeFileSync(indexFile, redirect);
  state.built = sigs;
  writeState(dir, state);
  return { ok: problems.every((p) => !p.errs.length), problems, latest, dir, built: good.map((d) => d.v), written, unchanged, sigs, state };
}

// --name 値 の形のオプションを取り出し、残りの引数を返す
function takeOpts(args, names) {
  const opts = {};
  const rest = [];
  for (let i = 0; i < args.length; i++) {
    const m = names.find((n) => args[i] === `--${n}`);
    if (m) { opts[m] = args[i + 1]; i++; } else rest.push(args[i]);
  }
  return { opts, rest };
}

// ハブの登録・解除。設定を書いた root を返す
async function registerHub(opts, root) {
  if (opts.hub !== undefined) {
    if (opts.hub !== "off") { console.error('✗ --hub は "off" だけ指定できます (登録は --hub-url / --hub-key / --project)'); process.exit(2); }
    setHubConfig(root, { url: "off" });
    console.log("✓ ハブの登録を解除しました (以後はこのプロジェクトのローカルだけで動きます)");
    return;
  }
  const cur = hubConfig(root);
  const project = opts.project ?? cur?.project ?? path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 41);
  // 鍵は、コマンドラインに書かない渡し方 (環境変数 HTML_QA_HUB_KEY / --hub-key-file <ファイル | - で標準入力>) を勧める (履歴と ps に残るため)
  let key = opts["hub-key"];
  if (key === undefined && opts["hub-key-file"] !== undefined) {
    try { key = fs.readFileSync(opts["hub-key-file"] === "-" ? 0 : opts["hub-key-file"], "utf8").trim(); } catch (e) { console.error(`✗ --hub-key-file を読めません: ${e.code || e.message}`); process.exit(2); }
  }
  if (key === undefined && process.env.HTML_QA_HUB_KEY) key = process.env.HTML_QA_HUB_KEY.trim();
  // 鍵の順番: --hub-key → --hub-key-file → HTML_QA_HUB_KEY → 共有の場所 (#1595。保存せず毎回読む) → 前の登録の鍵
  const useShared = key === undefined && !!readSharedKey();
  let cfg;
  try { cfg = setHubConfig(root, { url: opts["hub-url"] ?? cur?.url, key: useShared ? null : (key ?? (cur?.shared ? null : cur?.key)), project }); } catch (e) { console.error(`✗ ${e.message}`); process.exit(2); }
  console.log(`✓ ハブを登録しました: ${cfg.url} (プロジェクト名: ${cfg.project}) → ${path.relative(process.cwd(), path.join(root, ".hub.json")) || ".hub.json"} ${cfg.shared ? "(鍵は共有の場所から毎回読みます)" : "(鍵を含むので他人に渡さない)"}`);
  try { await hubCall(cfg, "GET", "/api/ping"); console.log("  ハブにつながりました"); } catch (e) { console.warn(`△ ${e.message}\n  (登録はしました。ハブが起動してから build.mjs を実行してください)`); }
}

// 作った全版をハブへ送り、URL を出す。失敗は △ で理由を出し、ローカルの結果は変えない
async function publishToHub(cfg, dir, r) {
  const rel = (f) => path.relative(process.cwd(), f).split(path.sep).join("/");
  const hubKey = `${cfg.url}|${cfg.project}`;
  const sent = r.state.published[hubKey] || {};
  const latest = r.built[r.built.length - 1];
  const todo = r.built.filter((v) => sent[v] !== r.sigs[v] || v === latest);   // 最新版は、ハブでの URL を受け取るために毎回送る
  try {
    const res = await publishTopic(cfg, dir, todo);
    r.state.published[hubKey] = { ...sent, ...Object.fromEntries(todo.map((v) => [v, r.sigs[v]])) };
    writeState(dir, r.state);
    const u = hubUrls(cfg, res);
    console.log(`  ハブに送りました: ${cfg.project}/${path.basename(dir)} (${todo.map((v) => `v${v}`).join("・")}。ほかの ${r.built.length - todo.length} 版は変更なし)`);
    console.log(`  開く: ${u.local}`);
    if (u.lan) console.log(`  スマホ (家庭内 LAN): ${u.lan}`);
    return true;
  } catch (e) {
    const why = e instanceof HubClientError ? e.message : `想定外の失敗: ${e.message}`;
    console.warn(`△ ハブに送れませんでした: ${why}\n  ローカルの HTML は作りました (${rel(path.join(dir, `v${latest}.html`))})。ハブへは、直してからもう一度 build.mjs を動かすと送ります。`);
    return false;
  }
}

async function main() {
  const { opts, rest: args } = takeOpts(process.argv.slice(2), ["hub-url", "hub-key", "hub-key-file", "project", "hub"]);
  const wantsHub = ["hub-url", "hub-key", "hub-key-file", "project", "hub"].some((k) => opts[k] !== undefined);
  if ((!args.length && !wantsHub) || args.includes("-h") || args.includes("--help")) {
    console.log("使い方: node ai-skills/html-qa/scripts/build.mjs <議題フォルダ | vN.json> [...]\n        node ai-skills/html-qa/scripts/build.mjs --hub-url <URL> --project <名前>   (ハブの登録。鍵は環境変数 HTML_QA_HUB_KEY か --hub-key-file。--hub off で解除)");
    process.exit(args.length || wantsHub ? 0 : 1);
  }
  const css = fs.readFileSync(path.join(ASSETS, "style.css"), "utf8");
  const js = fs.readFileSync(path.join(ASSETS, "runtime.js"), "utf8").replace(/<\/script/gi, "<\\/script");
  const dirs = [...new Set(args.map((a) => { const p = path.resolve(a); return fs.existsSync(p) && fs.statSync(p).isDirectory() ? p : path.dirname(p); }))];
  if (wantsHub) {
    await registerHub(opts, dirs.length ? path.dirname(dirs[0]) : path.resolve(DEFAULT_ROOT));
    if (!dirs.length) process.exit(0);
  }
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
    console.log(`✓ ${relDir}/v${r.latest}.html (${r.written.length ? `作り直した版: ${r.written.map((v) => `v${v}`).join("・")}` : "変更なし"}${r.unchanged.length ? `。ほかの ${r.unchanged.length} 版は変更なし` : ""})`);
    const hub = hubConfig(path.dirname(dir));
    if (hub) { await publishToHub(hub, dir, r); continue; }
    const u = pageUrls(path.dirname(dir), path.basename(dir));
    console.log(`  開く: ${u.local}`);
    if (u.lan) console.log(`  スマホ (家庭内 LAN): ${u.lan}`);
  }
  for (const root of roots) buildIndex(root);
  process.exit(ok ? 0 : 1);
}

main();
