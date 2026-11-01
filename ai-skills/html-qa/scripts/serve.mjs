#!/usr/bin/env node
// html-qa: 議題フォルダ (既定 .tmp/html-qa/) をブラウザで開くための小さなサーバ。
//
//   node ai-skills/html-qa/scripts/serve.mjs [--port 5190] [--host 127.0.0.1] [--lan-url http://<PC の IP>:5191 | off] [--new-key]
//
// - 静的ファイルを返す (キャッシュしない。F5 で最新が見える)
// - POST /api/answer: 画面の「AI に送る」で <topic>/vN.answer.md (と、あれば構造化した vN.answer.json) を書く。AI はそれを読む。議題一覧も作り直す
// - GET /api/latest?topic=: 最新の版 (画面が新しい版の通知に使う)
// - GET /api/status?topic=&version=: 回答が届いたか・AI が読んだか・AI が待ち受け中か
//
// ハブ (複数のプロジェクトの議題をこの 1 つのサーバに預かる。#1590):
// - POST /api/publish   { project, topic, version, html, json? } を .hub/<project>/<topic>/vN.html に保存 (ヘッダの鍵が必須)
// - GET  /<project>/<topic>/…   預かった議題を配る。/ は全プロジェクトの一覧、/<project>/ はそのプロジェクトの一覧
// - POST /api/answer   に project を足すと、ハブの議題への回答になる (画面の「AI に送る」)
// - GET  /api/answer?project=&topic=[&version=][&unread=1]   回答を取り出す (wait.mjs のポーリング用。未回答なら 204)
// - POST /api/seen / POST /api/waiting   受け取った印 / AI が待ち受け中の合図 (wait.mjs が送る)
// - /api/latest と /api/status も project を足せる
//
// 守り:
// - 鍵 (.tmp/html-qa/.key) が無い接続は断る。URL の ?key= で一度開くと cookie で持ち続ける。スクリプトはヘッダ X-Html-Qa-Key で渡す。
//   VS Code・Windows のポート転送を通ると送信元はみな localhost に見えるため、送信元では見分けず、鍵で見分ける
// - 書き込めるのは既存の議題フォルダの vN.answer.md / vN.answer.json だけ (ハブへの publish / waiting / seen は、ヘッダの鍵がある接続だけ。cookie では書けない)。外部サイトからの書き込みは Origin で断る
// - 「.」で始まるファイル (鍵・待ち受けの印) は返さない
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { buildIndex, collectRows, renderIndex } from "./index-page.mjs";
import { TOPIC_RE, DEFAULT_ROOT, answerStatus, isWaiting, accessKey, keyMatches, setLanBase, pageUrls, lanBase } from "./lib.mjs";
import { HubError, LIMITS, isRegularFile, hubBase, hubTopicDir, hubProjects, hubTopics, hasHubProject, latestHtml, savePublish, writeAnswerFiles, listHubAnswers, markHubSeen, setHubWaiting, isHubWaiting, checkNames, checkVersion } from "./hub.mjs";

// 値つきの引数。値が無い・空・次が -- 始まりのときは起動を断る (--host の値が欠けて全経路で待ってしまう、などを防ぐ)
const EXAMPLES = { root: ".tmp/html-qa", port: "5190", host: "127.0.0.1", "lan-url": "http://192.168.1.10:5191" };
const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return d;
  const v = process.argv[i + 1];
  if (v === undefined || v === "" || v.startsWith("--")) { console.error(`--${name} には値を指定してください (例: --${name} ${EXAMPLES[name] ?? "<値>"})`); process.exit(2); }
  return v;
};
const ROOT = path.resolve(arg("root", DEFAULT_ROOT));
const PORT = Number(arg("port", process.env.HTML_QA_PORT || 5190));
const HOST = arg("host", "127.0.0.1");
if (!Number.isInteger(PORT) || PORT < 0 || PORT > 65535) { console.error(`--port が不正です (0〜65535 の整数を指定してください): ${arg("port", "")}`); process.exit(2); }
const MAX_BODY = 512 * 1024;
const HUB_FILE_RE = /^(?:index|v\d{1,4})\.html$|^v\d{1,4}\.(?:json|answer\.md|answer\.json)$/;
const COOKIE = "html_qa_key";
const TYPES = { ".html": "text/html; charset=utf-8", ".json": "application/json; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml" };

