// html-qa ハブ (#1590) の試験。ハブ (serve.mjs) を一時ポート・一時ディレクトリで起動して、プロジェクト役の build / wait と通しで確かめる。
// 起動したサーバは after() で必ず止める (ポートを残さない)。
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BUILD = path.join(HERE, "build.mjs");
const SERVE = path.join(HERE, "serve.mjs");
const WAIT = path.join(HERE, "wait.mjs");
const HOOK = path.join(HERE, "hook-inject.mjs");

let tmp;
const children = new Set();
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "html-qa-hub-")); });
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
async function startHub(name) {
  const root = path.join(tmp, name, "hub-root");
  const port = await freePort();
  const child = spawn(process.execPath, [SERVE, "--root", root, "--port", String(port)], { cwd: tmp, stdio: ["ignore", "pipe", "pipe"] });
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
  assert.ok(top.includes("tax-app") && top.includes("題 login v1") && top.includes("login/index.html") && top.includes('href="/tax-app/login/index.html"') === false);
  assert.ok(top.includes('href="tax-app/login/index.html"'));
  const proj = await (await get(hub, "/tax-app/")).text();
  assert.ok(proj.includes('href="login/index.html"') && proj.includes("すべてのプロジェクト"));

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
  const body = { project: "p", topic: "t", version: 1, html: "<p>x</p>" };
  for (const headers of [{}, { "X-Html-Qa-Key": "wrong-key-wrong-key-wrong-key-12345" }, { "X-Html-Qa-Key": "" }, { "X-Html-Qa-Key": hub.key.slice(1) }]) {
    assert.equal((await post(hub, "/api/publish", body, headers)).status, 401, JSON.stringify(headers));
  }
  assert.equal((await post(hub, "/api/publish", body, jar(hub))).status, 401, "cookie だけの publish");
  assert.equal((await post(hub, "/api/waiting", { project: "p", topic: "t" }, jar(hub))).status, 401);
  assert.equal((await post(hub, "/api/seen", { project: "p", topic: "t", version: 1, mtimeMs: 1 }, jar(hub))).status, 401);
  assert.equal((await get(hub, "/api/answer?project=p&topic=t", {})).status, 401);
  assert.equal((await get(hub, "/api/status?project=p&topic=t&version=1", {})).status, 401);
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
    for (const [project, topic] of [[v, "t"], ["p", v]]) {
      const r = await pub(hub, project, topic, 1);
      assert.equal(r.status, 400, `project=${JSON.stringify(project)} topic=${JSON.stringify(topic)}`);
    }
  }
  assert.equal((await pub(hub, "api", "t", 1)).status, 400, "project 名 api は /api/ と衝突するので使えない");
  for (const v of [0, -1, 1.5, "1", null, 10000, 1e9, NaN, true, [1], {}]) assert.equal((await pub(hub, "p", "t", v)).status, 400, `version=${JSON.stringify(v)}`);
  // json の topic / version が送り先と食い違う・html が空
  assert.equal((await pub(hub, "p", "t", 1, { json: jdoc("other", 1) })).status, 400);
  assert.equal((await pub(hub, "p", "t", 1, { json: jdoc("t", 2) })).status, 400);
  assert.equal((await pub(hub, "p", "t", 1, { html: "" })).status, 400);
  assert.equal((await pub(hub, "p", "t", 1, { html: 5 })).status, 400);
  assert.equal((await pub(hub, "p", "t", 1, { json: [] })).status, 400);
  assert.equal((await post(hub, "/api/publish", null)).status, 400);
  assert.equal((await fetch(`${hub.base}/api/publish`, { method: "POST", headers: H(hub, { "Content-Type": "application/json" }), body: "{broken" })).status, 400);
  assert.equal((await fetch(`${hub.base}/api/publish`, { method: "POST", headers: H(hub, { "Content-Type": "text/plain" }), body: "x" })).status, 415);
  // __proto__ を JSON 本文のキーに持たせても無害
  assert.equal((await fetch(`${hub.base}/api/publish`, { method: "POST", headers: H(hub, { "Content-Type": "application/json" }), body: '{"__proto__":{"x":1},"project":"p","topic":"t","version":1,"html":"<p>ok</p>"}' })).status, 200);
  assert.equal({}.x, undefined);
  // 回答・取り出し・受け取りの印・状態も同じく検証される
  for (const v of ["..", "a/b", "__proto__", "x".repeat(42)]) {
    assert.equal((await post(hub, "/api/answer", { project: v, topic: "t", version: 1, text: "x" }, jar(hub))).status, 400);
    assert.equal((await post(hub, "/api/answer", { project: "p", topic: v, version: 1, text: "x" }, jar(hub))).status, 400);
    assert.equal((await get(hub, `/api/answer?project=${encodeURIComponent(v)}&topic=t`)).status, 400);
    assert.equal((await get(hub, `/api/answer?project=p&topic=${encodeURIComponent(v)}`)).status, 400);
    assert.equal((await get(hub, `/api/status?project=${encodeURIComponent(v)}&topic=t&version=1`)).status, 400);
    assert.equal((await post(hub, "/api/seen", { project: "p", topic: v, version: 1, mtimeMs: 1 })).status, 400);
  }
  assert.equal((await post(hub, "/api/seen", { project: "p", topic: "t", version: 99999, mtimeMs: 1 })).status, 400);
  assert.equal((await get(hub, "/api/answer?project=p&topic=t&version=-1")).status, 400);
  assert.equal((await get(hub, "/api/answer?topic=t")).status, 400);
  // 配信でも .. や隠しフォルダには出られない
  for (const p of ["/p/%2e%2e/%2e%2e/.key", "/p/t/..%2f..%2f.key", "/.hub/p/t/v1.html", "/p/.hub/t/v1.html", "/p/t/.waiting.json", "/p/t/%00", "/p/t/v1.html%00.png", "/p/t/..%5c..%5c.key", "/p/t/sub/v1.html", "/p/t/secret.txt", "/%2e%2e/%2e%2e/etc/passwd"]) {
    const r = await get(hub, p);
    assert.ok([400, 403, 404].includes(r.status), `${p} → ${r.status}`);
    assert.ok(!(await r.text()).includes(hub.key));
  }
  // 成功した 1 件 (p/t) 以外は何も増えていない
  const after = tree(path.dirname(hub.root)).filter((f) => !before.includes(f));
  assert.deepEqual(after.filter((f) => !f.startsWith(path.join("hub-root", ".hub"))), [], "保存先の外にファイルができた");
  assert.deepEqual(tree(path.join(hub.root, ".hub")).sort(), ["p", path.join("p", "t"), path.join("p", "t", "index.html"), path.join("p", "t", "v1.html")].sort());
});

test("大きさと数の上限", async () => {
  const hub = await startHub("limits");
  const big = await post(hub, "/api/publish", { project: "p", topic: "t", version: 1, html: "x".repeat(17 * 1024 * 1024) });
  assert.equal(big.status, 413);
  assert.deepEqual(tree(path.join(hub.root, ".hub")), []);
  assert.equal((await post(hub, "/api/publish", { project: "p", topic: "t", version: 1, html: "<p>ok</p>", json: { ...jdoc("t", 1), pad: "x".repeat(5 * 1024 * 1024) } })).status, 413);
  assert.equal((await pub(hub, "p", "t", 9999)).status, 200); // 版の最大
  assert.equal((await pub(hub, "p", "t", 10000)).status, 400);
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
  assert.ok(top.includes('href="/proj-a/"') && top.includes('href="/proj-b/"'));
  assert.ok(top.includes('href="proj-a/same-topic/index.html"') && top.includes('href="proj-b/same-topic/index.html"'));
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
