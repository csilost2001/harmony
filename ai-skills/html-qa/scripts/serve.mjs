#!/usr/bin/env node
// html-qa: 議題フォルダ (既定 .tmp/html-qa/) をブラウザで開くための小さなサーバ。
//
//   node ai-skills/html-qa/scripts/serve.mjs [--port 5190] [--lan-url http://<PC の IP>:5191 | off] [--new-key]
//
// - 静的ファイルを返す (キャッシュしない。F5 で最新が見える)
// - POST /api/answer: 画面の「AI に送る」で <topic>/vN.answer.md を書く。AI はそれを読む
// - GET /api/latest?topic=: 最新の版 (画面が新しい版の通知に使う)
// - GET /api/status?topic=&version=: 回答が届いたか・AI が読んだか・AI が待ち受け中か
//
// 守り:
// - 鍵 (.tmp/html-qa/.key) が無い接続は断る。URL の ?key= で一度開くと cookie で持ち続ける。
//   VS Code・Windows のポート転送を通ると送信元はみな localhost に見えるため、送信元では見分けず、鍵で見分ける
// - 書き込めるのは既存の議題フォルダの vN.answer.md だけ。外部サイトからの書き込みは Origin で断る
// - 「.」で始まるファイル (鍵・待ち受けの印) は返さない
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { TOPIC_RE, DEFAULT_ROOT, answerStatus, isWaiting, accessKey, keyMatches, setLanBase, pageUrls } from "./lib.mjs";

const arg = (name, d) => { const i = process.argv.indexOf(`--${name}`); return i > 0 ? process.argv[i + 1] : d; };
const ROOT = path.resolve(arg("root", DEFAULT_ROOT));
const PORT = Number(arg("port", process.env.HTML_QA_PORT || 5190));
const HOST = arg("host", "127.0.0.1");
const MAX_BODY = 512 * 1024;
const COOKIE = "html_qa_key";
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

process.env.HTML_QA_PORT = String(PORT);
fs.mkdirSync(ROOT, { recursive: true });
const KEY = accessKey(ROOT, { renew: process.argv.includes("--new-key") });
if (process.argv.includes("--lan-url")) {
  try { const b = setLanBase(ROOT, arg("lan-url")); console.log(b ? `スマホから開く URL の元を ${b} にしました` : "スマホから開く URL を消しました"); }
  catch (e) { console.error(`--lan-url: ${e.message}`); process.exit(2); }
}

