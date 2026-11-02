// html-qa ハブ (#1590) の試験。ハブ (serve.mjs) を一時ポート・一時ディレクトリで起動して、プロジェクト役の build / wait と通しで確かめる。
// 起動したサーバは after() で必ず止める (ポートを残さない)。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, "build.mjs");
const SERVE = path.join(HERE, "serve.mjs");
const WAIT = path.join(HERE, "wait.mjs");
const HOOK = path.join(HERE, "hook-inject.mjs");

let tmp;
const children = new Set();
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "html-qa-hub-"));
  process.env.HOME = path.join(tmp, "home"); delete process.env.HTML_QA_HUB_KEY_FILE; // 実際のホームの共有の鍵を読み書きしない (#1595)
});
after(async () => {
  for (const c of children) c.kill("SIGKILL");
  await Promise.all([...children].map((c) => (c.exitCode !== null || c.signalCode ? null : new Promise((r) => c.once("exit", r)))));
  fs.rmSync(tmp, { recursive: true, force: true });
});

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.listen(0, "127.0.0.1", () => { const { port } = s.address(); s.close(() => resolve(port)); });
  s.on("error", reject);
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ハブを起動して { port, root, key, base, stderr } を返す
async function startHub(name, { args = [], env = {} } = {}) {
  const root = path.join(tmp, name, "hub-root");
  const port = await freePort();
  const child = spawn(process.execPath, [SERVE, "--root", root, "--port", String(port), "--key-export", "off", ...args], { cwd: tmp, env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
  children.add(child);
  const out = { stdout: "", stderr: "" };
  child.stdout.on("data", (d) => { out.stdout += d; });
  child.stderr.on("data", (d) => { out.stderr += d; });
  const base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 100; i++) {
    try {
      const key = fs.readFileSync(path.join(root, ".key"), "utf8").trim();
      const r = await fetch(`${base}/api/ping`, { headers: { "X-Html-Qa-Key": key } });
      if (r.ok) return { port, root, key, base, out, child };
    } catch { /* まだ */ }
    await sleep(50);
  }
  throw new Error(`ハブが起動しませんでした: ${out.stderr}`);
}
const H = (hub, extra = {}) => ({ "X-Html-Qa-Key": hub.key, ...extra });
const post = (hub, p, body, headers = H(hub)) => fetch(`${hub.base}${p}`, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) });
const get = (hub, p, headers = H(hub)) => fetch(`${hub.base}${p}`, { headers, redirect: "manual" });
const jar = (hub) => ({ Cookie: `html_qa_key=${hub.key}`, Origin: hub.base });

const jdoc = (topic, version, extra = {}) => ({ topic, version, title: `題 ${topic} v${version}`, lead: "要旨", sections: [{ title: "章", blocks: [{ type: "input", id: "a", q: "質問A?" }] }], ...extra });
const pub = (hub, project, topic, version, extra = {}) => post(hub, "/api/publish", { project, topic, version, html: `<!doctype html><title>${project}/${topic}/v${version}</title>`, json: jdoc(topic, version), ...extra });

// プロジェクト役のディレクトリ (.tmp/html-qa/<topic>/vN.json を持つ)
function mkProject(name, topic = "t1", versions = [1]) {
  const cwd = path.join(tmp, "proj", name);
  const dir = path.join(cwd, ".tmp", "html-qa", topic);
  fs.mkdirSync(dir, { recursive: true });
  for (const v of versions) fs.writeFileSync(path.join(dir, `v${v}.json`), JSON.stringify(jdoc(topic, v)));
  return { cwd, dir, root: path.dirname(dir), rel: `.tmp/html-qa/${topic}` };
}
const runBuild = (p, ...args) => spawnSync(process.execPath, [BUILD, ...args], { cwd: p.cwd, encoding: "utf8" });
const register = (p, hub, project) => runBuild(p, "--hub-url", hub.base, "--hub-key", hub.key, "--project", project);

// ツリー全体 (ファイルの相対パス) の一覧
const tree = (dir) => fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true }).map(String).sort() : [];

test("publish → 一覧 → 画面取得 → 回答 → 取り出し → 受け取りの印 (ハブ単体)", async () => {
  const hub = await startHub("single");
  const r = await pub(hub, "tax-app", "login", 1);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.path, "/tax-app/login/");
  assert.equal(j.port, hub.port);
  assert.ok(fs.existsSync(path.join(hub.root, ".hub", "tax-app", "login", "v1.html")));
  assert.ok(fs.existsSync(path.join(hub.root, ".hub", "tax-app", "login", "v1.json")));
  assert.ok(fs.existsSync(path.join(hub.root, ".hub", "tax-app", "login", "index.html")));
  assert.equal(JSON.stringify(j).includes(hub.key), false);

  // 画面の取得 (ヘッダの鍵・cookie のどちらでも)。?key= で開くと cookie を渡される
  for (const p of ["/tax-app/login/", "/tax-app/login/index.html", "/tax-app/login/v1.html", "/tax-app/login/v1.json"]) assert.equal((await get(hub, p)).status, 200, p);
  assert.equal((await get(hub, "/tax-app/login", H(hub))).status, 302);
  const ck = await fetch(`${hub.base}/tax-app/login/?key=${hub.key}`, { redirect: "manual" });
  assert.equal(ck.status, 302);
  assert.match(ck.headers.get("set-cookie"), /^html_qa_key=/);
  assert.equal((await get(hub, "/tax-app/login/v1.html", jar(hub))).status, 200);
  assert.match(await (await get(hub, "/tax-app/login/v1.html")).text(), /tax-app\/login\/v1/);

  // 一覧
  const top = await (await get(hub, "/")).text();
  assert.ok(top.includes("tax-app") && top.includes("題 login v1"));
  assert.ok(top.includes('href="/tax-app/login/index.html"') && top.includes('href="/p/tax-app/"'));
  const proj = await (await get(hub, "/tax-app/")).text();
  assert.ok(proj.includes('href="/tax-app/login/index.html"') && proj.includes("すべてのプロジェクト"));
  assert.equal((await get(hub, "/p/tax-app/")).status, 200);

  // 回答前: 取り出しは 204、状態は未回答
  assert.equal((await get(hub, "/api/answer?project=tax-app&topic=login&unread=1")).status, 204);
  assert.deepEqual(await (await get(hub, "/api/status?project=tax-app&topic=login&version=1")).json(), { answered: false, seen: false, waiting: false });

  // 画面からの回答 (cookie + 同一オリジン)
  const ans = await post(hub, "/api/answer", { project: "tax-app", topic: "login", version: 1, text: "回答: A 案", answers: { topic: "login", version: 1, questions: [] } }, jar(hub));
  assert.equal(ans.status, 200);
  assert.ok(fs.existsSync(path.join(hub.root, ".hub", "tax-app", "login", "v1.answer.md")));
  assert.ok(fs.existsSync(path.join(hub.root, ".hub", "tax-app", "login", "v1.answer.json")));
  assert.equal((await post(hub, "/api/answer", { project: "tax-app", topic: "login", version: 1, text: "x" }, { ...jar(hub), Origin: "http://evil.example" })).status, 403);
  assert.deepEqual(await (await get(hub, "/api/status?project=tax-app&topic=login&version=1")).json(), { answered: true, seen: false, waiting: false });

  // 取り出し → 受け取りの印 → 二度目は 204
  const got = await (await get(hub, "/api/answer?project=tax-app&topic=login&unread=1")).json();
  assert.equal(got.answers.length, 1);
  assert.equal(got.answers[0].text.trim(), "回答: A 案");
  assert.equal(got.answers[0].json.version, 1);
  assert.equal((await post(hub, "/api/seen", { project: "tax-app", topic: "login", version: 1, mtimeMs: got.answers[0].mtimeMs })).status, 200);
  assert.equal((await get(hub, "/api/answer?project=tax-app&topic=login&unread=1")).status, 204);
  assert.equal((await get(hub, "/api/answer?project=tax-app&topic=login&version=1")).status, 200); // unread 指定なしなら取り出せる
  assert.equal((await (await get(hub, "/api/status?project=tax-app&topic=login&version=1")).json()).seen, true);
  // 送り直すと、また未読
  await sleep(20);
  await post(hub, "/api/answer", { project: "tax-app", topic: "login", version: 1, text: "回答: B 案" }, jar(hub));
  const again = await (await get(hub, "/api/answer?project=tax-app&unread=1")).json(); // topic 省略 = プロジェクト全体
  assert.equal(again.answers[0].topic, "login");
  assert.equal(again.answers[0].text.trim(), "回答: B 案");
  assert.equal(again.answers[0].json, null);

  // 待ち受けの合図
  assert.equal((await post(hub, "/api/waiting", { project: "tax-app", topic: "login" })).status, 200);
  assert.equal((await (await get(hub, "/api/status?project=tax-app&topic=login&version=1")).json()).waiting, true);
  await post(hub, "/api/waiting", { project: "tax-app", topic: "login", done: true });
  assert.equal((await (await get(hub, "/api/status?project=tax-app&topic=login&version=1")).json()).waiting, false);
  assert.equal((await post(hub, "/api/waiting", { project: "tax-app", topic: "nothing" })).status, 404);
  assert.equal(hub.out.stdout.split("\n").filter((l) => l.includes(hub.key) && !/ハブの鍵|--hub-key|html-qa ハブ|スマホ/.test(l)).length, 0, "鍵がログに出ている");
  assert.equal(hub.out.stderr.includes(hub.key), false);
});

