#!/usr/bin/env node
/**
 * 性能の確認用に、examples のプロジェクトを N 倍に増やした大きなワークスペースを作る。
 *   node scripts/dev/make-large-workspace.mjs <元のプロジェクト> <出力先> <倍数>
 *   例: node scripts/dev/make-large-workspace.mjs examples/retail .tmp/perf/retail-x20 20
 * テーブル・画面・処理フローを、id / uuid / 物理名に連番を付けて複製する (参照は元のまま)。性能の測定用で、設計としての整合は保証しない。
 * 出力先は .tmp/ 配下に置くこと (git 管理外)。
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [src, out, nArg] = process.argv.slice(2);
const copies = Number(nArg);
if (!src || !out || !Number.isInteger(copies) || copies < 1) {
  console.error("使い方: node scripts/dev/make-large-workspace.mjs <元のプロジェクト> <出力先> <倍数>");
  process.exit(2);
}
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(src, out, { recursive: true, filter: (p) => !p.split(path.sep).includes("generated") });

const manifest = JSON.parse(fs.readFileSync(path.join(src, "harmony.json"), "utf-8"));
const dataDir = path.join(out, manifest.dataDir ?? "harmony");

/** 一覧 (harmony.json の entities) へ登録する。登録が無い実体は設計書にも検査にも含まれない */
const REGISTRY = { tables: "tables", screens: "screens", "process-flows": "processFlows" };
const registered = [];
let made = 0;
for (const kind of ["tables", "screens", "process-flows"]) {
  const dir = path.join(dataDir, kind);
  if (!fs.existsSync(dir)) continue;
  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith(".json"))) {
    const base = JSON.parse(fs.readFileSync(path.join(dir, file), "utf-8"));
    for (let n = 1; n <= copies; n++) {
      const copy = structuredClone(base);
      const holder = copy.meta ?? copy;
      const id = `${holder.id}-p${n}`;
      holder.id = id;
      holder.uuid = crypto.randomUUID();
      if (holder.name) holder.name = `${holder.name} (複製 ${n})`;
      if (copy.physicalName) copy.physicalName = `${copy.physicalName}_p${n}`;
      fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(copy, null, 2));
      const list = manifest.entities?.[REGISTRY[kind]];
      const entry = list?.find((e) => e.id === base.id || e.id === base.meta?.id);
      if (entry) registered.push([REGISTRY[kind], { ...entry, id, no: (list.length + registered.filter(([k]) => k === REGISTRY[kind]).length + 1), name: holder.name, ...(entry.physicalName ? { physicalName: copy.physicalName } : {}) }]);
      made++;
    }
  }
}
const outManifest = structuredClone(manifest);
for (const [key, entry] of registered) outManifest.entities[key].push(entry);
fs.writeFileSync(path.join(out, "harmony.json"), JSON.stringify(outManifest, null, 2));
console.log(`${out}: ${made} 件を複製しました (倍数 ${copies})`);
