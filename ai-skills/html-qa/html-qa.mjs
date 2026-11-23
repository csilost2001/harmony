#!/usr/bin/env node
// html-qa の薄いクライアント (1 ファイル・外部ライブラリなし)。議題の JSON をハブへ送り、ハブが HTML を作る。回答をハブから受け取る。
//
//   node html-qa.mjs init    [--hub-url URL] [--project 名] [--skill-dir DIR]
//                                                              SKILL.md と自分自身を DIR (既定 .claude/skills/html-qa/) に置き、ハブを探して接続する
//   node html-qa.mjs pair    [--hub-url URL] [--project 名]   ハブを探して接続を依頼し、ハブの画面での承認を待つ
//   node html-qa.mjs publish <議題フォルダ>                    版ごとの JSON をハブへ送る (変わった版と最新版)。開く URL を出す
//   node html-qa.mjs check   <議題フォルダ>                    検査だけ (保存しない)
//   node html-qa.mjs wait    <議題フォルダ> [--timeout-min 120] 回答を待ち、届いたらローカルに書いて表示する
//   node html-qa.mjs hook                                       Claude Code の UserPromptSubmit hook (未読の回答を発言に添える)
//   node html-qa.mjs status                                     ハブ・接続・議題の状態
//   node html-qa.mjs update                                     ハブと版が違えば、自分自身と SKILL.md をハブのものに取り替える (sha256 を確かめる)
//
// ローカルに置くもの: .tmp/html-qa/.hub.json ({ url, project, token, hubId }。0600。git に入れない) と、議題フォルダ .tmp/html-qa/<topic>/
// 終了コード: 0 成功 / 1 検査の誤り / 2 引数の誤り / 3 時間切れ / 4 トークンが違う・取り消された / 5 ハブを見つけたが利用者の確認が要る
//             6 ハブに届かない / 7 版 (apiVersion) が合わない
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export const VERSION = "0.3.1";
export const API_VERSION = 2;
const CLIENT_HEADER = `${VERSION}/${API_VERSION}`;
const DEFAULT_ROOT = ".tmp/html-qa";
const NAME_RE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const RESERVED = new Set(["api", "p", "projects", "assets", "client", "index.html"]);
const MAX_IMAGE = 8 * 1024 * 1024;
const MAX_DOC = 16 * 1024 * 1024;
const MAX_TEXT = 200_000;
const MIME = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };
const SAME_PC = ["http://host.docker.internal:18190", "http://localhost:18190", "http://127.0.0.1:18190"];
const LAN_NAMES = ["html-qa.local", "html-qa.lan", "html-qa.home.arpa", "html-qa"];

class Stop extends Error { constructor(code, message) { super(message); this.code = code; } }
const out = (m) => console.log(m);
const warn = (m) => console.error(m);
const rel = (f) => path.relative(process.cwd(), f).split(path.sep).join("/") || ".";

// ---- 設定 ----
const cfgFile = (root) => path.join(root, ".hub.json");
function readConfig(root) {
  try {
    const c = JSON.parse(fs.readFileSync(cfgFile(root), "utf8"));
    if (c && typeof c.url === "string" && typeof c.project === "string" && typeof c.token === "string") return c;
  } catch { /* 無い・壊れている */ }
  return null;
}
function writeConfig(root, c) {
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(cfgFile(root), `${JSON.stringify(c, null, 2)}\n`, { mode: 0o600 });
  fs.chmodSync(cfgFile(root), 0o600);
}
const needConfig = (root) => {
  const c = readConfig(root);
  if (!c) throw new Stop(4, `ハブにまだ接続していません (${rel(cfgFile(root))} がありません)。先に node ${scriptRel()} pair を実行してください`);
  return c;
};
const scriptRel = () => rel(process.argv[1] || "html-qa.mjs");

// トークンを送ってよい宛先: https のハブと、同じ PC のハブだけ (LAN の http:// には送らない。10 章)
function tokenAllowed(url, allowInsecureLan) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === "https:") return true;
  const h = u.hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return ["localhost", "127.0.0.1", "::1", "host.docker.internal"].includes(h) || allowInsecureLan === true;
}

