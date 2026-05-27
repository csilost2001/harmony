#!/usr/bin/env node
/**
 * Astro 5 の増分 build cache (.astro/) が stale state になると、同一 source pattern
 * の md ファイルでも特定ファイルの link resolution が壊れる現象を防止するため、
 * `npm run build` の前段で cache / 出力ディレクトリを毎回 clear する。
 *
 * 対象 (docs-site/ を cwd として実行):
 *   .astro/            — Astro 増分 build cache
 *   dist/              — Astro build 中間出力 (通常は docs/html/ に移動済だが念のため)
 *   node_modules/.astro/ — vite / rollup の内部 cache
 *
 * 削除対象が存在しない場合もエラーにせず continue する (force: true)。
 *
 * 背景: ISSUE #1366 / PR #1367 Round 2 で発覚。
 */

import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
// docs-site/ ディレクトリ (このスクリプトは docs-site/scripts/ に置かれる)
const DOCS_SITE = join(__dirname, '..');

const targets = [
  join(DOCS_SITE, '.astro'),
  join(DOCS_SITE, 'dist'),
  join(DOCS_SITE, 'node_modules', '.astro'),
];

for (const target of targets) {
  rmSync(target, { recursive: true, force: true });
}

console.log('[clean-build-cache] removed: .astro/, dist/, node_modules/.astro/');