const send = (res, code, body, type = "application/json; charset=utf-8", extra = {}) => {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", ...extra });
  res.end(typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body));
};
const latestOf = (topic) => {
  const dir = path.join(ROOT, topic);
  if (!fs.existsSync(dir)) return 0;
  return Math.max(0, ...fs.readdirSync(dir).map((f) => f.match(/^v(\d+)\.html$/)).filter(Boolean).map((m) => Number(m[1])));
};
const sameOrigin = (req) => {
  const o = req.headers.origin;
  if (!o) return true;
  try { return new URL(o).host === req.headers.host; } catch { return false; }
};
const cookieKey = (req) => {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === COOKIE) return v.join("=");
  }
  return null;
};
const DENIED = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>html-qa</title>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.7">
<h1 style="font-size:18px">鍵が必要です</h1><p>AI がチャットに示した URL (<code>?key=…</code> つき) から開いてください。一度開けば、このブラウザでは鍵なしで開けます。</p></body></html>`;

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  const qkey = url.searchParams.get("key");
  if (qkey != null) {
    if (!keyMatches(qkey, KEY)) return send(res, 401, DENIED, "text/html; charset=utf-8");
    url.searchParams.delete("key");
    const rest = url.searchParams.toString();
    return send(res, 302, "", "text/plain", {
      Location: url.pathname + (rest ? `?${rest}` : ""),
      "Set-Cookie": `${COOKIE}=${KEY}; Path=/; Max-Age=${60 * 60 * 24 * 30}; HttpOnly; SameSite=Lax`,
    });
  }
  if (!keyMatches(cookieKey(req), KEY)) {
    return url.pathname.startsWith("/api/") ? send(res, 401, { error: "鍵がありません" }) : send(res, 401, DENIED, "text/html; charset=utf-8");
  }

  if (url.pathname === "/api/ping") return send(res, 200, { ok: true });
  if (url.pathname === "/api/latest") {
    const topic = url.searchParams.get("topic") || "";
    if (!TOPIC_RE.test(topic)) return send(res, 400, { error: "topic が不正です" });
    const v = latestOf(topic);
    return send(res, 200, { version: v, file: v ? `v${v}.html` : null });
  }
  if (url.pathname === "/api/status") {
    const topic = url.searchParams.get("topic") || "";
    const version = Number(url.searchParams.get("version"));
    if (!TOPIC_RE.test(topic) || !Number.isInteger(version) || version < 1) return send(res, 400, { error: "topic / version が不正です" });
    const dir = path.join(ROOT, topic);
    if (!fs.existsSync(dir)) return send(res, 404, { error: "その議題はありません" });
    return send(res, 200, { ...answerStatus(dir, version), waiting: isWaiting(dir) });
  }
  if (url.pathname === "/api/answer") {
    if (req.method !== "POST") return send(res, 405, { error: "POST だけ受け付けます" });
    if (!sameOrigin(req)) return send(res, 403, { error: "別のサイトからは保存できません" });
    if (!String(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, { error: "JSON で送ってください" });
    let size = 0; const chunks = [];
    req.on("data", (c) => { size += c.length; if (size > MAX_BODY) { send(res, 413, { error: "大きすぎます" }); req.destroy(); } else chunks.push(c); });
    req.on("end", () => {
      if (res.writableEnded) return;
      let body;
      try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 400, { error: "JSON が読めません" }); }
      const { topic, version, text } = body || {};
      if (!TOPIC_RE.test(topic || "") || !Number.isInteger(version) || version < 1 || typeof text !== "string" || !text.trim()) return send(res, 400, { error: "topic / version / text が不正です" });
      const dir = path.join(ROOT, topic);
      if (!fs.existsSync(path.join(dir, `v${version}.json`))) return send(res, 404, { error: "その議題・版はありません" });
      const file = path.join(dir, `v${version}.answer.md`);
      fs.writeFileSync(file, `<!-- html-qa の回答 (${new Date().toISOString()}) -->\n${text.replace(/\r\n?/g, "\n")}\n`);
      const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
      console.log(`回答を保存: ${rel}`);
      return send(res, 200, { ok: true, path: rel });
    });
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "GET だけ受け付けます" });
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: "URL が不正です" }); }
  if (rel.split("/").some((seg) => seg.startsWith("."))) return send(res, 404, "見つかりません", "text/plain; charset=utf-8");
  let file = path.resolve(ROOT, "." + rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, { error: "範囲外です" });
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!rel.endsWith("/")) { res.writeHead(302, { Location: url.pathname + "/" }); return res.end(); }
    file = path.join(file, "index.html");
  }
  if (!fs.existsSync(file)) return send(res, 404, "見つかりません (build.mjs を実行しましたか?)", "text/plain; charset=utf-8");
  return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
});

server.listen(PORT, HOST, () => {
  const u = pageUrls(ROOT);
  console.log(`html-qa: ${u.local}`);
  if (u.lan) console.log(`スマホ (家庭内 LAN): ${u.lan}`);
  console.log(`フォルダ: ${path.relative(process.cwd(), ROOT) || "."} / 止めるときは Ctrl+C`);
});
server.on("error", (err) => {
  console.error(err.code === "EADDRINUSE" ? `ポート ${PORT} は使用中です。--port で変えてください` : err.message);
  process.exit(1);
});