test("鍵なし・違う鍵は拒否される。書き込みは cookie だけでは通らない", async () => {
  const hub = await startHub("auth");
  const body = { project: "pj", topic: "t", version: 1, html: "<p>x</p>" };
  for (const headers of [{}, { "X-Html-Qa-Key": "wrong-key-wrong-key-wrong-key-12345" }, { "X-Html-Qa-Key": "" }, { "X-Html-Qa-Key": hub.key.slice(1) }]) {
    assert.equal((await post(hub, "/api/publish", body, headers)).status, 401, JSON.stringify(headers));
  }
  assert.equal((await post(hub, "/api/publish", body, jar(hub))).status, 401, "cookie だけの publish");
  assert.equal((await post(hub, "/api/waiting", { project: "pj", topic: "t" }, jar(hub))).status, 401);
  assert.equal((await post(hub, "/api/seen", { project: "pj", topic: "t", version: 1, mtimeMs: 1 }, jar(hub))).status, 401);
  assert.equal((await get(hub, "/api/answer?project=pj&topic=t", {})).status, 401);
  assert.equal((await get(hub, "/api/status?project=pj&topic=t&version=1", {})).status, 401);
  assert.equal((await get(hub, "/", {})).status, 401);
  assert.equal((await fetch(`${hub.base}/?key=wrong`, { redirect: "manual" })).status, 401);
  assert.equal((await get(hub, "/api/publish")).status, 405);
  assert.deepEqual(tree(path.join(hub.root, ".hub")), []);
});

