// html-qa: ハブの鍵の自動の受け渡し (#1595) の試験。実際のホームは触らず、一時ディレクトリと HOME / HTML_QA_HUB_KEY_FILE で差し替える。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { hubCall, HubClientError } from "./hub-client.mjs";
import { readSharedKey, hubConfig } from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, "build.mjs");
const SERVE = path.join(HERE, "serve.mjs");

let tmp;
const children = new Set();
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "html-qa-skey-")); process.env.HOME = path.join(tmp, "home"); delete process.env.HTML_QA_HUB_KEY_FILE; delete process.env.HTML_QA_HUB_KEY; });
after(async () => {
  for (const c of children) c.kill("SIGKILL");
  await Promise.all([...children].map((c) => (c.exitCode !== null || c.signalCode ? null : new Promise((r) => c.once("exit", r)))));
  fs.rmSync(tmp, { recursive: true, force: true });
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const freePort = () => new Promise((resolve, reject) => { const s = net.createServer(); s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); }); s.on("error", reject); });

async function startHub(name, args = [], { port } = {}) {
  const root = path.join(tmp, name, "hub-root");
  port ??= await freePort();
  const child = spawn(process.execPath, [SERVE, "--root", root, "--port", String(port), ...args], { cwd: tmp, env: process.env, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  const out = { stdout: "", stderr: "" };
  child.stdout.on("data", (d) => { out.stdout += d; });
  child.stderr.on("data", (d) => { out.stderr += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const key = fs.readFileSync(path.join(root, ".key"), "utf8").trim();
      if ((await fetch(`${base}/api/ping`, { headers: { "X-Html-Qa-Key": key } })).ok) return { port, root, key, base, out, child };
    } catch { /* まだ */ }
    await sleep(50);
  }
  throw new Error(`ハブが起動しませんでした: ${out.stderr}`);
}
const stop = async (h) => { h.child.kill("SIGKILL"); await new Promise((r) => (h.child.exitCode !== null || h.child.signalCode ? r() : h.child.once("exit", r))); };

const mkProject = (name) => {
  const cwd = path.join(tmp, "proj", name);
  const dir = path.join(cwd, ".tmp", "html-qa", "t1");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "v1.json"), JSON.stringify({ topic: "t1", version: 1, title: "題", lead: "要旨", sections: [{ title: "章", blocks: [{ type: "input", id: "a", q: "質問A?" }] }] }));
  return { cwd, root: path.dirname(dir), hubJson: path.join(path.dirname(dir), ".hub.json") };
};
const build = (p, args, env = {}) => spawnSync(process.execPath, [BUILD, ...args], { cwd: p.cwd, encoding: "utf8", env: { ...process.env, ...env } });
const mode = (f) => fs.statSync(f).mode & 0o777;

test("serve.mjs: 鍵を --key-export の場所へ 0600 (フォルダ 0700) で書き、一時ファイルを残さず、鍵を表示しない", async () => {
  const file = path.join(tmp, "export1", "deep", "hub.key");
  const hub = await startHub("e1", ["--key-export", file]);
  assert.equal(fs.readFileSync(file, "utf8").trim(), hub.key);
  assert.equal(mode(file), 0o600);
  assert.equal(mode(path.dirname(file)), 0o700);
  assert.deepEqual(fs.readdirSync(path.dirname(file)), ["hub.key"]);
  assert.match(hub.out.stdout, /共有の場所に書きました/);
  // 既存仕様の「開く」URL (?key=) 以外に鍵は出ない
  assert.equal(hub.out.stdout.split("\n").filter((l) => l.includes(hub.key) && !l.includes("?key=")).length, 0, "鍵がログに出ている");
  assert.equal(hub.out.stderr.includes(hub.key), false);
});

test("serve.mjs: 既定は HOME の ~/.agent-containers/.shared/html-qa/hub.key。--new-key で書き直す", async () => {
  const def = path.join(process.env.HOME, ".agent-containers", ".shared", "html-qa", "hub.key");
  const h1 = await startHub("e2");
  assert.equal(fs.readFileSync(def, "utf8").trim(), h1.key);
  await stop(h1);
  const h2 = await startHub("e2", ["--new-key"]);
  assert.notEqual(h2.key, h1.key);
  assert.equal(fs.readFileSync(def, "utf8").trim(), h2.key);
  assert.equal(readSharedKey({}).key, h2.key); // 読む側 (既定の候補) もここを見つける
});

test("serve.mjs: --key-export off は書かない / 書けなくても △ を出して動き続ける", async () => {
  const off = path.join(tmp, "export3", "hub.key");
  const h = await startHub("e3", ["--key-export", "off"]);
  assert.equal(fs.existsSync(off), false);
  assert.match(h.out.stdout, /ハブの鍵: /); // 手で渡す案内
  const blocker = path.join(tmp, "blocker"); fs.writeFileSync(blocker, "x"); // ファイルの下にはフォルダを作れない
  const h2 = await startHub("e4", ["--key-export", path.join(blocker, "sub", "hub.key")]);
  assert.match(h2.out.stdout, /△ ハブの鍵を共有の場所/);
  assert.equal((await fetch(`${h2.base}/api/ping`, { headers: { "X-Html-Qa-Key": h2.key } })).status, 200);
});

