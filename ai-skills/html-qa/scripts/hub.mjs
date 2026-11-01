// html-qa ハブの保存と検証 (serve.mjs が使う)。
//   <root>/.hub/<project>/<topic>/vN.html / vN.json / index.html (最新版の写し) / vN.answer.md / vN.answer.json / vN.answer.seen
// project / topic / version は必ずここで検証してからパスを組み立てる (保存先は <root>/.hub の下に限る)。
import fs from "node:fs";
import path from "node:path";
import { HUB_NAME_RE, HUB_RESERVED } from "./lib.mjs";
import { validate } from "./validate-doc.mjs";

export class HubError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const LIMITS = {
  body: 16 * 1024 * 1024, // 1 版 (html + json) の大きさ
  projects: 50,
  topicsPerProject: 200,
  versionsPerTopic: 300,
  maxVersion: 9999,
  json: 4 * 1024 * 1024,
  total: 1024 * 1024 * 1024, // ハブ全体 (.hub 以下) の合計。環境変数 HTML_QA_HUB_MAX_BYTES で変えられる (試験用)
};
const totalLimit = () => { const n = Number(process.env.HTML_QA_HUB_MAX_BYTES); return Number.isFinite(n) && n > 0 ? n : LIMITS.total; };
const WAIT_TTL_MS = 30_000;

export const hubBase = (root) => path.join(root, ".hub");
const within = (base, target) => target === base || target.startsWith(base + path.sep);

export function checkNames(project, topic) {
  if (typeof project !== "string" || !HUB_NAME_RE.test(project) || HUB_RESERVED.has(project)) throw new HubError(400, "project が不正です (英小文字・数字・ハイフンで 41 文字まで)");
  if (typeof topic !== "string" || !HUB_NAME_RE.test(topic)) throw new HubError(400, "topic が不正です (英小文字・数字・ハイフンで 41 文字まで)");
}
export const checkVersion = (v) => {
  if (!Number.isInteger(v) || v < 1 || v > LIMITS.maxVersion) throw new HubError(400, `version は 1〜${LIMITS.maxVersion} の整数にしてください`);
};

const subdirs = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && HUB_NAME_RE.test(e.name)).map((e) => e.name) : []);
export const hubProjects = (root) => subdirs(hubBase(root)).filter((n) => !HUB_RESERVED.has(n));
export const hubTopics = (root, project) => subdirs(path.join(hubBase(root), project));
// 通常のファイルか (リンクは false。外のファイルを指しうる)
export const isRegularFile = (f) => { try { return fs.lstatSync(f).isFile(); } catch { return false; } };
const isRealDir = (f) => { try { return fs.lstatSync(f).isDirectory(); } catch { return false; } };
export const hasHubProject = (root, project) => HUB_NAME_RE.test(project) && !HUB_RESERVED.has(project) && isRealDir(path.join(hubBase(root), project));

// 検証済みの名前から議題フォルダのパスを返す。create なら上限を確かめて作る。realpath でも .hub の下であることを確かめる
export function hubTopicDir(root, project, topic, { create = false } = {}) {
  checkNames(project, topic);
  const base = path.resolve(hubBase(root));
  const dir = path.resolve(base, project, topic);
  if (!within(base, dir) || dir === base) throw new HubError(400, "保存先が範囲外です");
  // 作る前に、いちばん近い既存の親を realpath で確かめる (.hub の中のリンクをたどって外にフォルダを作らせない)
  const realBaseOf = () => { fs.mkdirSync(base, { recursive: true }); return fs.realpathSync(base); };
  const nearestExisting = () => { let d = dir; while (!fs.existsSync(d)) d = path.dirname(d); return d; };
  if (!fs.existsSync(dir)) {
    if (!create) return null;
    const realBase = realBaseOf(); // .hub は先に作る (近い既存の親が .hub より上にならないように)
    if (!within(realBase, fs.realpathSync(nearestExisting()))) throw new HubError(403, "保存先が範囲外です");
    const pdir = path.join(base, project);
    if (!fs.existsSync(pdir) && hubProjects(root).length >= LIMITS.projects) throw new HubError(429, `プロジェクトは ${LIMITS.projects} 個までです`);
    if (subdirs(pdir).length >= LIMITS.topicsPerProject) throw new HubError(429, `1 プロジェクトの議題は ${LIMITS.topicsPerProject} 個までです`);
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!within(realBaseOf(), fs.realpathSync(dir))) throw new HubError(403, "保存先が範囲外です");
  return dir;
}