test("不正な project / topic / version は断られ、保存先の外には何も書かれない", async () => {
  const hub = await startHub("evil");
  const before = tree(path.dirname(hub.root));
  const bad = ["..", ".", "../x", "a/b", "a\\b", "a/../b", "A", "Ab", "", " ", "-a", "a b", "a\0b", "a%2fb", "__proto__", "constructor.x", "x".repeat(42), "日本語", null, 5, ["a"], { a: 1 }];
  for (const v of bad) {
    for (const [project, topic] of [[v, "t"], ["pj", v]]) {
      const r = await pub(hub, project, topic, 1);
      assert.equal(r.status, 400, `project=${JSON.stringify(project)} topic=${JSON.stringify(topic)}`);
    }
  }
  assert.equal((await pub(hub, "api", "t", 1)).status, 400, "project 名 api は /api/ と衝突するので使えない");
  for (const v of [0, -1, 1.5, "1", null, 10000, 1e9, NaN, true, [1], {}]) assert.equal((await pub(hub, "pj", "t", v)).status, 400, `version=${JSON.stringify(v)}`);
  // json の topic / version が送り先と食い違う・html が空
  assert.equal((await pub(hub, "pj", "t", 1, { json: jdoc("other", 1) })).status, 400);
  assert.equal((await pub(hub, "pj", "t", 1, { json: jdoc("t", 2) })).status, 400);
  assert.equal((await pub(hub, "pj", "t", 1, { html: "" })).status, 400);
  assert.equal((await pub(hub, "pj", "t", 1, { html: 5 })).status, 400);
  assert.equal((await pub(hub, "pj", "t", 1, { json: [] })).status, 400);
  assert.equal((await post(hub, "/api/publish", null)).status, 400);
  assert.equal((await fetch(`${hub.base}/api/publish`, { method: "POST", headers: H(hub, { "Content-Type": "application/json" }), body: "{broken" })).status, 400);
  assert.equal((await fetch(`${hub.base}/api/publish`, { method: "POST", headers: H(hub, { "Content-Type": "text/plain" }), body: "x" })).status, 415);
  // __proto__ を JSON 本文のキーに持たせても無害
  assert.equal((await fetch(`${hub.base}/api/publish`, { method: "POST", headers: H(hub, { "Content-Type": "application/json" }), body: '{"__proto__":{"x":1},"project":"pj","topic":"t","version":1,"html":"<p>ok</p>"}' })).status, 200);
  assert.equal({}.x, undefined);
  // 回答・取り出し・受け取りの印・状態も同じく検証される
  for (const v of ["..", "a/b", "__proto__", "x".repeat(42)]) {
    assert.equal((await post(hub, "/api/answer", { project: v, topic: "t", version: 1, text: "x" }, jar(hub))).status, 400);
    assert.equal((await post(hub, "/api/answer", { project: "pj", topic: v, version: 1, text: "x" }, jar(hub))).status, 400);
    assert.equal((await get(hub, `/api/answer?project=${encodeURIComponent(v)}&topic=t`)).status, 400);
    assert.equal((await get(hub, `/api/answer?project=pj&topic=${encodeURIComponent(v)}`)).status, 400);
    assert.equal((await get(hub, `/api/status?project=${encodeURIComponent(v)}&topic=t&version=1`)).status, 400);
    assert.equal((await post(hub, "/api/seen", { project: "pj", topic: v, version: 1, mtimeMs: 1 })).status, 400);
  }
  assert.equal((await post(hub, "/api/seen", { project: "pj", topic: "t", version: 99999, mtimeMs: 1 })).status, 400);
  assert.equal((await get(hub, "/api/answer?project=pj&topic=t&version=-1")).status, 400);
  assert.equal((await get(hub, "/api/answer?topic=t")).status, 400);
  // 配信でも .. や隠しフォルダには出られない
  for (const p of ["/pj/%2e%2e/%2e%2e/.key", "/pj/t/..%2f..%2f.key", "/.hub/pj/t/v1.html", "/pj/.hub/t/v1.html", "/pj/t/.waiting.json", "/pj/t/%00", "/pj/t/v1.html%00.png", "/pj/t/..%5c..%5c.key", "/pj/t/sub/v1.html", "/pj/t/secret.txt", "/%2e%2e/%2e%2e/etc/passwd"]) {
    const r = await get(hub, p);
    assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status}`);
    assert.ok(!(await r.text()).includes(hub.key));
  }
  // 成功した 1 件 (p/t) 以外は何も増えていない
  const after = tree(path.dirname(hub.root)).filter((f) => !before.includes(f));
  assert.deepEqual(after.filter((f) => !f.startsWith(path.join("hub-root", ".hub"))), [], "保存先の外にファイルができた");
  assert.deepEqual(tree(path.join(hub.root, ".hub")).sort(), ["pj", path.join("pj", "t"), path.join("pj", "t", "index.html"), path.join("pj", "t", "v1.html")].sort());
});

test("大きさと数の上限", async () => {
  const hub = await startHub("limits");
  const big = await post(hub, "/api/publish", { project: "pj", topic: "t", version: 1, html: "x".repeat(17 * 1024 * 1024) });
  assert.equal(big.status, 413);
  assert.deepEqual(tree(path.join(hub.root, ".hub")), []);
  assert.equal((await post(hub, "/api/publish", { project: "pj", topic: "t", version: 1, html: "<p>ok</p>", json: { ...jdoc("t", 1), pad: "x".repeat(5 * 1024 * 1024) } })).status, 413);
  assert.equal((await pub(hub, "pj", "t", 9999)).status, 200); // 版の最大
  assert.equal((await pub(hub, "pj", "t", 10000)).status, 400);
  for (let i = 0; i < 300; i++) { const r = await post(hub, "/api/publish", { project: "v", topic: "t", version: i + 1, html: "<p>x</p>" }); if (i < 300) assert.equal(r.status, 200, `v${i + 1}`); }
  assert.equal((await post(hub, "/api/publish", { project: "v", topic: "t", version: 301, html: "<p>x</p>" })).status, 429);
  assert.equal((await post(hub, "/api/publish", { project: "v", topic: "t", version: 5, html: "<p>y</p>" })).status, 200, "既にある版の差し替えは上限に数えない");
  for (let i = 0; i < 199; i++) assert.equal((await post(hub, "/api/publish", { project: "many", topic: `t${i}`, version: 1, html: "<p>x</p>" })).status, 200);
  assert.equal((await post(hub, "/api/publish", { project: "many", topic: "t1000", version: 1, html: "<p>x</p>" })).status, 200); // 200 個目
  assert.equal((await post(hub, "/api/publish", { project: "many", topic: "t2000", version: 1, html: "<p>x</p>" })).status, 429);
  // プロジェクト数 (p, v, many で 3 つ)
  for (let i = 0; i < 47; i++) assert.equal((await post(hub, "/api/publish", { project: `q${i}`, topic: "t", version: 1, html: "<p>x</p>" })).status, 200);
  assert.equal((await post(hub, "/api/publish", { project: "overflow", topic: "t", version: 1, html: "<p>x</p>" })).status, 429);
});

test("2 つのプロジェクトが同じ議題名でも互いを上書きしない。一覧に両方出る", async () => {
  const hub = await startHub("two");
  const a = mkProject("a", "same-topic");
  const b = mkProject("b", "same-topic");
  fs.writeFileSync(path.join(b.dir, "v1.json"), JSON.stringify(jdoc("same-topic", 1, { title: "B の議題" })));
  const ra = register(a, hub, "proj-a"), rb = register(b, hub, "proj-b");
  assert.equal(ra.status, 0, ra.stderr);
  assert.equal(rb.status, 0, rb.stderr);
  assert.equal(runBuild(a, a.rel).status, 0);
  const out = runBuild(b, b.rel);
  assert.equal(out.status, 0, out.stderr);
  // PC 用 URL の形 (ハブの port・鍵つき)。LAN 未登録ならスマホ行は出ない
  assert.match(out.stdout, new RegExp(`  開く: http://localhost:${hub.port}/proj-b/same-topic/\\?key=${hub.key}`));
  assert.ok(!out.stdout.includes("スマホ"));
  const htmlA = (await (await get(hub, "/proj-a/same-topic/v1.html")).text());
  const htmlB = (await (await get(hub, "/proj-b/same-topic/v1.html")).text());
  assert.ok(htmlA.includes("題 same-topic v1") && !htmlA.includes("B の議題"));
  assert.ok(htmlB.includes("B の議題"));
  // 回答も別々
  await post(hub, "/api/answer", { project: "proj-a", topic: "same-topic", version: 1, text: "A への回答" }, jar(hub));
  assert.equal((await get(hub, "/api/answer?project=proj-b&topic=same-topic")).status, 204);
  assert.match(fs.readFileSync(path.join(hub.root, ".hub", "proj-a", "same-topic", "v1.answer.md"), "utf8"), /A への回答/);
  assert.ok(!fs.existsSync(path.join(hub.root, ".hub", "proj-b", "same-topic", "v1.answer.md")));
  // 一覧に 2 プロジェクトが分かれて出る
  const top = await (await get(hub, "/")).text();
  assert.ok(top.includes('href="/p/proj-a/"') && top.includes('href="/p/proj-b/"'));
  assert.ok(top.includes('href="/proj-a/same-topic/index.html"') && top.includes('href="/proj-b/same-topic/index.html"'));
  assert.ok(top.includes("B の議題") && top.includes("回答済み"));
  assert.ok(top.includes('data-filter="waiting"'));
  // スマホ用の URL の元を登録すると、build がスマホ行を出す
  const lan = path.join(hub.root, ".lan.json");
  fs.writeFileSync(lan, JSON.stringify({ url: "http://192.168.1.10:5191" }));
  const out2 = runBuild(b, b.rel);
  assert.match(out2.stdout, new RegExp(`スマホ \\(家庭内 LAN\\): http://192\\.168\\.1\\.10:5191/proj-b/same-topic/\\?key=${hub.key}`));
});