// ---- 通信 ----
async function call(url, method, p, { body, token, headers = {}, timeoutMs = 15_000 } = {}) {
  let res;
  try {
    res = await fetch(`${url}${p}`, {
      method,
      headers: { "X-Html-Qa-Client": CLIENT_HEADER, ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error", // トークンを、リダイレクト先 (別のオリジン) へ持ち出さない
    });
  } catch (e) {
    throw new Stop(6, `ハブに届きません (${e?.cause?.code || e?.name || "error"})。ハブのコンテナが動いているか確かめてください (docker compose ps)\n  ハブ: ${url}`);
  }
  let json = null;
  if (res.status !== 204) { try { json = await res.json(); } catch { /* 本文なし */ } }
  if (res.status === 426) throw new Stop(7, json?.error || "クライアントの版がハブと合いません。update で更新してください");
  if (res.status === 401 && token) throw new Stop(4, json?.error || "トークンが違うか、取り消されています。pair で接続し直してください");
  return { status: res.status, json };
}

const hubInfoCache = new Map();
async function hubInfo(url, timeoutMs = 5000) {
  if (hubInfoCache.has(url)) return hubInfoCache.get(url);
  const r = await call(url, "GET", "/api/hub", { timeoutMs });
  if (r.status !== 200 || r.json?.name !== "html-qa") throw new Stop(6, `${url} は html-qa のハブではありません`);
  hubInfoCache.set(url, r.json);
  return r.json;
}

// トークンを使う前に、接続先が登録したハブと同じか (hubId) を確かめる。違えば送らない
async function api(cfg, method, p, opts = {}) {
  if (!tokenAllowed(cfg.url, cfg.allowInsecureLan)) throw new Stop(2, `LAN の http:// のハブ (${cfg.url}) には、トークンを送りません。ハブを HTTPS にしてください`);
  const info = await hubInfo(cfg.url);
  if (info.apiVersion !== API_VERSION) throw new Stop(7, `ハブ (apiVersion ${info.apiVersion}) とクライアント (apiVersion ${API_VERSION}) の版が合いません。node ${scriptRel()} update で更新してください`);
  if (cfg.hubId && info.hubId !== cfg.hubId) throw new Stop(4, `接続先 (${cfg.url}) は、前に接続したハブと別のハブです。トークンは送りません。pair で接続し直してください`);
  noticeUpdate(info);
  outsideNotice();
  return call(cfg.url, method, p, { ...opts, token: cfg.token });
}

// ---- クライアントの更新の案内 (#13) ----
// ハブが配るクライアント・手順書と、手元のものを sha256 で比べる。違えば、AI 宛てに「利用者の許可を得てから update する」よう案内する。
// 自分では書き換えない (プロジェクトの git に、利用者の知らない差分を作らない)
function updateAvailable(info) {
  const hub = info?.client;
  if (!hub || typeof hub !== "object" || !hub.files) return info?.version && info.version !== VERSION ? { from: VERSION, to: info.version, files: [] } : null;
  const mine = { "html-qa.mjs": fs.readFileSync(SELF()), "SKILL.md": localSkill() };
  const files = Object.keys(mine).filter((n) => typeof hub.files[n] === "string" && mine[n] && sha256(mine[n]) !== hub.files[n]);
  return files.length ? { from: VERSION, to: hub.version || info.version, files, key: Object.values(hub.files).join(",") } : null;
}
const updateMessage = (u) => [
  `[html-qa] クライアントの更新があります (手元 v${u.from} → ハブ v${u.to}${u.files.length ? `。違うもの: ${u.files.join(" / ")}` : ""})。`,
  "  AI へ: 利用者に「html-qa のクライアントと手順書を、ハブの版に更新してよいか」を確かめてください。許可が出たら次を実行します (許可が無ければ実行しない。いまの作業はこのまま続けてよい):",
  `    node ${scriptRel()} update`,
  "  更新したら、取り替わったファイルを git に入れるよう利用者に伝えてください。",
].join("\n");
let noticeSink = warn; // hook では、AI の文脈に入れるために集める

// プロジェクトの外 (ほかのリポジトリ) のクライアントを動かしていて、プロジェクトにスキルが無いか (#15)
const projectDir = () => path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
const inside = (file, dir) => { const r = path.relative(dir, file); return r !== "" && !r.startsWith("..") && !path.isAbsolute(r); };
function outsideNotice() {
  if (outsideNotice.done) return;
  outsideNotice.done = true;
  try {
    const proj = projectDir();
    if (inside(SELF(), proj) || fs.existsSync(path.join(proj, DEFAULT_SKILL_DIR, "html-qa.mjs"))) return;
    warn([
      `[html-qa] このプロジェクト (${proj}) に html-qa のスキルがありません。ほかの場所のクライアント (${SELF()}) を動かしています。`,
      "  AI へ: ほかのリポジトリの html-qa を使い続けないでください。利用者に「このプロジェクトに html-qa を導入してよいか」を確かめ、許可が出たら、プロジェクトのフォルダで次を実行します:",
      `    node ${scriptRel()} init`,
      "  (スキルと hook が置かれます。接続済みなら、承認はもう要りません)",
    ].join("\n"));
  } catch { /* 案内は出せなくてもよい */ }
}
function noticeUpdate(info) {
  if (noticeUpdate.done) return;
  noticeUpdate.done = true;
  try { const u = updateAvailable(info); if (u) noticeSink(updateMessage(u), u); } catch { /* 案内は出せなくてもよい */ }
}

// ---- ハブを探す (8 章。mDNS は段階 4) ----
async function probe(url) { try { const i = await hubInfo(url, 1500); return i; } catch { return null; } }
async function findHub(root, given) {
  const explicit = given || process.env.HTML_QA_HUB_URL || readConfig(root)?.url;
  if (explicit) {
    const url = normUrl(explicit);
    const info = await probe(url);
    if (!info) throw new Stop(6, `ハブに届きません。ハブのコンテナが動いているか、URL が合っているか確かめてください\n  ハブ: ${url}`);
    return { url, info };
  }
  for (const url of SAME_PC) { const info = await probe(url); if (info) return { url, info }; }
  for (const name of LAN_NAMES) for (const url of [`https://${name}`, `http://${name}:18190`]) {
    const info = await probe(url);
    if (info) throw new Stop(5, `LAN の中にハブを見つけました (ハブの名前 ${info.hubName})。このハブでよければ、下の URL を --hub-url に付けてもう一度実行してください (利用者に確かめてから)\n  ハブ: ${url}`);
  }
  throw new Stop(6, "ハブが見つかりません。ハブのコンテナを起動するか (docker compose up -d)、--hub-url でハブの URL を指定してください");
}
function normUrl(s) {
  let u;
  try { u = new URL(s); } catch { throw new Stop(2, `--hub-url が不正です: ${s}`); }
  if (!/^https?:$/.test(u.protocol)) throw new Stop(2, "--hub-url は http:// か https:// で始まる URL にしてください");
  return `${u.protocol}//${u.host}`;
}

// ---- pair ----
async function cmdPair(root, opts) {
  const project = opts.project ?? readConfig(root)?.project ?? path.basename(process.cwd()).toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 41);
  if (!NAME_RE.test(project) || RESERVED.has(project)) throw new Stop(2, "--project は英小文字・数字・ハイフンで 41 文字までにしてください (例: tax-app)");
  const { url, info } = await findHub(root, opts["hub-url"]);
  if (info.apiVersion !== API_VERSION) throw new Stop(7, `ハブ (apiVersion ${info.apiVersion}) とクライアント (apiVersion ${API_VERSION}) の版が合いません`);
  const allowInsecureLan = opts["allow-insecure-lan"] === true;
  if (!tokenAllowed(url, allowInsecureLan)) throw new Stop(2, `LAN の http:// のハブ (${url}) には接続しません (トークンが平文で流れるため)。ハブを HTTPS にしてください`);
  if (!opts.fromInit) outsideNotice();
  const r = await call(url, "POST", "/api/pair/request", { body: { project, clientVersion: VERSION, host: os.hostname() } });
  if (r.status !== 200) throw new Stop(r.status === 429 ? 3 : 2, `接続を依頼できませんでした: ${r.json?.error || r.status}`);
  const { requestId, pollSecret, code } = r.json;
  out(`ハブ「${info.hubName}」に、プロジェクト「${project}」の接続を依頼しました。`);
  out(`ハブの画面で、コードが同じことを確かめて「承認」を押してください (10 分で時間切れ)。コード: ${code}`);
  const urls = (r.json.urls || []).length ? r.json.urls : [`${url}/`];
  urls.forEach((u, i) => out(`  ${i === 0 ? "開く" : "LAN"}: ${u}`));
  const deadline = Date.now() + Math.min(Number(opts["timeout-min"] ?? 10), 10) * 60_000;
  const every = Number(process.env.HTML_QA_PAIR_POLL_MS) || 2000;
  // 止められたら、依頼を取り下げる (ハブの画面に、待ち手のいない依頼を残さない)
  const cancel = async () => { try { await call(url, "POST", "/api/pair/cancel", { body: { requestId }, headers: { "X-Pair-Secret": pollSecret }, timeoutMs: 3000 }); } catch { /* 届かなくてもよい (ハブは 30 秒で「待っていない」とみなす) */ } };
  const onInt = async () => { await cancel(); process.exit(130); };
  const onTerm = async () => { await cancel(); process.exit(143); };
  process.once("SIGINT", onInt);
  process.once("SIGTERM", onTerm);
  try { return await waitApproval(); } finally { process.off("SIGINT", onInt); process.off("SIGTERM", onTerm); }

  async function waitApproval() {
  while (Date.now() < deadline) {
    await new Promise((res) => setTimeout(res, every));
    let s;
    try { s = await call(url, "GET", `/api/pair/status?requestId=${encodeURIComponent(requestId)}`, { headers: { "X-Pair-Secret": pollSecret } }); } catch (e) { if (e.code === 6) continue; throw e; }
    if (s.status === 404) throw new Stop(3, s.json?.error || "接続の依頼が見つかりません (時間切れ)。もう一度 pair を実行してください");
    if (s.json?.state === "denied") throw new Stop(4, "ハブの画面で、接続が断られました");
    if (s.json?.state === "approved" && typeof s.json.token === "string") {
      writeConfig(root, { url, project, token: s.json.token, hubId: info.hubId, ...(allowInsecureLan ? { allowInsecureLan: true } : {}) });
      out(`✓ 承認されました。設定を ${rel(cfgFile(root))} に書きました (トークンを含むので git に入れない・他人に渡さない)`);
      return 0;
    }
  }
  await cancel();
  throw new Stop(3, "承認を待ちましたが、時間切れになりました。もう一度 pair を実行してください");
  }
}