export const hubVersions = (dir) => {
  const set = new Set();
  for (const f of fs.readdirSync(dir)) { const m = f.match(/^v(\d+)\.(html|json)$/); if (m) set.add(Number(m[1])); }
  return [...set].sort((a, b) => a - b);
};
export const latestHtml = (dir) => {
  if (!dir || !fs.existsSync(dir)) return 0;
  return Math.max(0, ...fs.readdirSync(dir).map((f) => f.match(/^v(\d+)\.html$/)).filter(Boolean).map((m) => Number(m[1])));
};

const writeAtomic = (file, data) => {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
};

// 入れ子の深さが max を超えるか。再帰せず、深さを数える途中で打ち切る (10 万段の入れ子でスタックを使い切らないため)
export function nestingTooDeep(v, max = 100) {
  const stack = [[v, 1]];
  while (stack.length) {
    const [x, d] = stack.pop();
    if (x && typeof x === "object") {
      if (d > max) return true;
      for (const k of Object.keys(x)) stack.push([x[k], d + 1]);
    }
  }
  return false;
}
const sizeOf = (f) => { try { const st = fs.lstatSync(f); return st.isFile() ? st.size : 0; } catch { return 0; } };

// ハブ全体の使用量 (.hub 以下の合計)。数えるのは高くつくので 5 秒だけ覚え、預かった分の増減は足していく
const usageCache = { at: 0, bytes: 0 };
function hubUsage(root) {
  if (Date.now() - usageCache.at < 5_000) return usageCache.bytes;
  let total = 0;
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, e.name);
      if (e.isDirectory()) walk(f);
      else if (e.isFile()) { try { total += fs.statSync(f).size; } catch { /* 消えた */ } }
    }
  };
  if (fs.existsSync(hubBase(root))) walk(hubBase(root));
  usageCache.at = Date.now(); usageCache.bytes = total;
  return total;
}

// POST /api/publish の本体。保存して、{ project, topic, version, path } を返す
export function savePublish(root, body) {
  const { project, topic, version, html, json } = body && typeof body === "object" ? body : {};
  checkNames(project, topic);
  checkVersion(version);
  if (typeof html !== "string" || !html.trim()) throw new HubError(400, "html が必要です");
  let jsonText = null;
  if (json !== undefined && json !== null) {
    if (typeof json !== "object" || Array.isArray(json)) throw new HubError(400, "json はオブジェクトにしてください");
    if (json.topic !== topic || json.version !== version) throw new HubError(400, "json の topic / version が、送り先の topic / version と一致しません");
    let deep;
    try { deep = nestingTooDeep(json); } catch { deep = true; }
    if (deep) throw new HubError(400, "json の入れ子が深すぎます (100 段まで)");
    // 形式は build.mjs と同じ検査 (壊れた議題を預かると、一覧などが読めなくなるため)
    let errs;
    try { errs = validate(json, path.join(path.sep, topic, `v${version}.json`)).errs; } catch { throw new HubError(400, "json の形が読み取れません"); }
    if (errs.length) throw new HubError(400, `json の形が不正です: ${errs.slice(0, 3).join(" / ")}${errs.length > 3 ? ` ほか ${errs.length - 3} 件` : ""}`);
    jsonText = `${JSON.stringify(json, null, 2)}\n`;
    if (Buffer.byteLength(jsonText) > LIMITS.json) throw new HubError(413, "json が大きすぎます");
  }
  const existing = hubTopicDir(root, project, topic); // まだ無ければ null (ここでは作らない)
  const vs = existing ? hubVersions(existing) : [];
  if (!vs.includes(version) && vs.length >= LIMITS.versionsPerTopic) throw new HubError(429, `1 議題の版は ${LIMITS.versionsPerTopic} までです`);
  const latestBefore = vs.length ? vs[vs.length - 1] : 0;
  const writesIndex = version >= latestBefore; // 最新版なら index.html の写しも書き換わる
  // 容量: 増える分 = 新しく書く分 (版 + json + 写し) - 置き換わる古い分
  const incoming = Buffer.byteLength(html) * (writesIndex ? 2 : 1) + (jsonText ? Buffer.byteLength(jsonText) : 0);
  const replaced = existing ? sizeOf(path.join(existing, `v${version}.html`)) + (jsonText ? sizeOf(path.join(existing, `v${version}.json`)) : 0) + (writesIndex ? sizeOf(path.join(existing, "index.html")) : 0) : 0;
  const delta = incoming - replaced;
  if (delta > 0 && hubUsage(root) + delta > totalLimit()) throw new HubError(507, `ハブの容量の上限 (${Math.floor(totalLimit() / 1048576)}MB) を超えます。古い議題を .tmp/html-qa/.hub から消してください`);
  const dir = existing ?? hubTopicDir(root, project, topic, { create: true });
  writeAtomic(path.join(dir, `v${version}.html`), html);
  if (jsonText) writeAtomic(path.join(dir, `v${version}.json`), jsonText);
  if (writesIndex) writeAtomic(path.join(dir, "index.html"), html);
  usageCache.bytes = Math.max(0, usageCache.bytes + delta);
  return { project, topic, version, path: `/${project}/${topic}/` };
}