test("build → 回答 → wait.mjs が受け取る。二重には渡さない。待ち受けの合図が画面の状態に出る", async () => {
  const hub = await startHub("flow");
  const a = mkProject("fa", "topic-x");
  const b = mkProject("fb", "topic-x");
  assert.equal(register(a, hub, "pa").status, 0);
  assert.equal(register(b, hub, "pb").status, 0);
  assert.equal(runBuild(a, a.rel).status, 0);
  assert.equal(runBuild(b, b.rel).status, 0);

  const env = { ...process.env, HTML_QA_HUB_POLL_MS: "150" };
  const run = (p, extra = []) => {
    const c = spawn(process.execPath, [WAIT, p.rel, ...extra], { cwd: p.cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    children.add(c);
    const o = { stdout: "", stderr: "", code: null };
    c.stdout.on("data", (d) => { o.stdout += d; });
    c.stderr.on("data", (d) => { o.stderr += d; });
    o.done = new Promise((r) => c.on("exit", (code) => { o.code = code; r(o); }));
    return o;
  };
  const waitA = run(a, ["--timeout-min", "1"]);
  const waitB = run(b, ["--timeout-min", "1"]);
  // 待ち受けの合図が画面の状態に出る
  let waiting = false;
  for (let i = 0; i < 60 && !waiting; i++) { waiting = (await (await get(hub, "/api/status?project=pa&topic=topic-x&version=1")).json()).waiting; if (!waiting) await sleep(50); }
  assert.ok(waiting, "待ち受けの合図が届かない");

  // 画面役: A の議題に回答する (B には回答しない)
  const r = await post(hub, "/api/answer", { project: "pa", topic: "topic-x", version: 1, text: "[html-qa の回答]\n- a: 承認", answers: { topic: "topic-x", version: 1, questions: [{ id: "a", state: "answered", answer: "承認" }] } }, jar(hub));
  assert.equal(r.status, 200);
  const doneA = await waitA.done;
  assert.equal(doneA.code, 0, doneA.stderr);
  assert.ok(doneA.stdout.includes("a: 承認") && doneA.stdout.includes("topic: topic-x / v1"), doneA.stdout);
  assert.ok(fs.existsSync(path.join(a.dir, "v1.answer.md")) && fs.existsSync(path.join(a.dir, "v1.answer.json")), "ローカルに回答が書かれない");
  assert.equal(JSON.parse(fs.readFileSync(path.join(a.dir, "v1.answer.json"), "utf8")).questions[0].answer, "承認");
  // 受け取りの印が画面の状態に出る。待ち受けは終わると消える
  const st = await (await get(hub, "/api/status?project=pa&topic=topic-x&version=1")).json();
  assert.deepEqual({ answered: st.answered, seen: st.seen, waiting: st.waiting }, { answered: true, seen: true, waiting: false });
  assert.equal((await get(hub, "/api/answer?project=pa&topic=topic-x&unread=1")).status, 204);
  // B は A の回答を受け取らず、待ち続けている
  assert.equal(waitB.code, null);
  assert.ok(!fs.existsSync(path.join(b.dir, "v1.answer.md")));
  // もう一度待つと、同じ回答は渡されない (時間切れ = 3)
  const again = run(a, ["--timeout-min", "0.02"]);
  const doneAgain = await again.done;
  assert.equal(doneAgain.code, 3, doneAgain.stdout);
  assert.ok(!doneAgain.stdout.includes("承認"));
  // hook も、読み済みの回答を二度は渡さない
  const hook = spawnSync(process.execPath, [HOOK], { cwd: a.cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: a.cwd }, encoding: "utf8" });
  assert.equal(hook.stdout, "");

  // B に回答 → B の wait が受け取る
  await post(hub, "/api/answer", { project: "pb", topic: "topic-x", version: 1, text: "B の回答" }, jar(hub));
  const doneB = await waitB.done;
  assert.equal(doneB.code, 0);
  assert.ok(doneB.stdout.includes("B の回答") && !doneB.stdout.includes("承認"));
});

test("wait.mjs が動いていないときの回答は、hook が発言に添える (ハブから取り込む)", async () => {
  const hub = await startHub("hook");
  const p = mkProject("h", "topic-h");
  assert.equal(register(p, hub, "ph").status, 0);
  assert.equal(runBuild(p, p.rel).status, 0);
  await post(hub, "/api/answer", { project: "ph", topic: "topic-h", version: 1, text: "hook 経由の回答" }, jar(hub));
  const run = () => spawnSync(process.execPath, [HOOK], { cwd: p.cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: p.cwd }, encoding: "utf8" });
  const first = run();
  assert.equal(first.status, 0);
  assert.match(JSON.parse(first.stdout).hookSpecificOutput.additionalContext, /hook 経由の回答/);
  assert.equal(run().stdout, "", "二度目は渡さない");
  assert.equal((await (await get(hub, "/api/status?project=ph&topic=topic-h&version=1")).json()).seen, true);
});

test("設定が無ければ従来どおりローカルだけ (後方互換)。従来の /<topic>/ もハブ自身の議題として動く", async () => {
  const p = mkProject("legacy", "old-topic");
  const r = runBuild(p, p.rel);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /開く: http:\/\/localhost:5190\/old-topic\/\?key=/);
  assert.ok(!r.stdout.includes("ハブ"));
  assert.ok(fs.existsSync(path.join(p.dir, "v1.html")));
  // ハブとして動いているサーバでも、従来の議題 (ROOT 直下) は今までどおり
  const hub = await startHub("legacy-hub");
  const dir = path.join(hub.root, "old-topic");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "v1.json"), JSON.stringify(jdoc("old-topic", 1)));
  fs.writeFileSync(path.join(dir, "v1.html"), "<p>legacy</p>");
  fs.writeFileSync(path.join(dir, "index.html"), "<p>legacy</p>");
  assert.equal((await get(hub, "/old-topic/")).status, 200);
  assert.equal((await get(hub, "/old-topic/v1.html")).status, 200);
  assert.equal((await post(hub, "/api/answer", { topic: "old-topic", version: 1, text: "従来の回答" }, jar(hub))).status, 200);
  assert.deepEqual(await (await get(hub, "/api/status?topic=old-topic&version=1")).json(), { answered: true, seen: false, waiting: false });
  assert.equal((await get(hub, "/api/latest?topic=old-topic")).status, 200);
  assert.match(fs.readFileSync(path.join(dir, "v1.answer.md"), "utf8"), /従来の回答/);
  // ハブの議題と並んで一覧に出る
  await pub(hub, "tax-app", "login", 1);
  const top = await (await get(hub, "/")).text();
  assert.ok(top.includes("old-topic") && top.includes("tax-app"));
  // 隠しフォルダは従来どおり配らない
  assert.equal((await get(hub, "/.key")).status, 404);
});

test("ハブに送れないときは、ローカルの HTML を作ったうえで △ で理由を出す (終了コード 0)", async () => {
  const hub = await startHub("fail");
  // 起動していない (届かない)
  const dead = await freePort();
  const p = mkProject("down", "t-down");
  const reg = runBuild(p, "--hub-url", `http://127.0.0.1:${dead}`, "--hub-key", hub.key, "--project", "pd");
  assert.equal(reg.status, 0);
  assert.match(reg.stderr, /△.*届きません/);
  const r = runBuild(p, p.rel);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(p.dir, "v1.html")));
  assert.match(r.stderr, /△ ハブに送れませんでした.*届きません/s);
  assert.match(r.stderr, /ローカルの HTML は作りました/);
  assert.ok(!r.stdout.includes("開く:"));
  assert.ok(!r.stdout.includes(hub.key) && !r.stderr.includes(hub.key));
  // 鍵が違う
  const q = mkProject("wrongkey", "t-wk");
  const bad = "x".repeat(32);
  runBuild(q, "--hub-url", hub.base, "--hub-key", bad, "--project", "pw");
  const r2 = runBuild(q, q.rel);
  assert.equal(r2.status, 0, r2.stderr);
  assert.match(r2.stderr, /△ ハブに送れませんでした: ハブの鍵が違います/);
  assert.ok(fs.existsSync(path.join(q.dir, "v1.html")));
  assert.ok(!r2.stderr.includes(bad));
  assert.deepEqual(tree(path.join(hub.root, ".hub")), []);
  // 議題名が長すぎる (ハブは 41 文字まで)
  const longName = "t".repeat(50);
  const l = mkProject("long", longName);
  register(l, hub, "pl");
  const r3 = runBuild(l, l.rel);
  assert.equal(r3.status, 0, r3.stderr);
  assert.match(r3.stderr, /ハブに送れません/);
  // 鍵が違うと wait.mjs は終了コード 4 で分かるようにする
  const w = spawnSync(process.execPath, [WAIT, q.rel, "--timeout-min", "1"], { cwd: q.cwd, encoding: "utf8", env: { ...process.env, HTML_QA_HUB_POLL_MS: "100" }, timeout: 20000 });
  assert.equal(w.status, 4, w.stdout + w.stderr);
  assert.match(w.stdout, /鍵が違います/);
});