// ---- 議題フォルダ ----
const versionsIn = (dir) => fs.readdirSync(dir).map((f) => f.match(/^v(\d+)\.json$/)).filter(Boolean).map((m) => Number(m[1])).sort((a, b) => a - b);
function topicOf(dirArg) {
  if (!dirArg) throw new Stop(2, `議題フォルダを指定してください (例: node ${scriptRel()} publish .tmp/html-qa/<topic>)`);
  let dir = path.resolve(dirArg);
  if (fs.existsSync(dir) && fs.statSync(dir).isFile()) dir = path.dirname(dir);
  if (!fs.existsSync(dir) || !versionsIn(dir).length) throw new Stop(2, `${dirArg}: 議題フォルダ (v*.json がある所) ではありません`);
  const topic = path.basename(dir);
  if (!NAME_RE.test(topic)) throw new Stop(2, `議題名「${topic}」はハブに送れません (英小文字・数字・ハイフンで 41 文字まで)`);
  return { dir, topic, root: path.dirname(dir) };
}

// 画像を data: にして埋め込む (1 枚 8MB まで)。大きすぎる・無いファイルは、送る前に止める
function embedImages(blocks, dir, errs) {
  for (const b of Array.isArray(blocks) ? blocks : []) {
    if (b?.type === "details") embedImages(b.blocks, dir, errs);
    if (b?.type !== "image" || typeof b.src !== "string" || /^(https?:|data:)/.test(b.src)) continue;
    const f = path.resolve(dir, b.src);
    const mime = MIME[path.extname(f).toLowerCase()];
    if (!fs.existsSync(f)) { errs.push(`image "${b.src}": ファイルがありません (${rel(f)})`); continue; }
    if (!mime) { errs.push(`image "${b.src}": 使えない形式です (${Object.keys(MIME).join(" ")})`); continue; }
    const size = fs.statSync(f).size;
    if (size > MAX_IMAGE) { errs.push(`image "${b.src}": ${(size / 1048576).toFixed(1)}MB は大きすぎます (8MB まで)`); continue; }
    b.src = `data:${mime};base64,${fs.readFileSync(f).toString("base64")}`;
  }
}
function loadDoc(dir, v) {
  const file = path.join(dir, `v${v}.json`);
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return { file, errs: [`JSON として読めません: ${e.message}`] }; }
  const errs = [];
  for (const s of Array.isArray(doc?.sections) ? doc.sections : []) embedImages(s?.blocks, dir, errs);
  const text = JSON.stringify(doc);
  if (Buffer.byteLength(text) > MAX_DOC) errs.push(`画像を埋め込むと ${(Buffer.byteLength(text) / 1048576).toFixed(1)}MB になり、大きすぎます (1 版 16MB まで)`);
  return { file, doc, errs, sha: createHash("sha256").update(text).digest("hex") };
}
const STATE = ".publish-state.json";
const readState = (dir) => { try { return JSON.parse(fs.readFileSync(path.join(dir, STATE), "utf8")) || {}; } catch { return {}; } };