// 回答の保存 (ハブ配下・従来のどちらも使う)。.json を先に書き、.md が届いた時点で揃っているようにする
export function writeAnswerFiles(dir, topic, version, text, answers) {
  const jsonFile = path.join(dir, `v${version}.answer.json`);
  // 書き先がリンクなら、たどらずに外す (リンク先の外のファイルを書き換えない)
  for (const f of [jsonFile, path.join(dir, `v${version}.answer.md`)]) { try { if (fs.lstatSync(f).isSymbolicLink()) fs.unlinkSync(f); } catch { /* 無い */ } }
  let tooDeep = false;
  try { tooDeep = nestingTooDeep(answers); } catch { tooDeep = true; }
  if (!tooDeep && answers && typeof answers === "object" && !Array.isArray(answers) && answers.topic === topic && answers.version === version) {
    try { fs.writeFileSync(jsonFile, `${JSON.stringify(answers, null, 2)}\n`); } catch (err) { console.error(`vN.answer.json を書けませんでした: ${err.message}`); }
  } else fs.rmSync(jsonFile, { force: true }); // 古い画面からの送信: 前の構造化回答を残さない
  const file = path.join(dir, `v${version}.answer.md`);
  fs.writeFileSync(file, `<!-- html-qa の回答 (${new Date().toISOString()}) -->\n${text.replace(/\r\n?/g, "\n")}\n`);
  return file;
}

const readJsonSafe = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

// GET /api/answer 用。version を省くと全版。unread なら AI が受け取っていないものだけ
export function listHubAnswers(dir, { version = null, unread = false } = {}) {
  const out = [];
  for (const f of fs.readdirSync(dir)) {
    const m = f.match(/^v(\d+)\.answer\.md$/);
    if (!m) continue;
    const v = Number(m[1]);
    if (version !== null && v !== version) continue;
    const file = path.join(dir, f);
    if (!isRegularFile(file)) continue; // リンクは読まない
    const mtimeMs = Math.floor(fs.statSync(file).mtimeMs);
    const seenFile = file.replace(/\.md$/, ".seen");
    const seenAt = fs.existsSync(seenFile) ? Number(fs.readFileSync(seenFile, "utf8").trim()) || 0 : 0;
    const seen = seenAt >= mtimeMs;
    if (unread && seen) continue;
    out.push({ version: v, mtimeMs, seen, text: fs.readFileSync(file, "utf8").replace(/^<!--.*?-->\n/, ""), json: isRegularFile(path.join(dir, `v${v}.answer.json`)) ? readJsonSafe(path.join(dir, `v${v}.answer.json`)) : null });
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

// POST /api/seen: 受け取った印。受け取った時点の mtimeMs を書く (その後に回答が送り直されていれば、また未読になる)
export function markHubSeen(dir, version, mtimeMs) {
  const file = path.join(dir, `v${version}.answer.md`);
  if (!fs.existsSync(file)) throw new HubError(404, "その回答はありません");
  if (!Number.isFinite(mtimeMs)) throw new HubError(400, "mtimeMs が不正です");
  const cur = Math.floor(fs.statSync(file).mtimeMs);
  fs.writeFileSync(file.replace(/\.md$/, ".seen"), String(Math.min(Math.floor(mtimeMs), cur)));
}

// AI が待ち受け中かの合図 (wait.mjs が数秒おきに送る。メモリだけで持つ。ハブを起動し直しても、次の合図で戻る)
const beats = new Map();
const beatKey = (project, topic) => `${project}/${topic}`;
export function setHubWaiting(project, topic, on) {
  const now = Date.now();
  for (const [k, t] of beats) if (now - t > WAIT_TTL_MS) beats.delete(k);
  if (on && beats.size < 2000) beats.set(beatKey(project, topic), now);
  else beats.delete(beatKey(project, topic));
}
export const isHubWaiting = (project, topic) => Date.now() - (beats.get(beatKey(project, topic)) ?? 0) <= WAIT_TTL_MS;