test("ハブの登録: .hub.json は 0600 で、--hub off で解除できる。不正な値は断る", async () => {
  const hub = await startHub("reg");
  const p = mkProject("regp", "t-r");
  const r = register(p, hub, "my-proj");
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!r.stdout.includes(hub.key) && !r.stderr.includes(hub.key), "登録の表示に鍵が出ている");
  assert.match(r.stdout, /ハブにつながりました/);
  const f = path.join(p.root, ".hub.json");
  assert.deepEqual(JSON.parse(fs.readFileSync(f, "utf8")), { url: hub.base, key: hub.key, project: "my-proj" });
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
  // 以後は省略できる (project だけ変える)
  assert.equal(runBuild(p, "--project", "renamed").status, 0);
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).project, "renamed");
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).key, hub.key);
  // 不正な値
  for (const args of [["--hub-url", "ftp://x", "--hub-key", hub.key, "--project", "p"], ["--hub-url", hub.base, "--hub-key", "short", "--project", "p"], ["--hub-url", hub.base, "--hub-key", hub.key, "--project", "Bad_Name"], ["--hub-url", hub.base, "--hub-key", hub.key, "--project", "api"], ["--hub", "on"]]) {
    const bad = runBuild(p, ...args);
    assert.equal(bad.status, 2, args.join(" "));
  }
  assert.equal(JSON.parse(fs.readFileSync(f, "utf8")).project, "renamed", "不正な登録で設定が壊れた");
  // 解除すると従来の動きに戻る
  assert.equal(runBuild(p, "--hub", "off").status, 0);
  assert.ok(!fs.existsSync(f));
  const out = runBuild(p, p.rel);
  assert.match(out.stdout, /開く: http:\/\/localhost:5190\/t-r\//);
});


