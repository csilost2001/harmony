#!/usr/bin/env node
/**
 * no-unconditional-e2e-skip — 理由のない (常に skip される) E2E の試験を置かない。
 * `test.skip("題名", ...)` / `test.describe.skip` / `test.fixme` は、中身のない・動かない試験が、通ったように見えるまま残る。
 * 要らない試験は消し、理由 (仕様で対象外など) はコメントに書く。条件つきの skip (`test.skip(!backendRunning, "理由")`、`if (...) test.skip(true, "理由")`) は使ってよい。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BAD = /\b(?:test|it)\.(?:describe\.)?skip\(\s*["'`]|\btest\.describe\.skip\b|\btest\.fixme\b/;
const hits = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") walk(p); continue; }
    if (!/\.spec\.ts$/.test(e.name)) continue;
    fs.readFileSync(p, "utf8").split("\n").forEach((line, i) => {
      if (/^\s*(\/\/|\*)/.test(line)) return;
      if (BAD.test(line)) hits.push(`${path.relative(root, p)}:${i + 1}: ${line.trim()}`);
    });
  }
})(path.join(root, "frontend", "e2e"));
if (hits.length) { console.error(`理由のない skip が ${hits.length} 件あります (要らない試験は消す):\n${hits.join("\n")}`); process.exit(1); }
console.log("理由のない E2E の skip: 0 件");
