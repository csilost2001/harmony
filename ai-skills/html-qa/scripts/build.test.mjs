import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), "build.mjs");
let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "html-qa-test-"));
  process.env.HOME = path.join(tmp, "home"); delete process.env.HTML_QA_HUB_KEY_FILE; // 実際のホームの共有の鍵を読み書きしない (#1595)
});
after(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

const doc = (topic, version, blocks, extra = {}) => ({ topic, version, title: `題 ${topic} v${version}`, lead: "要旨", sections: [{ title: "章", blocks }], ...extra });
const mk = (name) => { const root = path.join(tmp, name); const dir = path.join(root, "t1"); fs.mkdirSync(dir, { recursive: true }); return { root, dir }; };
const write = (dir, v, d) => fs.writeFileSync(path.join(dir, `v${v}.json`), JSON.stringify(d));
const build = (dir) => spawnSync(process.execPath, [BUILD, dir], { cwd: tmp, encoding: "utf8" });
const meta = (file) => JSON.parse(fs.readFileSync(file, "utf8").match(/id="qa-meta">(.*?)<\/script>/s)[1]);

test("mermaid と ref を使った版が作れる", () => {
  const { dir } = mk("ok");
  write(dir, 1, doc("t1", 1, [{ type: "mermaid", code: "flowchart LR\n A-->B", caption: "図" }, { type: "details", title: "d", blocks: [{ type: "mermaid", code: "graph TD\n A-->B" }] }, { type: "choice", id: "a", q: "A?", ref: "screen:login", options: ["x", "y"] }]));
  const r = build(dir);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(fs.existsSync(path.join(dir, "v1.html")));
});

test("mermaid の code が無い・ref が文字列でないと終了コード 1", () => {
  const a = mk("bad1"); write(a.dir, 1, doc("t1", 1, [{ type: "mermaid" }]));
  const ra = build(a.dir); assert.equal(ra.status, 1); assert.match(ra.stderr, /code が必要/);
  const b = mk("bad2"); write(b.dir, 1, doc("t1", 1, [{ type: "input", id: "a", q: "A?", ref: 3 }]));
  const rb = build(b.dir); assert.equal(rb.status, 1); assert.match(rb.stderr, /ref は文字列/);
});

test("v2.html の qa-meta に全版の history が入る", () => {
  const { dir } = mk("hist");
  write(dir, 1, doc("t1", 1, [{ type: "choice", id: "a", q: "A?", options: ["x", { label: "y" }] }, { type: "review", id: "r", q: "R?", items: [{ id: "i1", title: "項目1" }] }], { decisions: [{ title: "決定1" }] }));
  fs.writeFileSync(path.join(dir, "v1.answer.json"), JSON.stringify({ topic: "t1", version: 1, sentAt: "X", questions: [{ id: "a", state: "answered", answer: "ひみつ A", note: "n" }, { id: "gone", state: "answered", answer: "消えた回答", note: "メモ二" }] }));
  write(dir, 2, doc("t1", 2, [{ type: "input", id: "b", q: "B?" }, { type: "input", id: "a", q: "A?" }]));
  assert.equal(build(dir).status, 0);
  const m = meta(path.join(dir, "v2.html"));
  assert.deepEqual(m.history.map((h) => h.version), [1, 2]);
  assert.deepEqual(m.history[0].decisions, ["決定1"]);
  assert.deepEqual(m.history[0].questions, [{ id: "a", type: "choice", q: "A?", opts: ["x", "y"] }, { id: "r", type: "review", q: "R?", opts: ["項目1"] }]);
  // 現ページ (v2) にある質問 a の回答は埋め込まれず、消えた質問 gone の回答だけが残る。全文 (note) は入らない
  assert.deepEqual(m.history[0].answers, { questions: [{ id: "gone", state: "answered", answer: "消えた回答" }] });
  assert.equal(m.history[1].answers, null);
  const html = fs.readFileSync(path.join(dir, "v2.html"), "utf8");
  assert.ok(!html.includes("ひみつ A") && !html.includes("メモ二"));
});

test("議題一覧 index.html に検索用のデータが入る", () => {
  const { root, dir } = mk("idx");
  write(dir, 1, doc("t1", 1, [{ type: "input", id: "a", q: "ＡＢＣ質問?" }]));
  fs.writeFileSync(path.join(dir, "v1.answer.md"), "<!-- x -->\n回答: ひみつの言葉\n");
  assert.equal(build(dir).status, 0);
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const data = JSON.parse(html.match(/id="qa-index">(.*?)<\/script>/s)[1]);
  assert.equal(data.length, 1);
  assert.equal(data[0].answered, true);
  assert.ok(data[0].h.includes("abc質問?") && data[0].h.includes("ひみつの言葉"));
  assert.match(html, /id="qs"/);
});

// ---- #1599: 版を重ねても軽くする ----
const qdoc = (file) => JSON.parse(fs.readFileSync(file, "utf8").match(/id="qa-doc">(.*?)<\/script>/s)[1]);

test("newDecisions を前の版の累積に足して、画面の決定にする。decisions を書いた従来の JSON も同じに動く (#1599)", () => {
  const { dir } = mk("dec");
  write(dir, 1, doc("t1", 1, [{ type: "input", id: "a", q: "A?" }]));
  write(dir, 2, doc("t1", 2, [{ type: "input", id: "a", q: "A?" }], { newDecisions: [{ title: "決定A" }, { title: "決定B", md: "理由" }] }));
  write(dir, 3, doc("t1", 3, [{ type: "input", id: "a", q: "A?" }], { newDecisions: [{ title: "決定C" }, { title: "決定A", md: "言い直し" }] }));
  assert.equal(build(dir).status, 0);
  assert.deepEqual(qdoc(path.join(dir, "v2.html")).decisions.map((d) => [d.title, d.since]), [["決定A", 2], ["決定B", 2]]);
  assert.deepEqual(qdoc(path.join(dir, "v3.html")).decisions.map((d) => [d.title, d.since]), [["決定B", 2], ["決定C", 3], ["決定A", 3]], "同じ題の決定は、新しい版のもので置き換える");
  // 従来: decisions に全部書く。そのあとの newDecisions はそれに足す
  write(dir, 4, doc("t1", 4, [{ type: "input", id: "a", q: "A?" }], { decisions: [{ title: "全部書いた1", since: 1 }, { title: "全部書いた2", since: 3 }], newDecisions: [{ title: "決定D" }] }));
  assert.equal(build(dir).status, 0);
  assert.deepEqual(qdoc(path.join(dir, "v4.html")).decisions.map((d) => d.title), ["全部書いた1", "全部書いた2", "決定D"]);
  assert.ok(!("newDecisions" in qdoc(path.join(dir, "v4.html"))));
});

test("入力が変わらない版は作り直さない。新しい版を足しても、古い版の HTML は変わらない。index.html は転送ページ (#1599)", () => {
  const { dir } = mk("inc");
  write(dir, 1, doc("t1", 1, [{ type: "input", id: "a", q: "A?" }]));
  write(dir, 2, doc("t1", 2, [{ type: "input", id: "a", q: "A?" }, { type: "input", id: "b", q: "B?" }], { newDecisions: [{ title: "決定A" }] }));
  const r1 = build(dir); assert.equal(r1.status, 0, r1.stderr);
  assert.match(r1.stdout, /作り直した版: v1・v2/);
  const h1 = fs.readFileSync(path.join(dir, "v1.html"), "utf8");
  const old = new Date(Date.now() - 3600_000);
  fs.utimesSync(path.join(dir, "v1.html"), old, old); fs.utimesSync(path.join(dir, "v2.html"), old, old);
  const r2 = build(dir); assert.equal(r2.status, 0);
  assert.match(r2.stdout, /変更なし/);
  assert.equal(fs.statSync(path.join(dir, "v1.html")).mtimeMs, old.getTime(), "変わっていない版は書かない");
  assert.equal(fs.statSync(path.join(dir, "v2.html")).mtimeMs, old.getTime());
  // v3 を足す: v1・v2 は書き換わらない
  write(dir, 3, doc("t1", 3, [{ type: "input", id: "c", q: "C?" }]));
  const r3 = build(dir); assert.equal(r3.status, 0);
  assert.match(r3.stdout, /作り直した版: v3。ほかの 2 版は変更なし/);
  assert.equal(fs.readFileSync(path.join(dir, "v1.html"), "utf8"), h1, "古い版の HTML は、新しい版を足しても変わらない");
  assert.equal(fs.statSync(path.join(dir, "v1.html")).mtimeMs, old.getTime());
  // 各版が知っているのは、自分と前の版だけ
  assert.deepEqual(meta(path.join(dir, "v1.html")).versions.map((v) => v.version), [1]);
  assert.deepEqual(meta(path.join(dir, "v2.html")).history.map((h) => h.version), [1, 2]);
  assert.equal(meta(path.join(dir, "v2.html")).latest, 2);
  // 前の版の回答が届いたら、その後の版だけが作り直される
  fs.writeFileSync(path.join(dir, "v2.answer.json"), JSON.stringify({ topic: "t1", version: 2, questions: [{ id: "gone", state: "answered", answer: "x" }] }));
  const r4 = build(dir); assert.equal(r4.status, 0);
  assert.match(r4.stdout, /作り直した版: v3/);
  assert.equal(fs.statSync(path.join(dir, "v1.html")).mtimeMs, old.getTime());
  const idx = fs.readFileSync(path.join(dir, "index.html"), "utf8");
  assert.match(idx, /url=v3\.html/);
  assert.ok(idx.length < 600, "index.html は小さな転送ページ");
});