// ---- レビュー指摘 (PR #1594) の修正の試験 ----
const runAsync = (args, { killAfterMs = 0, ...opts } = {}) => new Promise((resolve) => {
  const t0 = Date.now();
  const c = spawn(process.execPath, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  children.add(c);
  if (killAfterMs) setTimeout(() => c.kill("SIGKILL"), killAfterMs); // hook の時間切れを真似る
  const o = { stdout: "", stderr: "", code: null, ms: 0 };
  c.stdout.on("data", (d) => { o.stdout += d; });
  c.stderr.on("data", (d) => { o.stderr += d; });
  c.on("exit", (code) => { o.code = code; o.ms = Date.now() - t0; resolve(o); });
});
const alive = async (hub) => (await get(hub, "/api/ping")).status === 200;

test("鍵の比較: 同じ文字数の非 ASCII・サロゲートペア・空・巨大な値でもサーバは落ちず 401 を返す (ヘッダ・?key=・cookie)", async () => {
  const hub = await startHub("keycmp");
  const k = hub.key;
  const bad = [
    k.slice(0, -1) + "é", // 同じ文字数で UTF-8 では長い
    k.slice(0, -2) + "😀", // サロゲートペア (UTF-16 で 2 文字)
    k.slice(0, -1) + "日",
    "", "x", k + k, "é".repeat(k.length), "é".repeat(6000),
  ];
  for (const v of bad) {
    // ヘッダ
    const h = await fetch(`${hub.base}/api/ping`, { headers: { "X-Html-Qa-Key": v.replace(/[^\x00-\xff]/g, "é") } }).catch((e) => ({ status: `fetch失敗: ${e.message}` }));
    assert.ok([401, 431].includes(h.status) || String(h.status).startsWith("fetch失敗"), `header ${JSON.stringify(v.slice(0, 40))} → ${h.status}`);
    assert.ok(await alive(hub), `ヘッダの値 ${JSON.stringify(v.slice(0, 40))} でサーバが落ちた`);
    // ?key=
    const q = await fetch(`${hub.base}/api/ping?key=${encodeURIComponent(v)}`, { redirect: "manual" }).catch(() => ({ status: 0 }));
    assert.ok([401, 414, 431, 0].includes(q.status), `?key= ${JSON.stringify(v.slice(0, 40))} → ${q.status}`);
    assert.ok(await alive(hub), `?key= の値 ${JSON.stringify(v.slice(0, 40))} でサーバが落ちた`);
    // cookie (latin1 に収まる値だけ送れる)
    const c = await fetch(`${hub.base}/api/ping`, { headers: { Cookie: `html_qa_key=${v.replace(/[^\x00-\xff]/g, "é")}` } }).catch(() => ({ status: 0 }));
    assert.ok([401, 431, 0].includes(c.status), `cookie ${JSON.stringify(v.slice(0, 40))} → ${c.status}`);
    assert.ok(await alive(hub), `cookie の値 ${JSON.stringify(v.slice(0, 40))} でサーバが落ちた`);
  }
  assert.equal((await get(hub, "/api/ping", {})).status, 401);
});

test("不正な形の json は預かれない。保存済みの不正な json があっても一覧は出る。ハンドラが投げてもプロセスは生きている", async () => {
  const hub = await startHub("shape");
  for (const json of [
    { ...jdoc("t", 1), sections: 5 },
    { ...jdoc("t", 1), sections: [{ title: "章", blocks: 5 }] },
    { ...jdoc("t", 1), sections: [{ title: "章", blocks: [{ type: "nonexistent" }] }] },
    { ...jdoc("t", 1), sections: [] },
    { ...jdoc("t", 1), title: "" },
  ]) {
    const r = await post(hub, "/api/publish", { project: "pj", topic: "t", version: 1, html: "<p>x</p>", json });
    assert.equal(r.status, 400, JSON.stringify(json).slice(0, 80));
    assert.equal(JSON.stringify(await r.json()).includes(hub.key), false);
  }
  assert.deepEqual(tree(path.join(hub.root, ".hub")), [], "不正な json が保存された");
  assert.equal((await pub(hub, "pj", "good", 1)).status, 200);
  // すでに保存されてしまった不正な json (手で置いた・古い版が預かった): その議題だけ飛ばして一覧を返す
  for (const [name, content] of [["broken1", '{"topic":"broken1","version":1,"sections":5}'], ["broken2", '{"sections":[{"blocks":5}]}'], ["broken3", "{not json"], ["broken4", "null"]]) {
    const d = path.join(hub.root, ".hub", "pj", name);
    fs.mkdirSync(d, { recursive: true });
    fs.writeFileSync(path.join(d, "v1.json"), content);
    fs.writeFileSync(path.join(d, "v1.html"), "<p>x</p>");
  }
  const top = await get(hub, "/");
  assert.equal(top.status, 200);
  assert.ok((await top.text()).includes("題 good v1"));
  assert.equal((await get(hub, "/p/pj/")).status, 200);
  assert.ok(await alive(hub));
  // 予期しない例外 (v1.html が読めない = EACCES): 500 を返し、鍵やパスは本文に出さず、プロセスは生きている
  const g = path.join(hub.root, ".hub", "pj", "good");
  fs.chmodSync(path.join(g, "v1.html"), 0o000);
  if (process.getuid?.() !== 0) { // root は権限を無視するので、この確認は root 以外のときだけ
    const r = await get(hub, "/pj/good/v1.html");
    assert.equal(r.status, 500);
    const text = await r.text();
    assert.ok(!text.includes(hub.key) && !text.includes(tmp), `エラー本文に機密: ${text}`);
  }
  assert.ok(await alive(hub));
  assert.ok(!hub.out.stderr.includes(hub.key));
  // .hub の中のシンボリックリンク: 配信・/api/latest・/api/status・回答が落ちず、外の物は返さない
  const outside = path.join(tmp, "shape", "outside");
  fs.mkdirSync(outside, { recursive: true });
  fs.writeFileSync(path.join(outside, "v1.html"), "SECRET-OUTSIDE");
  fs.mkdirSync(path.join(hub.root, ".hub", "px"), { recursive: true });
  fs.symlinkSync(outside, path.join(hub.root, ".hub", "px", "linkt"));
  fs.symlinkSync(outside, path.join(hub.root, ".hub", "evilp"));
  for (const p of ["/px/linkt/v1.html", "/px/linkt/", "/evilp/linkt/v1.html", "/api/latest?project=px&topic=linkt", "/api/status?project=px&topic=linkt&version=1", "/api/answer?project=px&topic=linkt", "/api/answer?project=px"]) {
    const x = await get(hub, p);
    assert.ok([403, 404, 400, 204].includes(x.status), `${p} → ${x.status}`);
    assert.ok(!(await x.text()).includes("SECRET-OUTSIDE"));
    assert.ok(await alive(hub), `${p} でサーバが落ちた`);
  }
  assert.ok((await get(hub, "/")).status === 200);
  // 書き込み側もリンクをたどらない
  assert.equal((await pub(hub, "px", "linkt", 1)).status, 403);
  assert.equal((await pub(hub, "evilp", "t", 1)).status, 403);
  assert.deepEqual(fs.readdirSync(outside), ["v1.html"], "リンク先の外に書かれた");
  assert.equal(fs.readFileSync(path.join(outside, "v1.html"), "utf8"), "SECRET-OUTSIDE");
  assert.ok(await alive(hub));
});

test("配信は許可リストの名前だけ。内部のファイルは実在しても返さない", async () => {
  const hub = await startHub("allow");
  assert.equal((await pub(hub, "pj", "t", 1)).status, 200);
  const d = path.join(hub.root, ".hub", "pj", "t");
  for (const f of ["v1.answer.seen", "v1.answer.hub", "v1.html.tmp-123", "secret.txt", "notes.md", "v1.answer.md.bak", "V1.html", "v12345.html"]) fs.writeFileSync(path.join(d, f), "INTERNAL-FILE");
  for (const f of ["v1.answer.seen", "v1.answer.hub", "v1.html.tmp-123", "secret.txt", "notes.md", "v1.answer.md.bak", "V1.html", "v12345.html"]) {
    const x = await get(hub, `/pj/t/${f}`);
    assert.equal(x.status, 404, f);
    assert.ok(!(await x.text()).includes("INTERNAL-FILE"));
  }
  fs.writeFileSync(path.join(d, "v1.answer.md"), "<!-- x -->\n回答");
  assert.equal((await get(hub, "/pj/t/v1.answer.md")).status, 200); // 許可リストにある名前は返す
});

test("hook: ハブの印 (seen) が応答しなくても、回答は先に出力して数秒で終わる。ハブへの印が失敗しても二重には渡さない", async () => {
  const sockets = new Set();
  const fake = http.createServer((req, res) => {
    if (req.url.startsWith("/api/answer")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end(JSON.stringify({ answers: [{ topic: "t-s", version: 1, mtimeMs: 111, seen: false, text: "stall の回答", json: null }] })); }
    if (req.url === "/api/ping") { res.writeHead(200, { "Content-Type": "application/json" }); return res.end('{"ok":true}'); }
    /* /api/seen は接続を受けても返さない */
  });
  fake.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => fake.listen(0, "127.0.0.1", r));
  try {
    const p = mkProject("stall", "t-s");
    fs.writeFileSync(path.join(p.root, ".hub.json"), JSON.stringify({ url: `http://127.0.0.1:${fake.address().port}`, key: "k".repeat(32), project: "ps" }));
    const env = { ...process.env, CLAUDE_PROJECT_DIR: p.cwd };
    const first = await runAsync([HOOK], { cwd: p.cwd, env });
    assert.equal(first.code, 0);
    assert.match(JSON.parse(first.stdout).hookSpecificOutput.additionalContext, /stall の回答/);
    assert.ok(first.ms < 6000, `hook が遅い: ${first.ms}ms`);
    // 印が付かなかった回答が、次の取り込みでまた来ても、渡し直さない
    const second = await runAsync([HOOK], { cwd: p.cwd, env });
    assert.equal(second.stdout, "", "二重に渡された");
    assert.ok(second.ms < 6000);
    // hook が印の途中で時間切れで殺されても、回答はもう出力されている (出力が先)
    const p3 = mkProject("stall3", "t-s");
    fs.writeFileSync(path.join(p3.root, ".hub.json"), JSON.stringify({ url: `http://127.0.0.1:${fake.address().port}`, key: "k".repeat(32), project: "ps" }));
    const killed = await runAsync([HOOK], { cwd: p3.cwd, env: { ...process.env, CLAUDE_PROJECT_DIR: p3.cwd }, killAfterMs: 1200 });
    assert.match(JSON.parse(killed.stdout || "{}").hookSpecificOutput?.additionalContext ?? "", /stall の回答/, "印の待ちの間に殺されると回答が出ていない");
    // wait.mjs も同じ: 出力は先、印の失敗では待たされない
    const w = await runAsync([WAIT, p.rel, "--timeout-min", "0.05"], { cwd: p.cwd, env: { ...process.env, HTML_QA_HUB_POLL_MS: "100" } });
    assert.equal(w.code, 3, w.stdout + w.stderr);
    assert.ok(!w.stdout.includes("stall の回答"));
    // ローカルが未読のところから: wait.mjs は回答を出して 6 秒以内に終わる
    const p2 = mkProject("stall2", "t-s");
    fs.writeFileSync(path.join(p2.root, ".hub.json"), JSON.stringify({ url: `http://127.0.0.1:${fake.address().port}`, key: "k".repeat(32), project: "ps" }));
    const w2 = await runAsync([WAIT, p2.rel, "--timeout-min", "1"], { cwd: p2.cwd, env: { ...process.env, HTML_QA_HUB_POLL_MS: "100" } });
    assert.equal(w2.code, 0, w2.stderr);
    assert.ok(w2.stdout.includes("stall の回答"));
    assert.ok(w2.ms < 8000, `wait が遅い: ${w2.ms}ms`);
    const p4 = mkProject("stall4", "t-s");
    fs.writeFileSync(path.join(p4.root, ".hub.json"), JSON.stringify({ url: `http://127.0.0.1:${fake.address().port}`, key: "k".repeat(32), project: "ps" }));
    const w4 = await runAsync([WAIT, p4.rel, "--timeout-min", "1"], { cwd: p4.cwd, env: { ...process.env, HTML_QA_HUB_POLL_MS: "100" }, killAfterMs: 1200 });
    assert.ok(w4.stdout.includes("stall の回答"), "wait.mjs: 印の待ちの間に殺されると回答が出ていない");
  } finally {
    for (const s of sockets) s.destroy();
    await new Promise((r) => fake.close(r));
  }
});

test("従来の議題とハブのプロジェクトが同名でも、/p/<project>/ からプロジェクトの一覧に行ける。p・projects は project 名にできない", async () => {
  const hub = await startHub("collide");
  const dir = path.join(hub.root, "foo");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "v1.json"), JSON.stringify(jdoc("foo", 1)));
  fs.writeFileSync(path.join(dir, "v1.html"), "<p>LEGACY-FOO</p>");
  fs.writeFileSync(path.join(dir, "index.html"), "<p>LEGACY-FOO</p>");
  assert.equal((await pub(hub, "foo", "bar", 1)).status, 200);
  assert.match(await (await get(hub, "/foo/")).text(), /LEGACY-FOO/); // 従来が勝つ
  const pr = await (await get(hub, "/p/foo/")).text();
  assert.ok(pr.includes("題 bar v1") && pr.includes('href="/foo/bar/index.html"'));
  assert.equal((await get(hub, "/p/foo/index.html")).status, 200);
  assert.equal((await get(hub, "/p/nothere/")).status, 404);
  assert.match(await (await get(hub, "/foo/bar/")).text(), /foo\/bar\/v1/); // 議題そのものはハブ
  const top = await (await get(hub, "/")).text();
  assert.ok(top.includes('href="/p/foo/"') && top.includes('href="/foo/bar/index.html"'));
  for (const name of ["p", "projects", "api"]) assert.equal((await pub(hub, name, "t", 1)).status, 400, name);
});

