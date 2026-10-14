#!/usr/bin/env node
/**
 * drag-alternatives — ドラッグ操作を持つ画面が、マウスなしで同じことをする方法を台帳 (drag-alternatives.json) に書いているかを検査する。
 * 新しくドラッグ操作 (dnd-kit・HTML の draggable・react-grid-layout・React Flow) を足したのに台帳に無ければ失敗する。
 * 台帳にあるのにドラッグ操作が無くなったファイルも失敗する (台帳を実際に合わせる)。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const ledger = JSON.parse(fs.readFileSync(path.join(root, "scripts/verify/drag-alternatives.json"), "utf8"));
delete ledger._doc;
const PATTERNS = [/draggable=\{(?!false)/, /draggable: true/, /DndContext/, /useSortable|useDraggable/, /from "react-grid-layout/, /<ReactFlow\b/, /onDragStart=/];

function* files(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules") yield* files(p); }
    else if (/\.(tsx|ts)$/.test(e.name) && !/\.test\.(tsx|ts)$/.test(e.name)) yield p;
  }
}

const found = new Set();
for (const f of files(path.join(root, "frontend/src"))) {
  const src = fs.readFileSync(f, "utf8");
  if (PATTERNS.some((re) => re.test(src))) found.add(path.relative(root, f).split(path.sep).join("/"));
}
const missing = [...found].filter((f) => !(f in ledger)).sort();
const stale = Object.keys(ledger).filter((f) => !found.has(f)).sort();
const empty = Object.entries(ledger).filter(([, v]) => typeof v !== "string" || v.trim().length < 10).map(([k]) => k);
if (missing.length || stale.length || empty.length) {
  for (const f of missing) console.error(`台帳に無い: ${f} (ドラッグ操作があります。マウスなしの代替を scripts/verify/drag-alternatives.json に書いてください)`);
  for (const f of stale) console.error(`台帳にあるが、ドラッグ操作が見つからない: ${f} (台帳から消してください)`);
  for (const f of empty) console.error(`代替の説明が空: ${f}`);
  process.exit(1);
}
console.log(`ドラッグ操作のある ${found.size} ファイルすべてに、マウスなしの代替が書かれています`);
