// html-qa: 回答ファイルの「届いた / AI が読んだ / AI が待っている」を扱う共通処理。
//   <topic>/vN.answer.md    画面の「AI に送る」で書かれる回答
//   <topic>/vN.answer.seen  AI が読んだ印 (読んだときの回答ファイルの更新時刻)
//   <topic>/.waiting.json   AI が待ち受け中 (wait.mjs の pid)
//   .key / .lan.json        表示サーバの鍵 / スマホから開く URL の元 (議題フォルダの親に置く)
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export const TOPIC_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const DEFAULT_ROOT = ".tmp/html-qa";
const MAX_TEXT = 200_000;

const answerRe = /^v(\d+)\.answer\.md$/;

export function topicDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isDirectory() && TOPIC_RE.test(e.name)).map((e) => path.join(root, e.name));
}

// まだ AI が読んでいない回答 (古い順)
export function unreadAnswers(dirs) {
  const out = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(answerRe);
      if (!m) continue;
      const file = path.join(dir, f);
      const mtimeMs = Math.floor(fs.statSync(file).mtimeMs);
      const seenFile = file.replace(/\.md$/, ".seen");
      const seen = fs.existsSync(seenFile) ? Number(fs.readFileSync(seenFile, "utf8").trim()) : 0;
      if (mtimeMs > seen) out.push({ topic: path.basename(dir), version: Number(m[1]), file, seenFile, mtimeMs });
    }
  }
  return out.sort((a, b) => a.mtimeMs - b.mtimeMs);
}

export function readAnswer(a) {
  const text = fs.readFileSync(a.file, "utf8").replace(/^<!--.*?-->\n/, "");
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}\n…(長すぎるため以降を省略。全文は ${rel(a.file)})` : text;
}

export function markSeen(a) {
  fs.writeFileSync(a.seenFile, String(a.mtimeMs));
}

export function answerStatus(dir, version) {
  const file = path.join(dir, `v${version}.answer.md`);
  if (!fs.existsSync(file)) return { answered: false, seen: false };
  const mtimeMs = Math.floor(fs.statSync(file).mtimeMs);
  const seenFile = file.replace(/\.md$/, ".seen");
  const seen = fs.existsSync(seenFile) && Number(fs.readFileSync(seenFile, "utf8").trim()) >= mtimeMs;
  return { answered: true, seen };
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };

export function isWaiting(dir) {
  const f = path.join(dir, ".waiting.json");
  if (!fs.existsSync(f)) return false;
  try { return alive(JSON.parse(fs.readFileSync(f, "utf8")).pid); } catch { return false; }
}

export function setWaiting(dir) {
  const f = path.join(dir, ".waiting.json");
  fs.writeFileSync(f, JSON.stringify({ pid: process.pid, since: new Date().toISOString() }));
  return () => { try { if (JSON.parse(fs.readFileSync(f, "utf8")).pid === process.pid) fs.unlinkSync(f); } catch { /* もう無い */ } };
}

export const rel = (f) => path.relative(process.cwd(), f).split(path.sep).join("/");

export function formatAnswers(list) {
  return list.map((a) => `[html-qa] 回答が届きました: ${rel(a.file)} (topic: ${a.topic} / v${a.version})\n\n${readAnswer(a).trim()}`).join("\n\n---\n\n");
}

// 表示サーバの鍵。URL の ?key= で一度渡すと、ブラウザは cookie で持ち続ける。再起動しても同じ鍵
export function accessKey(root, { renew = false } = {}) {
  const f = path.join(root, ".key");
  if (!renew && fs.existsSync(f)) {
    const k = fs.readFileSync(f, "utf8").trim();
    if (k.length >= 32) return k;
  }
  fs.mkdirSync(root, { recursive: true });
  const k = crypto.randomBytes(24).toString("base64url");
  fs.writeFileSync(f, k, { mode: 0o600 });
  return k;
}

export const keyMatches = (given, key) => {
  if (typeof given !== "string" || given.length !== key.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key));
};

// スマホ (家庭内 LAN) から開くときの URL の元。例: http://192.168.1.10:5191
export function lanBase(root) {
  try { return JSON.parse(fs.readFileSync(path.join(root, ".lan.json"), "utf8")).url || null; } catch { return null; }
}

export function setLanBase(root, url) {
  const f = path.join(root, ".lan.json");
  if (!url || url === "off") { fs.rmSync(f, { force: true }); return null; }
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol)) throw new Error("http:// か https:// で始まる URL にしてください");
  const base = `${u.protocol}//${u.host}`;
  fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(f, JSON.stringify({ url: base }));
  return base;
}

// 議題を開く URL (鍵つき)。topic を省くと議題の一覧
export function pageUrls(root, topic = "") {
  const key = accessKey(root);
  const port = process.env.HTML_QA_PORT || 5190;
  const p = topic ? `/${topic}/` : "/";
  const lan = lanBase(root);
  return { local: `http://localhost:${port}${p}?key=${key}`, lan: lan ? `${lan}${p}?key=${key}` : null };
}