test("ハブ全体の容量の上限を超えると 507。差し替えや回答は止めない", async () => {
  const hub = await startHub("quota", { env: { HTML_QA_HUB_MAX_BYTES: "300000" } });
  const html = (c) => `<p>${c.repeat(60_000)}</p>`; // index.html の写しも数えるので、1 版は約 12 万バイト
  assert.equal((await post(hub, "/api/publish", { project: "pj", topic: "a", version: 1, html: html("a") })).status, 200);
  assert.equal((await post(hub, "/api/publish", { project: "pj", topic: "b", version: 1, html: html("b") })).status, 200);
  const over = await post(hub, "/api/publish", { project: "pj", topic: "c", version: 1, html: html("c") });
  assert.equal(over.status, 507);
  assert.ok(!fs.existsSync(path.join(hub.root, ".hub", "pj", "c", "v1.html")));
  assert.equal((await post(hub, "/api/answer", { project: "pj", topic: "a", version: 1, text: "回答" }, jar(hub))).status, 200);
  assert.ok(await alive(hub));
});

test("鍵を引数に書かずに登録できる (環境変数・--hub-key-file・標準入力)", async () => {
  const hub = await startHub("keyfile");
  const read = (p) => JSON.parse(fs.readFileSync(path.join(p.root, ".hub.json"), "utf8"));
  const a = mkProject("kf-env");
  const r1 = spawnSync(process.execPath, [BUILD, "--hub-url", hub.base, "--project", "kf-env"], { cwd: a.cwd, encoding: "utf8", env: { ...process.env, HTML_QA_HUB_KEY: hub.key } });
  assert.equal(r1.status, 0, r1.stderr);
  assert.equal(read(a).key, hub.key);
  assert.match(r1.stdout, /ハブにつながりました/);
  const b = mkProject("kf-file");
  const keyFile = path.join(tmp, "keyfile.txt");
  fs.writeFileSync(keyFile, `${hub.key}\n`);
  const r2 = runBuild(b, "--hub-url", hub.base, "--hub-key-file", keyFile, "--project", "kf-file");
  assert.equal(r2.status, 0, r2.stderr);
  assert.equal(read(b).key, hub.key);
  const c = mkProject("kf-stdin");
  const r3 = spawnSync(process.execPath, [BUILD, "--hub-url", hub.base, "--hub-key-file", "-", "--project", "kf-stdin"], { cwd: c.cwd, encoding: "utf8", input: `${hub.key}\n` });
  assert.equal(r3.status, 0, r3.stderr);
  assert.equal(read(c).key, hub.key);
  const d = mkProject("kf-none");
  const r4 = spawnSync(process.execPath, [BUILD, "--hub-url", hub.base, "--project", "kf-none"], { cwd: d.cwd, encoding: "utf8", env: { ...process.env, HTML_QA_HUB_KEY: "" } });
  assert.equal(r4.status, 2);
  assert.ok(!fs.existsSync(path.join(d.root, ".hub.json")));
  assert.equal(runBuild(a, "--hub-url", hub.base, "--hub-key-file", path.join(tmp, "nothing-here"), "--project", "x").status, 2);
  // 起動時の案内の登録コマンドは、鍵を引数に書かない形
  assert.ok(/HTML_QA_HUB_KEY/.test(hub.out.stdout));
  assert.ok(!/--hub-key [A-Za-z0-9_-]{16,}/.test(hub.out.stdout), "案内の登録コマンドに鍵が入っている");
});

test("ハブに無い議題を待つと、分かる文で知らせる。ループバック以外で待つと警告を出す", async () => {
  const hub = await startHub("nowait");
  const p = mkProject("nowait", "not-sent");
  assert.equal(register(p, hub, "pn").status, 0); // build していない = 未送信
  const w = await runAsync([WAIT, p.rel, "--timeout-min", "0.03"], { cwd: p.cwd, env: { ...process.env, HTML_QA_HUB_POLL_MS: "100" } });
  assert.equal(w.code, 3, w.stdout + w.stderr);
  assert.match(w.stderr, /ハブにその議題がありません \(project=pn, topic=not-sent\)。build で publish したか確かめてください/);
  assert.equal((w.stderr.match(/ハブにその議題がありません/g) || []).length, 1, "同じ表示を繰り返している");
  const open = await startHub("open-host", { args: ["--host", "0.0.0.0"] });
  assert.match(open.out.stdout, /0\.0\.0\.0.*LAN/s);
  assert.doesNotMatch(hub.out.stdout, /△/);
});


