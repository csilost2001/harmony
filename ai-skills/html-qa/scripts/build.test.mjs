import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BUILD = path.join(path.dirname(fileURLToPath(import.meta.url)), "build.mjs");
let tmp;
before(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), "html-qa-test-")); });
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
  fs.writeFileSync(path.join(dir, "v1.answer.json"), JSON.stringify({ topic: "t1", version: 1, questions: [] }));
  write(dir, 2, doc("t1", 2, [{ type: "input", id: "b", q: "B?" }]));
  assert.equal(build(dir).status, 0);
  const m = meta(path.join(dir, "v2.html"));
  assert.deepEqual(m.history.map((h) => h.version), [1, 2]);
  assert.deepEqual(m.history[0].decisions, ["決定1"]);
  assert.deepEqual(m.history[0].questions, [{ id: "a", type: "choice", q: "A?", opts: ["x", "y"] }, { id: "r", type: "review", q: "R?", opts: ["項目1"] }]);
  assert.equal(m.history[0].answers.version, 1);
  assert.equal(m.history[1].answers, null);
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