function report(file, r) {
  for (const m of r?.errs || []) warn(`✗ ${rel(file)} ${m}`);
  for (const m of r?.warns || []) warn(`△ ${rel(file)} ${m}`);
}

async function cmdPublish(dirArg, { checkOnly = false } = {}) {
  const { dir, topic, root } = topicOf(dirArg);
  const cfg = needConfig(root);
  const vs = versionsIn(dir);
  const latest = vs[vs.length - 1];
  const state = readState(dir);
  const key = `${cfg.hubId || cfg.url}|${cfg.project}`;
  const sent = state[key] || {};
  let ok = true;
  let urls = null;
  const done = [];
  for (const v of vs) {
    const d = loadDoc(dir, v);
    if (d.errs.length) { report(d.file, { errs: d.errs }); ok = false; continue; }
    if (!checkOnly && sent[v] === d.sha && v !== latest) continue; // 変わっていない版は送らない (最新版は、開く URL を受け取るために送る)
    const r = await api(cfg, "POST", checkOnly ? "/api/validate" : "/api/publish", { body: { topic, version: v, doc: d.doc }, timeoutMs: 60_000 });
    if (r.status === 422) { report(d.file, r.json); ok = false; continue; }
    if (r.status !== 200) { warn(`✗ ${rel(d.file)} ハブが ${r.status} を返しました: ${r.json?.error || ""}`); ok = false; continue; }
    report(d.file, r.json);
    if (!checkOnly) { sent[v] = d.sha; done.push(v); urls = r.json.urls; }
  }
  if (!checkOnly) { state[key] = sent; fs.writeFileSync(path.join(dir, STATE), `${JSON.stringify(state)}\n`); }
  if (checkOnly) { out(ok ? `✓ ${rel(dir)}: 誤りはありません` : `✗ ${rel(dir)}: 誤りがあります`); return ok ? 0 : 1; }
  if (done.length) {
    out(`✓ ${cfg.project}/${topic}: ${done.map((v) => `v${v}`).join("・")} を送りました (ハブが HTML を作りました)`);
    if (urls?.length) { out(`  開く: ${urls[0]}`); for (const u of urls.slice(1)) out(`  LAN: ${u}`); }
  }
  return ok ? 0 : 1;
}

