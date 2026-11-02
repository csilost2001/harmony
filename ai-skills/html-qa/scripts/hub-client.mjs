// html-qa: プロジェクト側からハブ (serve.mjs) を呼ぶ共通処理。build.mjs / wait.mjs / hook-inject.mjs が使う。
//   設定は <root>/.hub.json (lib.mjs の hubConfig)。鍵はヘッダ X-Html-Qa-Key で渡し、URL・ログには出さない
import fs from "node:fs";
import path from "node:path";
import { HUB_NAME_RE, readSharedKey, sharedKeyProblem, sharedKeyAllowedHost, SHARED_HOST_MSG } from "./lib.mjs";

// kind: unreachable (届かない) / auth (鍵が違う) / toolarge / bad (こちらの送る内容の誤り) / server
export class HubClientError extends Error {
  constructor(kind, message, status = 0) { super(message); this.kind = kind; this.status = status; }
}

export async function hubCall(cfg, method, p, body, opts = {}) {
  try { return await hubCallOnce(cfg, method, p, body, opts); } catch (e) {
    // 共有の場所から読んだ鍵で 401 のとき、ハブが鍵を作り直していれば読み直して 1 回だけやり直す
    if (e instanceof HubClientError && e.kind === "auth" && cfg.shared) {
      const fresh = readSharedKey()?.key;
      if (fresh && fresh !== cfg.key) { cfg.key = fresh; return await hubCallOnce(cfg, method, p, body, opts); }
    }
    throw e;
  }
}

async function hubCallOnce(cfg, method, p, body, { timeoutMs = 10_000 } = {}) {
  if (cfg.shared && !sharedKeyAllowedHost(cfg.url)) throw new HubClientError("auth", SHARED_HOST_MSG, 0);
  if (!cfg.key) throw new HubClientError("auth", cfg.shared ? (sharedKeyProblem() || "共有の場所の鍵を読めません") : "ハブの鍵がありません (--hub-key-file か HTML_QA_HUB_KEY で渡して登録し直してください)", 0);
  let res;
  try {
    res = await fetch(`${cfg.url}${p}`, {
      method,
      headers: { "X-Html-Qa-Key": cfg.key, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
      redirect: "error", // 鍵のヘッダを、リダイレクト先 (別のオリジン) へ持ち出さない
    });
  } catch (e) {
    const why = e?.cause?.code || e?.name || "error";
    throw new HubClientError("unreachable", `ハブ (${cfg.url}) に届きません (${why})。ハブ (serve.mjs) が起動しているか、登録した URL が合っているか確かめてください`);
  }
  if (res.status === 204) return { status: 204, json: null };
  let json = null;
  try { json = await res.json(); } catch { /* 本文なし */ }
  if (res.ok) return { status: res.status, json };
  if (res.status === 401) throw new HubClientError("auth", cfg.shared ? "ハブの鍵が違います (共有の場所の鍵がハブの鍵と合っていません。ハブを起動し直すか、--hub-key-file で鍵を渡して登録し直してください)" : "ハブの鍵が違います (ハブの起動時に表示された鍵で、--hub-key を登録し直してください)", 401);
  if (res.status === 413) throw new HubClientError("toolarge", `ハブが受け付ける大きさを超えています (${json?.error || "413"})`, 413);
  throw new HubClientError(res.status >= 500 ? "server" : "bad", `ハブが ${res.status} を返しました${json?.error ? `: ${json.error}` : ""}`, res.status);
}

const readJsonFile = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };

// 議題フォルダの指定した版 (vN.html と、あれば vN.json) をハブへ送る。最後の応答 ({ path, port, lan }) を返す
export async function publishTopic(cfg, dir, versions) {
  const topic = path.basename(dir);
  if (!HUB_NAME_RE.test(topic)) throw new HubClientError("bad", `議題名 "${topic}" はハブに送れません (英小文字・数字・ハイフンで 41 文字まで)`);
  let last = null;
  for (const v of versions) {
    const html = fs.readFileSync(path.join(dir, `v${v}.html`), "utf8");
    const json = readJsonFile(path.join(dir, `v${v}.json`));
    const r = await hubCall(cfg, "POST", "/api/publish", { project: cfg.project, topic, version: v, html, ...(json && typeof json === "object" ? { json } : {}) }, { timeoutMs: 60_000 });
    last = r.json;
  }
  return last;
}

// ハブでの URL (PC / スマホ)。鍵つき
export function hubUrls(cfg, r) {
  const p = r.path;
  return { local: `http://localhost:${r.port}${p}?key=${cfg.key}`, lan: r.lan ? `${r.lan}${p}?key=${cfg.key}` : null };
}

// ハブにある未読の回答を、ローカルの <root>/<topic>/vN.answer.md (と .json) に書く。既存の hook-inject / wait の仕組みはこれで動く。
// 書き終えた (またはすでに書いてあった) 回答の一覧を返す。AI が読んだあとに seenHub で印を付ける
export async function pullHubAnswers(root, cfg, topic = null, opts = {}) {
  const q = `project=${encodeURIComponent(cfg.project)}${topic ? `&topic=${encodeURIComponent(topic)}` : ""}&unread=1`;
  const r = await hubCall(cfg, "GET", `/api/answer?${q}`, undefined, opts);
  if (r.status === 204 || !Array.isArray(r.json?.answers)) return [];
  const got = [];
  for (const a of r.json.answers) {
    const dir = path.join(root, String(a.topic));
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(String(a.topic)) || !fs.existsSync(dir) || !Number.isInteger(a.version) || a.version < 1 || typeof a.text !== "string") continue; // ローカルに無い議題は書かない
    const md = path.join(dir, `v${a.version}.answer.md`);
    const mark = path.join(dir, `v${a.version}.answer.hub`);
    const delivered = fs.existsSync(mark) && fs.readFileSync(mark, "utf8").trim() === String(a.mtimeMs) && fs.existsSync(md);
    if (!delivered) {
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

// ハブに「受け取った」印を付ける。回答を出力したあとに呼ぶ。全体で totalMs までしか待たない (ハブが応答しなくても終われるように)。
// 失敗しても続ける: ローカルの印 (vN.answer.hub と .seen) を正とし、次に取り込んだときに二重には渡さない
export async function seenHub(cfg, items, { totalMs = 2500 } = {}) {
  const deadline = Date.now() + totalMs;
  await Promise.all(items.map(async (it) => {
    const left = deadline - Date.now();
    if (left <= 0) return;
    try { await hubCall(cfg, "POST", "/api/seen", { project: cfg.project, topic: it.topic, version: it.version, mtimeMs: it.mtimeMs }, { timeoutMs: left }); } catch { /* 続ける */ }
  }));
}

export async function waitingBeat(cfg, topic, done = false) {
  try { await hubCall(cfg, "POST", "/api/waiting", { project: cfg.project, topic, ...(done ? { done: true } : {}) }, { timeoutMs: 2000 }); } catch { /* 合図は届かなくてもよい */ }
}
