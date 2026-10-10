#!/usr/bin/env node
/**
 * convert-screens-to-layout — ワークスペース内の旧形式画面 (GrapesJS HTML) を
 * 業務部品の木 (screen.layout) に一括変換する。
 *
 * - 画面 JSON に layout を追加し、HTML にあって items[] に無い入力欄・一覧を画面項目として追加する
 * - 旧デザイン (*.design.json) は消さない (移行期間中は旧デザイナで参照できる)
 * - 既に layout を持つ画面は --force が無ければ飛ばす
 *
 * 使い方:
 *   node scripts/dev/convert-screens-to-layout.mjs <workspace-dir> [--apply] [--force] [--only id1,id2] [--json report.json]
 *   --apply なしは変換結果の要約だけを表示する (dry-run)
 */
import fs from "node:fs";
import path from "node:path";
import { parseDocument } from "htmlparser2";
import render from "dom-serializer";
import { designToLayout, validateLayout } from "@harmony/shared";

const [dir, ...rest] = process.argv.slice(2);
if (!dir) {
  console.error("usage: convert-screens-to-layout.mjs <workspace-dir> [--apply] [--force] [--only a,b] [--json out.json]");
  process.exit(2);
}
const apply = rest.includes("--apply");
const force = rest.includes("--force");
const onlyIdx = rest.indexOf("--only");
const only = onlyIdx >= 0 ? new Set(rest[onlyIdx + 1].split(",")) : null;
const jsonIdx = rest.indexOf("--json");
const jsonOut = jsonIdx >= 0 ? rest[jsonIdx + 1] : null;

const hj = JSON.parse(fs.readFileSync(path.join(dir, "harmony.json"), "utf8"));
const dataDir = path.join(dir, hj.dataDir ?? "harmony");
const screensDir = path.join(dataDir, "screens");

function toSimple(node) {
  if (node.type === "text") return { kind: "text", text: node.data };
  if (node.type === "tag" || node.type === "script" || node.type === "style") {
    return {
      kind: "el",
      tag: node.name.toLowerCase(),
      attrs: { ...node.attribs },
      children: (node.children ?? []).map(toSimple).filter(Boolean),
      outerHTML: render(node, { decodeEntities: false }),
    };
  }
  return null;
}

function loadDesignHtml(screenId, screen) {
  const ref = screen.design?.designFileRef ?? `${screenId}.design.json`;
  const p = path.join(screensDir, ref);
  if (!fs.existsSync(p)) return null;
  const d = JSON.parse(fs.readFileSync(p, "utf8"));
  const comp = d?.pages?.[0]?.frames?.[0]?.component;
  if (!comp) return null;
  if (typeof comp.componentsRef === "string") {
    const hp = path.join(screensDir, comp.componentsRef);
    return fs.existsSync(hp) ? fs.readFileSync(hp, "utf8") : null;
  }
  if (typeof comp.components === "string") return comp.components;
  return null;
}

const files = fs.readdirSync(screensDir).filter((f) => f.endsWith(".json") && !f.includes(".design.") && !f.includes("puck"));
const screens = files.map((f) => JSON.parse(fs.readFileSync(path.join(screensDir, f), "utf8")));
const screenIdByPath = Object.fromEntries(screens.filter((s) => s.path).map((s) => [s.path, s.id]));

const report = [];
for (const f of files) {
  const p = path.join(screensDir, f);
  const screen = JSON.parse(fs.readFileSync(p, "utf8"));
  const id = screen.id ?? f.replace(/\.json$/, "");
  if (only && !only.has(id)) continue;
  if (screen.layout && !force) {
    report.push({ id, skipped: "layout 済み" });
    continue;
  }
  const html = loadDesignHtml(id, screen);
  if (!html) {
    report.push({ id, skipped: "旧デザインなし" });
    continue;
  }
  const doc = parseDocument(html, { decodeEntities: true, lowerCaseAttributeNames: true });
  const roots = doc.children.map(toSimple).filter(Boolean);
  const res = designToLayout(roots, screen.items ?? [], { screenIdByPath, keepShell: screen.purpose === "gadget", screenId: id });
  const items = [...(screen.items ?? []), ...res.newItems];
  const issues = validateLayout(res.layout, items).filter((i) => i.severity !== "info");
  report.push({ id, ...res.stats, newItems: res.newItems.map((i) => i.id), problems: issues.map((i) => i.message) });
  if (apply) {
    const next = { ...screen, items, layout: res.layout };
    fs.writeFileSync(p, JSON.stringify(next, null, 2) + "\n");
  }
}

console.log("画面                       部品  項目  一覧  ボタン  HTML  追加項目  問題");
for (const r of report) {
  if (r.skipped) { console.log(`${r.id.padEnd(26)} (${r.skipped})`); continue; }
  console.log(`${r.id.padEnd(26)} ${String(r.nodes).padStart(4)} ${String(r.fields).padStart(5)} ${String(r.tables).padStart(5)} ${String(r.buttons).padStart(7)} ${String(r.html).padStart(5)} ${String(r.newItems.length).padStart(9)}  ${r.problems.length}`);
}
console.log(apply ? "\n書き込みました" : "\n(dry-run) --apply で書き込みます");
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2));