// ---- 回答 (ローカル) ----
function unreadAnswers(dirs) {
  const list = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^v(\d+)\.answer\.md$/);
      if (!m) continue;
      const file = path.join(dir, f);
      const mtimeMs = Math.floor(fs.statSync(file).mtimeMs);
      const seenFile = file.replace(/\.md$/, ".seen");
      const seen = fs.existsSync(seenFile) ? Number(fs.readFileSync(seenFile, "utf8").trim()) : 0;
      if (mtimeMs > seen) list.push({ topic: path.basename(dir), version: Number(m[1]), file, seenFile, mtimeMs });
    }
  }
  return list.sort((a, b) => a.mtimeMs - b.mtimeMs);
}
const isSeenLocal = (dir, v) => {
  const file = path.join(dir, `v${v}.answer.md`);
  if (!fs.existsSync(file)) return false;
  const seenFile = file.replace(/\.md$/, ".seen");
  return fs.existsSync(seenFile) && Number(fs.readFileSync(seenFile, "utf8").trim()) >= Math.floor(fs.statSync(file).mtimeMs);
};
const markSeen = (a) => fs.writeFileSync(a.seenFile, String(a.mtimeMs));
function readAnswer(a) {
  const text = fs.readFileSync(a.file, "utf8").replace(/^<!--.*?-->\n/, "");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(長すぎるため以降を省略。全文は ${rel(a.file)})` : text;
}
const formatAnswers = (list) => list.map((a) => `[html-qa] 回答が届きました: ${rel(a.file)} (topic: ${a.topic} / v${a.version})\n\n${readAnswer(a).trim()}`).join("\n\n---\n\n");

// ハブにある未読の回答を、ローカルの <root>/<topic>/vN.answer.md (と .json) に書く
async function pullAnswers(root, cfg, topic = null, opts = {}) {
  const r = await api(cfg, "GET", `/api/answer?unread=1${topic ? `&topic=${encodeURIComponent(topic)}` : ""}`, opts);
  if (r.status === 404 && topic) throw new Stop(6, `ハブにその議題がありません (project=${cfg.project}, topic=${topic})。publish したか確かめてください`);
  if (r.status === 204 || !Array.isArray(r.json?.answers)) return [];
  const got = [];
  for (const a of r.json.answers) {
    const dir = path.join(root, String(a.topic));
    if (!NAME_RE.test(String(a.topic)) || !fs.existsSync(dir) || !Number.isInteger(a.version) || a.version < 1 || typeof a.text !== "string") continue; // ローカルに無い議題は書かない
    const md = path.join(dir, `v${a.version}.answer.md`);
    const mark = path.join(dir, `v${a.version}.answer.hub`);
    const delivered = fs.existsSync(mark) && fs.readFileSync(mark, "utf8").trim() === String(a.mtimeMs) && fs.existsSync(md);
    const sameLocal = !delivered && fs.existsSync(md) && fs.existsSync(md.replace(/\.md$/, ".seen"))
      && fs.readFileSync(md, "utf8").replace(/^<!--.*?-->\n/, "").trim() === a.text.trim();
    if (sameLocal) fs.writeFileSync(mark, String(a.mtimeMs)); // 本文が同じで、ローカルでも受け取り済みなら、書き直さない (hook が渡し直さない)
    else if (!delivered) {
      const jsonFile = path.join(dir, `v${a.version}.answer.json`);
      if (a.json && typeof a.json === "object") fs.writeFileSync(jsonFile, `${JSON.stringify(a.json, null, 2)}\n`);
      else fs.rmSync(jsonFile, { force: true });
      fs.writeFileSync(md, `<!-- html-qa の回答 (${new Date().toISOString()} / ハブから受け取り) -->\n${a.text}\n`);
      fs.writeFileSync(mark, String(a.mtimeMs));
    }
    got.push({ topic: a.topic, version: a.version, mtimeMs: a.mtimeMs });
  }
  return got;
}
// ハブに「受け取った」印を付ける。全体で totalMs までしか待たない。失敗しても続ける (ローカルの印を正とする)
async function seenHub(cfg, items, totalMs = 2500) {
  const deadline = Date.now() + totalMs;
  await Promise.all(items.map(async (it) => {
    const left = deadline - Date.now();
    if (left <= 0) return;
    try { await api(cfg, "POST", "/api/seen", { body: { topic: it.topic, version: it.version, mtimeMs: it.mtimeMs }, timeoutMs: left }); } catch { /* 続ける */ }
  }));
}
async function beat(cfg, topic, done = false) {
  try { await api(cfg, "POST", "/api/waiting", { body: { topic, ...(done ? { done: true } : {}) }, timeoutMs: 2000 }); } catch { /* 合図は届かなくてもよい */ }
}

// ---- wait ----
async function cmdWait(dirArg, opts) {
  const { dir, topic, root } = topicOf(dirArg);
  const cfg = needConfig(root);
  const timeoutMin = opts["timeout-min"] !== undefined ? Number(opts["timeout-min"]) : 120;
  if (!Number.isFinite(timeoutMin) || timeoutMin < 0) throw new Stop(2, "--timeout-min は 0 以上の数にしてください (0 は時間切れなし)");
  const POLL = Number(process.env.HTML_QA_POLL_MS) || 2500;
  const waitingFile = path.join(dir, ".waiting.json");
  fs.writeFileSync(waitingFile, JSON.stringify({ pid: process.pid, since: new Date().toISOString() }));
  const clear = () => { try { if (JSON.parse(fs.readFileSync(waitingFile, "utf8")).pid === process.pid) fs.unlinkSync(waitingFile); } catch { /* もう無い */ } };
  out(`[html-qa] ハブ (${cfg.url}) 経由で待ちます: プロジェクト ${cfg.project} / 議題 ${topic}`);
  await beat(cfg, topic);
  const beatTimer = setInterval(() => beat(cfg, topic), 10_000);
  let finishing = false;
  const finish = async (code, msg, after) => {
    if (finishing) return code;
    finishing = true;
    clearInterval(beatTimer);
    clear();
    if (msg) out(msg);
    if (after) await after();
    await beat(cfg, topic, true);
    return code;
  };
  process.once("SIGINT", async () => process.exit(await finish(130)));
  process.once("SIGTERM", async () => process.exit(await finish(143)));
  const started = Date.now();
  let down = null;
  for (;;) {
    let pulled = [];
    try {
      pulled = await pullAnswers(root, cfg, topic);
      if (down) { down = null; warn("[html-qa] ハブにつながりました"); }
    } catch (e) {
      if (e instanceof Stop && (e.code === 4 || e.code === 7)) return finish(e.code, `[html-qa] ${e.message}`);
      const msg = e.message;
      if (down !== msg) { down = msg; warn(`△ [html-qa] ${msg}\n  (待ち受けは続けます。直れば受け取ります)`); }
    }
    const list = unreadAnswers([dir]);
    if (list.length) {
      const text = formatAnswers(list);
      list.forEach(markSeen);
      return finish(0, text, () => seenHub(cfg, pulled));
    }
    if (pulled.length) await seenHub(cfg, pulled); // ローカルで読み済みの回答: ハブにも印だけ付ける
    if (timeoutMin > 0 && Date.now() - started > timeoutMin * 60_000) {
      return finish(3, `[html-qa] ${timeoutMin} 分待ちましたが回答は届きませんでした (${rel(dir)})。あとで届いた回答は、利用者が次に発言したときに hook が渡します。`);
    }
    await new Promise((r) => setTimeout(r, POLL));
  }
}

// ---- hook ----
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const isWaitingLocal = (dir) => { try { return alive(JSON.parse(fs.readFileSync(path.join(dir, ".waiting.json"), "utf8")).pid); } catch { return false; } };
async function cmdHook() {
  try {
    const root = path.resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd(), DEFAULT_ROOT);
    const cfg = readConfig(root);
    let notice = null;
    noticeSink = (text, u) => { notice = { text, key: u.key || u.to }; };
    let pulled = [];
    if (cfg) { try { pulled = await pullAnswers(root, cfg, null, { timeoutMs: 2500 }); } catch { /* ハブに届かなくても発言は止めない */ } }
    const dirs = fs.existsSync(root) ? fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && NAME_RE.test(e.name)).map((e) => path.join(root, e.name)) : [];
    // wait が待っている議題はそちらに任せる (二重に渡さない)
    const list = unreadAnswers(dirs.filter((d) => !isWaitingLocal(d))).slice(-5);
    const parts = [];
    if (list.length) {
      parts.push(`${formatAnswers(list)}\n\n(この回答は、利用者が html-qa の画面の「AI に送る」で送ったもので、まだ AI が読んでいなかった分。hook が利用者の今の発言に添えた)`);
      list.forEach(markSeen);
    }
    // 更新の案内は、ハブの同じ版について 1 回だけ (毎回の発言には出さない)
    if (notice) {
      const mark = path.join(root, ".update-notice");
      let last = null;
      try { last = fs.readFileSync(mark, "utf8").trim(); } catch { /* まだ無い */ }
      if (last !== notice.key) { parts.push(notice.text); try { fs.mkdirSync(root, { recursive: true }); fs.writeFileSync(mark, notice.key); } catch { /* 印は書けなくてもよい */ } }
    }
    if (parts.length) await new Promise((r) => process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: parts.join("\n\n") } }), r));
    // ローカルで読み済みの回答の印をハブにも付ける。まだ読んでいない分 (wait 中の議題・6 件目以降) には付けない
    if (cfg) await seenHub(cfg, pulled.filter((p) => isSeenLocal(path.join(root, p.topic), p.version)));
  } catch { /* hook の失敗で利用者の発言を止めない */ }
  return 0;
}

// ---- status ----
async function cmdStatus(root) {
  const cfg = readConfig(root);
  out(`クライアント: v${VERSION} (apiVersion ${API_VERSION})`);
  if (!cfg) { out(`ハブ: まだ接続していません (node ${scriptRel()} pair)`); return 4; }
  const info = await hubInfo(cfg.url);
  out(`ハブ: ${cfg.url} 「${info.hubName}」 v${info.version} (apiVersion ${info.apiVersion})${cfg.hubId && cfg.hubId !== info.hubId ? " △ 前に接続したハブと別のハブです" : ""}`);
  out(`プロジェクト: ${cfg.project}`);
  const r = await api(cfg, "GET", "/api/topics");
  if (r.status !== 200) throw new Stop(6, `議題の一覧を読めませんでした: ${r.json?.error || r.status}`);
  if (r.json.urls?.[0]) out(`  一覧: ${r.json.urls[0]}`);
  if (!(r.json.topics || []).length) out("  議題はまだありません (publish すると、一覧に出ます)");
  for (const t of r.json.topics || []) {
    const last = t.versions[t.versions.length - 1];
    out(`  ${t.topic}: v${last?.version ?? "-"} ${last?.answered ? (last.seen ? "回答あり (受け取り済み)" : "回答あり (未受け取り)") : "回答待ち"}${t.waiting ? " · AI が待ち受け中" : ""}`);
  }
  return 0;
}


// ---- init / update (配り方。9.5) ----
const SELF = () => fs.realpathSync(fileURLToPath(import.meta.url));
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const DEFAULT_SKILL_DIR = path.join(".claude", "skills", "html-qa");

// ハブから配られるファイル (manifest の sha256 を確かめる)。{ "html-qa.mjs": Buffer, "SKILL.md": Buffer }
// update は apiVersion が違っても取り替える (版をそろえるための道なので)
async function fetchFromHub(url) {
  const m = await call(url, "GET", "/client/manifest.json");
  if (m.status !== 200 || !Array.isArray(m.json?.files)) throw new Stop(6, `ハブ (${url}) から配る物の一覧を読めませんでした`);
  const files = {};
  for (const f of m.json.files) {
    if (!["html-qa.mjs", "SKILL.md"].includes(f.path)) continue;
    let res;
    try { res = await fetch(`${url}/client/${f.path}`, { signal: AbortSignal.timeout(15_000), redirect: "error" }); } catch (e) { throw new Stop(6, `ハブに届きません (${e?.cause?.code || e?.name})\n  ハブ: ${url}`); }
    const buf = Buffer.from(await res.arrayBuffer());
    if (!res.ok || sha256(buf) !== f.sha256) throw new Stop(6, `${f.path} の中身が、ハブの一覧の sha256 と合いません (取り替えません)`);
    files[f.path] = buf;
  }
  if (!files["html-qa.mjs"] || !files["SKILL.md"]) throw new Stop(6, "ハブが html-qa.mjs と SKILL.md を配っていません");
  return { files, version: m.json.version };
}
const writeFileAtomic = (file, buf, mode) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, buf, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
};
// 手元 (このファイルの隣か、リポジトリの skill/) の SKILL.md
function localSkill() {
  const here = path.dirname(SELF());
  for (const f of [path.join(here, "SKILL.md"), path.join(here, "..", "skill", "SKILL.md")]) { try { return fs.readFileSync(f); } catch { /* 次へ */ } }
  return null;
}

async function cmdInit(root, opts) {
  const skillDir = path.resolve(opts["skill-dir"] ?? DEFAULT_SKILL_DIR);
  const { url, info } = await findHub(root, opts["hub-url"]);
  // ハブと版が違えば、ハブから取り直す (版をそろえる)。同じなら手元のものを置く
  let files;
  if (info.version !== VERSION || !localSkill()) {
    files = (await fetchFromHub(url)).files;
    out(`ハブ (v${info.version}) から、クライアントと手順書を取りました${info.version !== VERSION ? ` (このクライアントは v${VERSION})` : ""}`);
  } else files = { "html-qa.mjs": fs.readFileSync(SELF()), "SKILL.md": localSkill() };
  writeFileAtomic(path.join(skillDir, "html-qa.mjs"), files["html-qa.mjs"], 0o755);
  writeFileAtomic(path.join(skillDir, "SKILL.md"), files["SKILL.md"]);
  out(`✓ ${rel(path.join(skillDir, "SKILL.md"))} と ${rel(path.join(skillDir, "html-qa.mjs"))} を置きました (プロジェクトの git に入れてください)`);
  const cfg = readConfig(root);
  if (cfg && cfg.url === url && cfg.hubId === info.hubId && (!opts.project || opts.project === cfg.project)) {
    out(`このプロジェクトは、プロジェクト「${cfg.project}」として、ハブに接続済みです`);
    out(`  ハブ: ${url}`);
  } else {
    const code = await cmdPair(root, { ...opts, "hub-url": url, fromInit: true });
    if (code !== 0) return code;
  }
  const cmd = `node "$CLAUDE_PROJECT_DIR"/${path.relative(process.cwd(), skillDir).split(path.sep).join("/")}/html-qa.mjs hook`;
  out(addHook(process.cwd(), cmd));
  out(addGitignore(process.cwd()));
  out(`導入が終わりました。議題は .tmp/html-qa/<topic>/ に置き、node ${rel(path.join(skillDir, "html-qa.mjs"))} publish で送ります。置いたファイル (${rel(skillDir)}/・.claude/settings.json・.gitignore) を、プロジェクトの git に入れてください`);
  return 0;
}

// Claude Code の hook (UserPromptSubmit) を .claude/settings.json に足す。html-qa の hook があれば足さない。ほかの設定は残す。
// JSON が読めないときは書き換えず、足す内容を案内する
export function addHook(proj, cmd) {
  const file = path.join(proj, ".claude", "settings.json");
  const entry = { hooks: [{ type: "command", command: cmd }] };
  let cfg = {};
  if (fs.existsSync(file)) {
    try { cfg = JSON.parse(fs.readFileSync(file, "utf8")); } catch { cfg = null; }
    if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return `△ ${rel(file)} が JSON として読めないので、書き換えませんでした。hooks に次を足してください:\n${JSON.stringify({ UserPromptSubmit: [entry] })}`;
  }
  const hooks = cfg.hooks && typeof cfg.hooks === "object" && !Array.isArray(cfg.hooks) ? cfg.hooks : (cfg.hooks = {});
  const list = Array.isArray(hooks.UserPromptSubmit) ? hooks.UserPromptSubmit : (hooks.UserPromptSubmit = []);
  if (JSON.stringify(list).includes("html-qa.mjs hook")) return `✓ hook は ${rel(file)} に登録済みです`;
  list.push(entry);
  writeFileAtomic(file, `${JSON.stringify(cfg, null, 2)}\n`);
  return `✓ 回答を発言に添える hook を ${rel(file)} に登録しました (セッションを開き直すと効きます)`;
}

// .gitignore に .tmp/ を足す (トークン入りの .tmp/html-qa/.hub.json を git に入れない)
export function addGitignore(proj) {
  const file = path.join(proj, ".gitignore");
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch { /* まだ無い */ }
  if (text.split(/\r?\n/).some((l) => /^\/?\.tmp(\/(\*\*?)?)?$/.test(l.trim()))) return "✓ .gitignore に .tmp/ はあります";
  fs.writeFileSync(file, `${text}${text && !text.endsWith("\n") ? "\n" : ""}.tmp/\n`);
  return "✓ .gitignore に .tmp/ を足しました (トークンを git に入れないため)";
}

async function cmdUpdate(root, opts) {
  const cfg = readConfig(root);
  const url = opts["hub-url"] ? normUrl(opts["hub-url"]) : cfg?.url;
  if (!url) throw new Stop(4, "ハブの URL が分かりません。--hub-url を付けるか、先に pair してください");
  const { files, version } = await fetchFromHub(url);
  const dir = path.dirname(SELF());
  const changed = [];
  for (const [name, buf] of Object.entries(files)) {
    const file = path.join(dir, name);
    let cur = null;
    try { cur = fs.readFileSync(file); } catch { /* 無い */ }
    if (cur && sha256(cur) === sha256(buf)) continue;
    writeFileAtomic(file, buf, name.endsWith(".mjs") ? 0o755 : undefined);
    changed.push(name);
  }
  out(changed.length ? `✓ ハブの v${version} に取り替えました: ${changed.map((n) => rel(path.join(dir, n))).join(" / ")}\n  取り替わったファイルを、プロジェクトの git に入れてください (利用者に伝える)` : `✓ ハブの v${version} と同じです (取り替えるものはありません)`);
  return 0;
}

// ---- 引数 ----
function parseArgs(argv) {
  const opts = {};
  const rest = [];
  const withValue = new Set(["hub-url", "project", "timeout-min", "skill-dir"]);
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2);
      if (withValue.has(k)) {
        const v = argv[i + 1];
        if (v === undefined || v.startsWith("--")) throw new Stop(2, `--${k} には値を指定してください`);
        opts[k] = v; i++;
      } else opts[k] = true;
    } else rest.push(a);
  }
  return { opts, rest };
}

const USAGE = `使い方: node html-qa.mjs <コマンド>
  init    [--hub-url URL] [--project 名] [--skill-dir DIR]   手順書とクライアントを置き、ハブに接続する
  pair    [--hub-url URL] [--project 名]   ハブに接続する (ハブの画面で承認)
  publish <議題フォルダ>                    議題をハブへ送る
  check   <議題フォルダ>                    検査だけ
  wait    <議題フォルダ> [--timeout-min 120] 回答を待つ
  hook                                      Claude Code の hook (未読の回答を添える)
  status                                    ハブと議題の状態
  update                                    ハブの版に取り替える`;

export async function main(argv = process.argv.slice(2)) {
  const [cmd, ...more] = argv;
  try {
    if (cmd === "hook") return await cmdHook();
    const { opts, rest } = parseArgs(more);
    const root = path.resolve(DEFAULT_ROOT);
    switch (cmd) {
      case "init": return await cmdInit(root, opts);
      case "pair": return await cmdPair(root, opts);
      case "update": return await cmdUpdate(root, opts);
      case "publish": return await cmdPublish(rest[0]);
      case "check": return await cmdPublish(rest[0], { checkOnly: true });
      case "wait": return await cmdWait(rest[0], opts);
      case "status": return await cmdStatus(root);
      case "--version": case "version": out(`${VERSION} (apiVersion ${API_VERSION})`); return 0;
      case undefined: case "-h": case "--help": case "help": out(USAGE); return cmd ? 0 : 2;
      default: warn(`知らないコマンドです: ${cmd}\n${USAGE}`); return 2;
    }
  } catch (e) {
    if (e instanceof Stop) { warn(`✗ ${e.message}`); return e.code; }
    warn(`✗ 想定外の失敗: ${e?.message || e}`);
    return 1;
  }
}

// 直接動かしたとき (npx の bin のリンク経由でも) だけ main を動かす。試験で import したときは動かさない
const invoked = (() => { try { return fs.realpathSync(process.argv[1]) === SELF(); } catch { return false; } })();
if (invoked) {
  main().then((code) => process.exit(code));
}