// ---- 再レビュー (PR #1594 r2) の修正の試験 ----
test("起動の引数: 値の無い・-- 始まり・空の --host / --port などは起動を断る (終了コード 2)", async () => {
  const root = path.join(tmp, "args", "root");
  const port = String(await freePort());
  const run = (...args) => spawnSync(process.execPath, [SERVE, ...(args.includes("--root") ? [] : ["--root", root]), ...args], { cwd: tmp, encoding: "utf8", timeout: 5000, killSignal: "SIGKILL" });
  for (const args of [["--port", port, "--host"], ["--host", "--port", port], ["--port", port, "--host", ""], ["--host", "--port", "1"], ["--port"], ["--port", ""], ["--port", "abc"], ["--port", "70000"], ["--port", port, "--root"], ["--port", port, "--lan-url"]]) {
    const r = run(...args);
    assert.equal(r.status, 2, `${JSON.stringify(args)} → status=${r.status} ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /指定してください|不正/);
  }
  // 正しい指定は通る (起動して ping できる)
  const hub = await startHub("args-ok", { args: ["--host", "127.0.0.1"] });
  assert.ok(await alive(hub));
});

test("容量の数え方: 同じ版を何度上書きしても増えず、index.html の写しも数える", async () => {
  const hub = await startHub("quota2", { env: { HTML_QA_HUB_MAX_BYTES: "300000" } });
  const html = (c) => `<p>${c.repeat(60_000)}</p>`; // 版 + 写し = 約 12 万バイト
  for (let i = 0; i < 8; i++) assert.equal((await post(hub, "/api/publish", { project: "pj", topic: "a", version: 1, html: html("a") })).status, 200, `上書き ${i + 1} 回目`);
  assert.equal((await post(hub, "/api/publish", { project: "pj", topic: "b", version: 1, html: html("b") })).status, 200); // 約 24 万
  // 写しを含めて 36 万になるので断る (写しを数えないと 30 万に収まって通ってしまう)
  assert.equal((await post(hub, "/api/publish", { project: "pj", topic: "c", version: 1, html: html("c") })).status, 507);
  // 古い版 (v1) より新しい版 (v2) を預けると写しは差し替わるので、増えるのは版の分だけ
  assert.equal((await post(hub, "/api/publish", { project: "pj", topic: "a", version: 2, html: `<p>${"x".repeat(50_000)}</p>` })).status, 200);
  assert.ok(await alive(hub));
});

test("版のファイル・プロジェクトのフォルダがシンボリックリンクなら配らず、一覧にも出さない", async () => {
  const hub = await startHub("filelink");
  assert.equal((await pub(hub, "pj", "t", 1)).status, 200);
  const outside = path.join(tmp, "filelink", "outside");
  fs.mkdirSync(path.join(outside, "t"), { recursive: true });
  fs.writeFileSync(path.join(outside, "secret.txt"), "SECRET-FILE");
  fs.writeFileSync(path.join(outside, "t", "v1.html"), "SECRET-HTML");
  fs.writeFileSync(path.join(outside, "t", "v1.json"), JSON.stringify(jdoc("t", 1, { title: "SECRET-TITLE" })));
  fs.writeFileSync(path.join(outside, "ans.md"), "SECRET-ANSWER");
  const d = path.join(hub.root, ".hub", "pj", "t");
  fs.rmSync(path.join(d, "index.html"));
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(d, "index.html"));
  fs.symlinkSync(path.join(outside, "secret.txt"), path.join(d, "v2.html"));
  fs.symlinkSync(path.join(outside, "ans.md"), path.join(d, "v1.answer.md"));
  fs.symlinkSync(outside, path.join(hub.root, ".hub", "linkp"));
  // json がリンクの議題 (題名が外のファイルのもの)
  assert.equal((await pub(hub, "pj", "t2", 1)).status, 200);
  fs.rmSync(path.join(hub.root, ".hub", "pj", "t2", "v1.json"));
  fs.symlinkSync(path.join(outside, "t", "v1.json"), path.join(hub.root, ".hub", "pj", "t2", "v1.json"));
  for (const p of ["/pj/t/", "/pj/t/index.html", "/pj/t/v2.html", "/linkp/", "/linkp/t/", "/linkp/t/v1.html", "/p/linkp/", "/api/answer?project=pj&topic=t", "/api/answer?project=pj", "/api/status?project=pj&topic=t&version=1"]) {
    const x = await get(hub, p);
    const text = await x.text();
    assert.ok(!/secret-/i.test(text), `${p} が外のファイルの中身を返した: ${text.slice(0, 80)}`);
    assert.ok([200, 204, 403, 404].includes(x.status), `${p} → ${x.status}`);
  }
  for (const p of ["/pj/t/", "/pj/t/v2.html", "/linkp/", "/p/linkp/"]) assert.ok([403, 404].includes((await get(hub, p)).status), p);
  const top = await (await get(hub, "/")).text();
  assert.ok(!/secret-|linkp/i.test(top), "一覧に外のものが出た");
  assert.ok(await alive(hub));
  // 通常のファイルは今までどおり
  assert.equal((await get(hub, "/pj/t/v1.html")).status, 200);
  // 回答の保存は、リンクをたどって外のファイルを書き換えない
  assert.equal((await post(hub, "/api/answer", { project: "pj", topic: "t", version: 1, text: "新しい回答" }, jar(hub))).status, 200);
  assert.equal(fs.readFileSync(path.join(outside, "ans.md"), "utf8"), "SECRET-ANSWER");
});

test("リダイレクトを返すハブには従わず、鍵のヘッダを別のオリジンへ持ち出さない", async () => {
  const seen = [];
  const other = http.createServer((req, res) => { seen.push({ url: req.url, key: req.headers["x-html-qa-key"] }); res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); });
  await new Promise((r) => other.listen(0, "127.0.0.1", r));
  const redirector = http.createServer((req, res) => { req.resume(); res.writeHead(302, { Location: `http://127.0.0.1:${other.address().port}${req.url}` }); res.end(); });
  await new Promise((r) => redirector.listen(0, "127.0.0.1", r));
  try {
    const p = mkProject("redir", "t-redir");
    fs.writeFileSync(path.join(p.root, ".hub.json"), JSON.stringify({ url: `http://127.0.0.1:${redirector.address().port}`, key: "k".repeat(32), project: "pr" }));
    const r = runBuildAsync(p);
    const out = await r;
    assert.equal(out.code, 0, out.stderr);
    assert.match(out.stderr, /△ ハブに送れませんでした/);
    assert.deepEqual(seen, [], "リダイレクト先に鍵つきの要求が届いた");
  } finally {
    await new Promise((r) => redirector.close(r));
    await new Promise((r) => other.close(r));
  }
});
const runBuildAsync = (p) => runAsync([BUILD, p.rel], { cwd: p.cwd });

test("json の検査: 型名が Object.prototype のキー・深すぎる入れ子・検査中の例外は 400 で預からない", async () => {
  const hub = await startHub("deep");
  const mk = (type) => ({ ...jdoc("t", 1), sections: [{ title: "章", blocks: [{ type }] }] });
  for (const type of ["toString", "constructor", "__proto__", "hasOwnProperty", "valueOf"]) {
    const r = await post(hub, "/api/publish", { project: "pj", topic: "t", version: 1, html: "<p>x</p>", json: mk(type) });
    assert.equal(r.status, 400, type);
    assert.match((await r.json()).error, /使えません/, type);
  }
  // build.mjs も同じ検査で、落ちずに ✗ を出す
  const p = mkProject("proto", "t-proto");
  fs.writeFileSync(path.join(p.dir, "v1.json"), JSON.stringify({ ...jdoc("t-proto", 1), sections: [{ title: "章", blocks: [{ type: "toString" }] }] }));
  const b = runBuild(p, p.rel);
  assert.equal(b.status, 1);
  assert.match(b.stderr, /✗.*使えません/);
  assert.doesNotMatch(b.stderr, /TypeError|at /);
  // 10 万段の入れ子 (余計なキーの中) は 500 でなく 400
  const depth = 100_000;
  const deep = `${"[".repeat(depth)}${"]".repeat(depth)}`;
  const body = `{"project":"pj","topic":"t","version":1,"html":"<p>x</p>","json":{"topic":"t","version":1,"title":"x","sections":[{"title":"s","blocks":[{"type":"text","md":"m"}]}],"pad":${deep}}}`;
  const r = await fetch(`${hub.base}/api/publish`, { method: "POST", headers: H(hub, { "Content-Type": "application/json" }), body });
  assert.equal(r.status, 400, await r.text());
  assert.deepEqual(tree(path.join(hub.root, ".hub")), []);
  // 回答の構造化データが深すぎても 500 にならない (構造化データは捨て、本文だけ保存する)
  assert.equal((await pub(hub, "pj", "t", 1)).status, 200);
  const ans = await fetch(`${hub.base}/api/answer`, { method: "POST", headers: { ...jar(hub), "Content-Type": "application/json" }, body: `{"project":"pj","topic":"t","version":1,"text":"本文","answers":{"topic":"t","version":1,"deep":${deep}}}` });
  assert.equal(ans.status, 200);
  assert.ok(!fs.existsSync(path.join(hub.root, ".hub", "pj", "t", "v1.answer.json")));
  assert.ok(await alive(hub));
});

test("savePublish: 検査の途中で例外が出ても握りつぶさず、400 で預からない", async () => {
  const { savePublish, HubError } = await import("./hub.mjs");
  const root = path.join(tmp, "inproc");
  // 入れ子の深さの確認 (1 回目の読み取り) は通り、形式の検査 (2 回目以降の読み取り) で例外になる
  let reads = 0;
  const evil = { topic: "t", version: 1, title: "x", sections: [{ title: "s", blocks: [{ get type() { if (reads++ >= 1) throw new Error("検査中の例外"); return "text"; }, md: "m" }] }] };
  assert.throws(() => savePublish(root, { project: "pj", topic: "t", version: 1, html: "<p>x</p>", json: evil }), (e) => e instanceof HubError && e.status === 400);
  assert.ok(!fs.existsSync(path.join(root, ".hub", "pj", "t", "v1.html")), "検査に失敗した議題が保存された");
});
