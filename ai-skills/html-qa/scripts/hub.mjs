// html-qa ハブの保存と検証 (serve.mjs が使う)。
//   <root>/.hub/<project>/<topic>/vN.html / vN.json / index.html (最新版の写し) / vN.answer.md / vN.answer.json / vN.answer.seen
// project / topic / version は必ずここで検証してからパスを組み立てる (保存先は <root>/.hub の下に限る)。
import fs from "node:fs";
import path from "node:path";
import { HUB_NAME_RE, HUB_RESERVED } from "./lib.mjs";

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
};
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
export const hasHubProject = (root, project) => HUB_NAME_RE.test(project) && !HUB_RESERVED.has(project) && fs.existsSync(path.join(hubBase(root), project));

// 検証済みの名前から議題フォルダのパスを返す。create なら上限を確かめて作る。realpath でも .hub の下であることを確かめる
export function hubTopicDir(root, project, topic, { create = false } = {}) {
  checkNames(project, topic);
  const base = path.resolve(hubBase(root));
  const dir = path.resolve(base, project, topic);
  if (!within(base, dir) || dir === base) throw new HubError(400, "保存先が範囲外です");
  if (!fs.existsSync(dir)) {
    if (!create) return null;
    const pdir = path.join(base, project);
    if (!fs.existsSync(pdir) && hubProjects(root).length >= LIMITS.projects) throw new HubError(429, `プロジェクトは ${LIMITS.projects} 個までです`);
    if (subdirs(pdir).length >= LIMITS.topicsPerProject) throw new HubError(429, `1 プロジェクトの議題は ${LIMITS.topicsPerProject} 個までです`);
    fs.mkdirSync(dir, { recursive: true });
  }
  const realBase = fs.realpathSync(base);
  if (!within(realBase, fs.realpathSync(dir))) throw new HubError(400, "保存先が範囲外です");
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
    jsonText = `${JSON.stringify(json, null, 2)}\n`;
    if (Buffer.byteLength(jsonText) > LIMITS.json) throw new HubError(413, "json が大きすぎます");
  }
  const dir = hubTopicDir(root, project, topic, { create: true });
  const vs = hubVersions(dir);
  if (!vs.includes(version) && vs.length >= LIMITS.versionsPerTopic) throw new HubError(429, `1 議題の版は ${LIMITS.versionsPerTopic} までです`);
  const latestBefore = vs.length ? vs[vs.length - 1] : 0;
  writeAtomic(path.join(dir, `v${version}.html`), html);
  if (jsonText) writeAtomic(path.join(dir, `v${version}.json`), jsonText);
  if (version >= latestBefore) writeAtomic(path.join(dir, "index.html"), html);
  return { project, topic, version, path: `/${project}/${topic}/` };
}

// 回答の保存 (ハブ配下・従来のどちらも使う)。.json を先に書き、.md が届いた時点で揃っているようにする
export function writeAnswerFiles(dir, topic, version, text, answers) {
  const jsonFile = path.join(dir, `v${version}.answer.json`);
  if (answers && typeof answers === "object" && !Array.isArray(answers) && answers.topic === topic && answers.version === version) {
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
    const mtimeMs = Math.floor(fs.statSync(file).mtimeMs);
    const seenFile = file.replace(/\.md$/, ".seen");
    const seenAt = fs.existsSync(seenFile) ? Number(fs.readFileSync(seenFile, "utf8").trim()) || 0 : 0;
    const seen = seenAt >= mtimeMs;
    if (unread && seen) continue;
    out.push({ version: v, mtimeMs, seen, text: fs.readFileSync(file, "utf8").replace(/^<!--.*?-->\n/, ""), json: readJsonSafe(path.join(dir, `v${v}.answer.json`)) });
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