let PORT_ACTUAL = PORT;
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
const latestOf = (topic) => latestHtml(path.join(ROOT, topic));
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
const headerKey = (req) => { const v = req.headers["x-html-qa-key"]; return typeof v === "string" ? v : null; };
const DENIED = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>html-qa</title>
<body style="font-family:system-ui,sans-serif;max-width:560px;margin:40px auto;padding:0 16px;line-height:1.7">
<h1 style="font-size:18px">鍵が必要です</h1><p>AI がチャットに示した URL (<code>?key=…</code> つき) から開いてください。一度開けば、このブラウザでは鍵なしで開けます。</p></body></html>`;

// JSON の本文を読む。上限を超えたら 413 を返し、それ以降の本文は捨てる (読み切らずに切ると、送り手が 413 を受け取れないため)
const readJson = (req, res, max, then) => {
  if (!String(req.headers["content-type"] || "").startsWith("application/json")) return send(res, 415, { error: "JSON で送ってください" });
  const declared = Number(req.headers["content-length"]);
  let size = 0; const chunks = []; let over = false;
  if (Number.isFinite(declared) && declared > max) over = true;
  if (over) send(res, 413, { error: `大きすぎます (${Math.floor(max / 1048576) || 1}MB まで)` }, undefined, { Connection: "close" });
  req.on("data", (c) => {
    size += c.length;
    if (size > max && !over) { over = true; chunks.length = 0; send(res, 413, { error: `大きすぎます (${Math.floor(max / 1048576) || 1}MB まで)` }, undefined, { Connection: "close" }); }
    if (over) { if (size > max + 64 * 1048576) req.destroy(); } else chunks.push(c);
  });
  req.on("end", () => {
    if (over || res.writableEnded) return;
    let body;
    try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { return send(res, 400, { error: "JSON が読めません" }); }
    try { then(body); } catch (err) {
      if (res.headersSent || res.writableEnded) { res.destroy(); return; } // 応答済みなら、接続を閉じるだけ
      if (err instanceof HubError) return send(res, err.status, { error: err.message });
      console.error(`処理に失敗しました: ${err.message}`);
      return send(res, 500, { error: "サーバ内の処理に失敗しました" });
    }
  });
};
const hubDirOrThrow = (project, topic) => {
  const dir = hubTopicDir(ROOT, project, topic);
  if (!dir) throw new HubError(404, "その議題はありません");
  return dir;
};
const intParam = (v) => (v == null || v === "" || !/^\d{1,6}$/.test(v) ? NaN : Number(v));

const hubIndexHtml = () => {
  const own = collectRows(ROOT);
  const projects = hubProjects(ROOT).sort();
  const groups = [];
  if (projects.length) {
    if (own.length) groups.push({ label: "このハブ自身の議題", rows: own });
    for (const p of projects) groups.push({ label: p, href: `/p/${encodeURIComponent(p)}/`, rows: collectRows(path.join(hubBase(ROOT), p), `/${encodeURIComponent(p)}/`) });
    return renderIndex(groups, { lead: "ハブに預かっている全プロジェクトの議題 (プロジェクトごと・新しい順)。" });
  }
  return renderIndex([{ rows: own }]);
};
const hubProjectIndexHtml = (p) => renderIndex([{ rows: collectRows(path.join(hubBase(ROOT), p), `/${encodeURIComponent(p)}/`) }], { heading: `議題の一覧: ${p}`, lead: "このプロジェクトの議題 (新しい順)。", back: { href: "/", label: "← すべてのプロジェクト" } });

function handle(req, res) {
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
  const viaHeader = keyMatches(headerKey(req), KEY);
  if (!viaHeader && !keyMatches(cookieKey(req), KEY)) {
    return url.pathname.startsWith("/api/") ? send(res, 401, { error: "鍵がありません" }) : send(res, 401, DENIED, "text/html; charset=utf-8");
  }

  if (url.pathname === "/api/ping") return send(res, 200, { ok: true });
  if (url.pathname === "/api/latest") {
    const topic = url.searchParams.get("topic") || "";
    const project = url.searchParams.get("project");
    if (project != null) {
      try { checkNames(project, topic); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
      const v = latestHtml(hubTopicDir(ROOT, project, topic));
      return send(res, 200, { version: v, file: v ? `v${v}.html` : null });
    }
    if (!TOPIC_RE.test(topic)) return send(res, 400, { error: "topic が不正です" });
    const v = latestOf(topic);
    return send(res, 200, { version: v, file: v ? `v${v}.html` : null });
  }
  if (url.pathname === "/api/status") {
    const topic = url.searchParams.get("topic") || "";
    const project = url.searchParams.get("project");
    const version = Number(url.searchParams.get("version"));
    if (!Number.isInteger(version) || version < 1) return send(res, 400, { error: "topic / version が不正です" });
    if (project != null) {
      let dir;
      try { checkNames(project, topic); dir = hubDirOrThrow(project, topic); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
      return send(res, 200, { ...answerStatus(dir, version), waiting: isHubWaiting(project, topic) });
    }
    if (!TOPIC_RE.test(topic)) return send(res, 400, { error: "topic / version が不正です" });
    const dir = path.join(ROOT, topic);
    if (!fs.existsSync(dir)) return send(res, 404, { error: "その議題はありません" });
    return send(res, 200, { ...answerStatus(dir, version), waiting: isWaiting(dir) });
  }

  // ---- ハブ: スクリプトからの書き込み (ヘッダの鍵が必須。cookie だけでは通さない) ----
  if (url.pathname === "/api/publish" || url.pathname === "/api/waiting" || url.pathname === "/api/seen") {
    if (req.method !== "POST") return send(res, 405, { error: "POST だけ受け付けます" });
    if (!viaHeader) return send(res, 401, { error: "鍵のヘッダ (X-Html-Qa-Key) が必要です" });
    if (url.pathname === "/api/publish") {
      return readJson(req, res, LIMITS.body, (body) => {
        const r = savePublish(ROOT, body);
        console.log(`預かりました: ${r.project}/${r.topic}/v${r.version}`);
        return send(res, 200, { ok: true, ...r, port: Number(process.env.HTML_QA_PORT), lan: lanBase(ROOT) });
      });
    }
    return readJson(req, res, 4096, (body) => {
      const { project, topic, version, mtimeMs, done } = body && typeof body === "object" ? body : {};
      checkNames(project, topic);
      const dir = hubDirOrThrow(project, topic);
      if (url.pathname === "/api/waiting") { setHubWaiting(project, topic, done !== true); return send(res, 200, { ok: true }); }
      checkVersion(version);
      markHubSeen(dir, version, mtimeMs);
      return send(res, 200, { ok: true });
    });
  }

  if (url.pathname === "/api/answer" && req.method === "GET") {
    const project = url.searchParams.get("project");
    const topic = url.searchParams.get("topic");
    const vParam = url.searchParams.get("version");
    const version = vParam == null ? null : intParam(vParam);
    try {
      if (project == null) throw new HubError(400, "project が必要です");
      if (version !== null && !(version >= 1 && version <= LIMITS.maxVersion)) throw new HubError(400, "version が不正です");
      checkNames(project, topic ?? "x");
      const topics = topic != null ? [topic] : (hasHubProject(ROOT, project) ? hubTopics(ROOT, project) : []);
      const answers = [];
      for (const t of topics) {
        checkNames(project, t);
        const dir = hubTopicDir(ROOT, project, t);
        if (!dir) { if (topic != null) throw new HubError(404, "その議題はありません"); continue; }
        for (const a of listHubAnswers(dir, { version, unread: url.searchParams.get("unread") === "1" })) answers.push({ topic: t, ...a });
      }
      if (!answers.length) return send(res, 204, "");
      return send(res, 200, { answers });
    } catch (e) {
      if (e instanceof HubError) return send(res, e.status, { error: e.message });
      console.error(`回答を読めませんでした: ${e.message}`);
      return send(res, 500, { error: "サーバ内の処理に失敗しました" });
    }
  }
  if (url.pathname === "/api/answer") {
    if (req.method !== "POST") return send(res, 405, { error: "POST だけ受け付けます" });
    if (!sameOrigin(req)) return send(res, 403, { error: "別のサイトからは保存できません" });
    return readJson(req, res, MAX_BODY, (body) => {
      const { project, topic, version, text, answers } = body || {};
      const hub = project !== undefined;
      if (hub) checkNames(project, topic);
      if ((!hub && !TOPIC_RE.test(topic || "")) || !Number.isInteger(version) || version < 1 || typeof text !== "string" || !text.trim()) return send(res, 400, { error: "topic / version / text が不正です" });
      let dir;
      if (hub) {
        dir = hubDirOrThrow(project, topic);
        if (!fs.existsSync(path.join(dir, `v${version}.html`))) return send(res, 404, { error: "その議題・版はありません" });
      } else {
        dir = path.join(ROOT, topic);
        if (!fs.existsSync(path.join(dir, `v${version}.json`))) return send(res, 404, { error: "その議題・版はありません" });
      }
      const file = writeAnswerFiles(dir, topic, version, text, answers);
      const rel = path.relative(process.cwd(), file).split(path.sep).join("/");
      console.log(`回答を保存: ${rel}`);
      if (!hub) { try { buildIndex(ROOT); } catch (err) { console.error(`議題一覧を作り直せませんでした: ${err.message}`); } }
      return send(res, 200, { ok: true, path: hub ? `${project}/${topic}/v${version}.answer.md` : rel });
    });
  }
  if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, { error: "GET だけ受け付けます" });
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, { error: "URL が不正です" }); }
  if (rel.includes("\0") || rel.includes("\\") || rel.split("/").some((seg) => seg.startsWith("."))) return send(res, 404, "見つかりません", "text/plain; charset=utf-8");

  // 議題の一覧 (ハブとして、全プロジェクト分)
  if (rel === "/" || rel === "/index.html") return send(res, 200, hubIndexHtml(), "text/html; charset=utf-8");
  // ハブに預かった議題: /<project>/ /<project>/<topic>/ /<project>/<topic>/<file>
  const segs = rel.split("/").filter(Boolean);
  const legacyTopic = TOPIC_RE.test(segs[0] || "") && fs.existsSync(path.join(ROOT, segs[0])) && fs.statSync(path.join(ROOT, segs[0])).isDirectory();
  const legacyShape = segs.length === 1 || (segs.length === 2 && segs[1].includes("."));
  // プロジェクトの一覧の別の入口 /p/<project>/ (従来の議題と同名のプロジェクトでも行ける)
  if (segs[0] === "p" && segs.length >= 2 && segs.length <= 3 && (segs.length === 2 || segs[2] === "index.html") && hasHubProject(ROOT, segs[1])) {
    if (segs.length === 2 && !rel.endsWith("/")) { res.writeHead(302, { Location: `${url.pathname}/` }); return res.end(); }
    return send(res, 200, hubProjectIndexHtml(segs[1]), "text/html; charset=utf-8");
  }
  if (segs.length && !(legacyTopic && legacyShape) && hasHubProject(ROOT, segs[0])) {
    const project = segs[0];
    if (segs.length === 1 || (segs.length === 2 && segs[1] === "index.html")) {
      if (segs.length === 1 && !rel.endsWith("/")) { res.writeHead(302, { Location: `${url.pathname}/` }); return res.end(); }
      return send(res, 200, hubProjectIndexHtml(project), "text/html; charset=utf-8");
    }
    const topic = segs[1];
    if (!/^[a-z0-9][a-z0-9-]{0,40}$/.test(topic)) return send(res, 404, "見つかりません", "text/plain; charset=utf-8");
    if (segs.length === 2 && !rel.endsWith("/")) { res.writeHead(302, { Location: `${url.pathname}/` }); return res.end(); }
    const name = segs.length === 2 ? "index.html" : segs[2];
    if (segs.length > 3 || !HUB_FILE_RE.test(name)) return send(res, 404, "見つかりません", "text/plain; charset=utf-8");
    const dir = hubTopicDir(ROOT, project, topic);
    const file = dir && path.join(dir, name);
    // 通常のファイルだけ配る (リンクは、外のファイルを指しうるので配らない)
    if (!file || !isRegularFile(file)) return send(res, 404, "見つかりません (ハブにその議題・版はありません)", "text/plain; charset=utf-8");
    return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
  }

  let file = path.resolve(ROOT, "." + rel);
  if (file !== ROOT && !file.startsWith(ROOT + path.sep)) return send(res, 403, { error: "範囲外です" });
  if (fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    if (!rel.endsWith("/")) { res.writeHead(302, { Location: url.pathname + "/" }); return res.end(); }
    file = path.join(file, "index.html");
  }
  if (!fs.existsSync(file)) return send(res, 404, "見つかりません (build.mjs を実行しましたか?)", "text/plain; charset=utf-8");
  return send(res, 200, fs.readFileSync(file), TYPES[path.extname(file).toLowerCase()] || "application/octet-stream");
}

// 受け皿: どの経路で例外が出ても、プロセスは落とさず 500 (HubError なら、その状態) を返す。
// ログには種別と URL のパス (?key= を含むクエリは除く) だけを出し、応答の本文にも内部の情報は入れない
function fail(req, res, err) {
  const where = String(req.url || "").split("?")[0].slice(0, 200);
  const status = err instanceof HubError ? err.status : err?.code === "ERR_INVALID_URL" ? 400 : 500;
  if (status >= 500) console.error(`リクエストの処理に失敗しました (${err?.code || err?.name || "Error"}): ${req.method} ${where}`);
  if (res.headersSent || res.writableEnded) { res.destroy(); return; }
  try { send(res, status, { error: err instanceof HubError ? err.message : status === 400 ? "URL が不正です" : "サーバ内の処理に失敗しました" }); } catch { res.destroy(); }
}
const server = http.createServer((req, res) => {
  try { handle(req, res); } catch (err) { fail(req, res, err); }
});

server.listen(PORT, HOST, () => {
  PORT_ACTUAL = server.address().port;
  process.env.HTML_QA_PORT = String(PORT_ACTUAL);
  const u = pageUrls(ROOT);
  console.log(`html-qa ハブ: ${u.local}`);
  if (u.lan) console.log(`スマホ (家庭内 LAN): ${u.lan}`);
  console.log(`フォルダ: ${path.relative(process.cwd(), ROOT) || "."} / 止めるときは Ctrl+C`);
  console.log("");
  console.log("ほかのプロジェクト (開発コンテナ) の議題を預かるには、そのプロジェクトで 1 回だけ登録します:");
  console.log(`  ハブの鍵: ${KEY}`);
  console.log("  read -rs HTML_QA_HUB_KEY && export HTML_QA_HUB_KEY      # 上の鍵を貼り付けて Enter (コマンド履歴や ps に鍵が残らない)");
  console.log(`  node ai-skills/html-qa/scripts/build.mjs --hub-url http://host.docker.internal:${PORT_ACTUAL} --project <プロジェクト名>`);
  console.log("  (URL の host.docker.internal:… は環境で変わります。解除は --hub off。届かないとき・詳しくは ai-skills/html-qa/README.md)");
  if (!["127.0.0.1", "localhost", "::1"].includes(HOST)) console.log(`\n△ ${HOST} で待っています。同じ LAN の機器から届きます (鍵が無い接続は断りますが、鍵は他人に渡さないでください)。`);
});
server.on("error", (err) => {
  console.error(err.code === "EADDRINUSE" ? `ポート ${PORT} は使用中です。--port で変えてください` : err.message);
  process.exit(1);
});
