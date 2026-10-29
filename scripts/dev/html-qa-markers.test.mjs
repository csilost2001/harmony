import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { parseRef, toMarkers } from "./html-qa-markers.mjs";

const doc = { topic: "t1", version: 2, sections: [{ title: "s", blocks: [{ type: "review", id: "rv", q: "R?", ref: "processFlow:pf#s0", items: [{ id: "a", title: "A", ref: "screen:scr" }, { id: "b", title: "B" }, { id: "c", title: "C" }] }] }] };
const base = { topic: "t1", version: 2 };

test("parseRef: 3 つの形と誤り", () => {
  assert.deepEqual(parseRef("screen:login"), { entityType: "screen", entityId: "login" });
  assert.deepEqual(parseRef("processFlow:order-entry#step-3"), { entityType: "processFlow", entityId: "order-entry", stepId: "step-3" });
  assert.deepEqual(parseRef("table:orders@$.columns[col-02]"), { entityType: "table", entityId: "orders", fieldPath: "$.columns[col-02]" });
  assert.ok(parseRef("foo:x").error); assert.ok(parseRef("screen:x#s").error); assert.ok(parseRef("table:x@columns").error); assert.ok(parseRef("nocolon").error);
});

test("toMarkers: answered / delegate / defer / open", () => {
  const { markers, skipped, errors } = toMarkers(null, { ...base, questions: [
    { id: "q1", n: 1, q: "認証は?", ref: "screen:login", state: "answered", answer: "SSO", note: "理由あり" },
    { id: "q2", n: 2, q: "通知は?", ref: "processFlow:pf1#st-2", state: "delegate", recommended: ["メール"] },
    { id: "q3", n: 3, q: "時期は?", ref: "table:orders@$.columns[c1]", state: "defer" },
    { id: "q4", n: 4, q: "未回答", ref: "screen:x", state: "open" },
    { id: "q5", n: 5, q: "ref なし", state: "answered", answer: "x" }] });
  assert.deepEqual(errors, []); assert.deepEqual(skipped, ["Q5 (q5)"]);
  assert.equal(markers.length, 3);
  assert.deepEqual(markers[0], { entityType: "screen", entityId: "login", kind: "todo", author: "human", body: "[html-qa t1 v2 q1]\n認証は?\n回答: SSO\n補足: 理由あり" });
  assert.deepEqual([markers[1].kind, markers[1].author, markers[1].stepId], ["todo", "human", "st-2"]);
  assert.match(markers[1].body, /おまかせ \(推奨: メール\)/);
  assert.deepEqual([markers[2].kind, markers[2].author, markers[2].fieldPath], ["question", "ai", "$.columns[c1]"]);
});

test("toMarkers: review は項目ごと。項目 ref → 質問 ref の順、未判断は出さない", () => {
  const { markers, skipped } = toMarkers(doc, { ...base, questions: [{ id: "rv", n: 1, type: "review", q: "R?", state: "answered", answer: "…", items: [
    { id: "a", title: "A", ref: "screen:scr", judgement: "ok", note: "良い" },
    { id: "b", title: "B", judgement: "hold" },
    { id: "c", title: "C", judgement: null }] }] });
  assert.deepEqual(skipped, []);
  assert.equal(markers.length, 2);
  assert.deepEqual([markers[0].entityType, markers[0].kind, markers[0].author], ["screen", "todo", "human"]);
  assert.equal(markers[0].body, "[html-qa t1 v2 rv/a]\nR?\n採用: A\nコメント: 良い");
  assert.deepEqual([markers[1].entityType, markers[1].stepId, markers[1].kind, markers[1].author], ["processFlow", "s0", "question", "ai"]);
  assert.match(markers[1].body, /保留: B/);
});

test("toMarkers: review でも defer / delegate は質問単位 1 件 (項目の判断は出さない)", () => {
  const items = [{ id: "a", title: "A", ref: "screen:scr", judgement: "ng" }, { id: "b", title: "B", judgement: "ok" }];
  const d = toMarkers(doc, { ...base, questions: [{ id: "rv", n: 1, type: "review", q: "R?", state: "defer", items }] }).markers;
  assert.equal(d.length, 1);
  assert.deepEqual([d[0].entityType, d[0].stepId, d[0].kind, d[0].author], ["processFlow", "s0", "question", "ai"]);
  assert.ok(!d[0].body.includes("不採用"));
  const g = toMarkers(doc, { ...base, questions: [{ id: "rv", n: 1, type: "review", q: "R?", state: "delegate", items }] }).markers;
  assert.equal(g.length, 1);
  assert.deepEqual([g[0].kind, g[0].author], ["todo", "human"]);
  assert.match(g[0].body, /おまかせ/);
  assert.equal(toMarkers(doc, { ...base, questions: [{ id: "rv", n: 1, type: "review", q: "R?", state: "open", items }] }).markers.length, 0);
});

test("toMarkers: ref の誤りは errors に集める", () => {
  const { errors } = toMarkers(null, { ...base, questions: [{ id: "q1", n: 1, q: "x", ref: "bogus:x", state: "answered", answer: "a" }, { id: "q2", n: 2, q: "y", ref: "table:t@bad", state: "answered", answer: "a" }] });
  assert.equal(errors.length, 2);
});

test("CLI: 回答が無いと 2、誤りは 1、正常は JSON", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "html-qa-markers-"));
  try {
    const cli = path.join(path.dirname(fileURLToPath(import.meta.url)), "html-qa-markers.mjs");
    const run = (...a) => spawnSync(process.execPath, [cli, ...a], { encoding: "utf8" });
    const dir = path.join(tmp, "t1"); fs.mkdirSync(dir);
    assert.equal(run(dir).status, 2);
    assert.match(run(dir).stderr, /answer\.json\) がありません/);
    const ans = (ref) => fs.writeFileSync(path.join(dir, "v1.answer.json"), JSON.stringify({ topic: "t1", version: 1, questions: [{ id: "q1", n: 1, q: "Q?", ref, state: "answered", answer: "A" }] }));
    ans("zzz:x"); const bad = run(dir); assert.equal(bad.status, 1); assert.equal(bad.stdout, ""); assert.match(bad.stderr, /✗/);
    ans("view:v1"); const ok = run(dir, "--version", "1"); assert.equal(ok.status, 0); assert.equal(JSON.parse(ok.stdout)[0].entityId, "v1");
    assert.equal(run("--help").status, 0);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});
