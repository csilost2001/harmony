#!/usr/bin/env node
/**
 * no-undefined-bootstrap-classes — 画面のコード (frontend/src の .tsx) が使っている Bootstrap 風のクラス名
 * (`btn btn-sm` / `form-control` / `row g-2` / `mb-2` / `text-muted` など) が、CSS のどこかで定義されていることを検査する。
 *
 * Bootstrap の CSS 本体は読み込んでいないため、定義の無いクラスはブラウザの既定の見た目になる (太い灰色の枠・角ばったボタンなど)。
 * 新しく使いたいクラスは、frontend/src/styles/bootstrapCompat.css に足すか、画面ごとの CSS を書く。
 *
 * 使い方: node scripts/verify/no-undefined-bootstrap-classes.mjs   (終了コード 0 = 問題なし / 1 = 定義の無いクラスがある)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../frontend/src");
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const files = walk(root);

// Bootstrap のクラス名として確実なものだけを対象にする (画面ごとの独自クラスは対象外)
const BOOTSTRAP = /^(btn|btn-[a-z-]+|form-(control|select|label|text|group|check|check-input|check-label|control-sm|select-sm|label-sm)|input-group(-[a-z]+)?|row|col|col-(auto|\d+|(sm|md|lg)-\d+)|g[xy]?-\d|[mp][trblxy]?-(\d|auto)|d-(flex|block|inline-flex|inline|none|inline-block)|flex-(wrap|column|row|grow-\d|shrink-\d|nowrap)|align-(items|self)-[a-z]+|justify-content-[a-z]+|gap-\d|fw-[a-z]+|fs-\d|small|lead|text-(muted|danger|warning|success|secondary|primary|info|dark|white|center|start|end|truncate|decoration-none|bg-[a-z]+)|bg-(secondary|danger|success|info|warning|primary|light|dark)|badge|alert(-[a-z]+)?|spinner(-[a-z]+(-sm)?)?|list-group(-[a-z]+)?|modal(-[a-z-]+)?|border|rounded|w-\d+|h-\d+|visually-hidden|float-[a-z]+)$/;

const used = new Map();
for (const f of files.filter((n) => n.endsWith(".tsx") && !n.includes(".test."))) {
  const s = fs.readFileSync(f, "utf8");
  for (const m of s.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
    const txt = (m[1] ?? m[2] ?? "").replace(/\$\{[^}]*\}/g, " ");
    for (const c of txt.split(/\s+/).filter(Boolean)) if (BOOTSTRAP.test(c)) used.set(c, (used.get(c) ?? new Set()).add(path.relative(root, f)));
  }
}
const css = files.filter((n) => n.endsWith(".css")).map((n) => fs.readFileSync(n, "utf8")).join("\n");
const defined = new Set([...css.matchAll(/\.([A-Za-z_][\w-]*)/g)].map((m) => m[1]));
const missing = [...used].filter(([c]) => !defined.has(c));
if (missing.length) {
  console.error("定義の無い Bootstrap 風のクラスがあります (ブラウザの既定の見た目になります):");
  for (const [c, fs_] of missing) console.error(`  .${c}  ← ${[...fs_].slice(0, 3).join(", ")}`);
  console.error("\nfrontend/src/styles/bootstrapCompat.css に足すか、画面ごとの CSS を書いてください。");
  process.exit(1);
}
console.log(`OK: 使用中の Bootstrap 風のクラス ${used.size} 個は、すべて CSS で定義されています`);