test("鍵の読む順番: --hub-key → --hub-key-file → HTML_QA_HUB_KEY → 共有の場所", async () => {
  const hub = await startHub("o1", ["--key-export", "off"]);
  const stale = "S".repeat(32);
  const shared = path.join(tmp, "o1-shared.key"); fs.writeFileSync(shared, `${stale}\n`);
  const other = "O".repeat(32);
  const keyFile = path.join(tmp, "o1-file.key"); fs.writeFileSync(keyFile, `${other}\n`);
  const stored = (p) => JSON.parse(fs.readFileSync(p.hubJson, "utf8")).key;
  const env = { HTML_QA_HUB_KEY_FILE: shared };
  // 共有の場所だけ: 鍵は保存しない
  const p0 = mkProject("o0");
  const r0 = build(p0, ["--hub-url", hub.base, "--project", "o0"], env);
  assert.equal(r0.status, 0, r0.stderr);
  assert.equal("key" in JSON.parse(fs.readFileSync(p0.hubJson, "utf8")), false);
  process.env.HTML_QA_HUB_KEY_FILE = shared;
  try { assert.equal(hubConfig(p0.root).key, stale); assert.equal(hubConfig(p0.root).shared, true); } finally { delete process.env.HTML_QA_HUB_KEY_FILE; }
  // 環境変数 > 共有
  const p1 = mkProject("o1");
  build(p1, ["--hub-url", hub.base, "--project", "o1"], { ...env, HTML_QA_HUB_KEY: hub.key });
  assert.equal(stored(p1), hub.key);
  // --hub-key-file > 環境変数
  const p2 = mkProject("o2");
  build(p2, ["--hub-url", hub.base, "--project", "o2", "--hub-key-file", keyFile], { ...env, HTML_QA_HUB_KEY: hub.key });
  assert.equal(stored(p2), other);
  // --hub-key > --hub-key-file
  const p3 = mkProject("o3");
  build(p3, ["--hub-url", hub.base, "--project", "o3", "--hub-key", hub.key, "--hub-key-file", keyFile], env);
  assert.equal(stored(p3), hub.key);
  // どこにも鍵が無ければ断る
  const p4 = mkProject("o4");
  const r4 = build(p4, ["--hub-url", hub.base, "--project", "o4"], { HTML_QA_HUB_KEY_FILE: path.join(tmp, "nothing.key") });
  assert.equal(r4.status, 2);
  assert.equal(fs.existsSync(p4.hubJson), false);
});

test("共有の場所から読む登録は、鍵の作り直しにも登録し直しなしで追従する", async () => {
  const keyfile = path.join(tmp, "rot", "hub.key");
  const port = await freePort();
  const h1 = await startHub("rot", ["--key-export", keyfile], { port });
  const p = mkProject("rot");
  const env = { HTML_QA_HUB_KEY_FILE: keyfile };
  assert.equal(build(p, ["--hub-url", h1.base, "--project", "rot"], env).status, 0);
  const r1 = build(p, [path.join(p.root, "t1")], env);
  assert.match(r1.stdout, /ハブに送りました/);
  await stop(h1);
  const h2 = await startHub("rot", ["--key-export", keyfile, "--new-key"], { port });
  assert.notEqual(h2.key, h1.key);
  const r2 = build(p, [path.join(p.root, "t1")], env);
  assert.match(r2.stdout, /ハブに送りました/, r2.stdout + r2.stderr);
  assert.equal(r2.stdout.includes(h2.key) && !/開く:/.test(r2.stdout), false);
  assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(p.hubJson, "utf8"))).includes(h2.key), false, "鍵が .hub.json に保存されている");
});

test("hubCall: 401 で共有の鍵が変わっていれば 1 回だけ読み直してやり直す。変わっていなければ auth エラー", async () => {
  const keyfile = path.join(tmp, "retry", "hub.key");
  const hub = await startHub("retry", ["--key-export", "off"]);
  fs.mkdirSync(path.dirname(keyfile), { recursive: true });
  process.env.HTML_QA_HUB_KEY_FILE = keyfile;
  try {
    const stale = "Z".repeat(32);
    fs.writeFileSync(keyfile, `${hub.key}\n`);
    const cfg = { url: hub.base, key: stale, project: "x", shared: true };
    const r = await hubCall(cfg, "GET", "/api/ping");
    assert.equal(r.status, 200);
    assert.equal(cfg.key, hub.key);
    // 共有の鍵も古いまま: 再試行は 1 回だけで auth エラー
    fs.writeFileSync(keyfile, `${stale}\n`);
    await assert.rejects(hubCall({ url: hub.base, key: "Y".repeat(32), project: "x", shared: true }, "GET", "/api/ping"), (e) => e instanceof HubClientError && e.kind === "auth");
    // 共有ではない設定 (保存した鍵) は読み直さない
    fs.writeFileSync(keyfile, `${hub.key}\n`);
    await assert.rejects(hubCall({ url: hub.base, key: stale, project: "x" }, "GET", "/api/ping"), (e) => e.kind === "auth");
  } finally { delete process.env.HTML_QA_HUB_KEY_FILE; }
});

test("雛形 4 種の devcontainer.json に mount と initializeCommand がある", () => {
  const base = path.join(HERE, "..", "..", "generate-code", "templates", "devcontainer");
  for (const [combo, home] of [["nestjs-nextjs", "/home/node"], ["nestjs-thymeleaf", "/home/node"], ["spring-boot-nextjs", "/home/vscode"], ["spring-boot-thymeleaf", "/home/vscode"]]) {
    const s = fs.readFileSync(path.join(base, combo, ".devcontainer", "devcontainer.json"), "utf8");
    assert.ok(s.includes(`.agent-containers/.shared/html-qa,target=${home}/.html-qa-shared,type=bind,readonly`), combo);
    assert.match(s, /"initializeCommand": "bash -c 'mkdir -p ~\/\.agent-containers\/\.shared\/html-qa'"/, combo);
  }
});
