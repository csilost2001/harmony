#!/usr/bin/env node
/**
 * #980-A 再発防止 hook
 *
 * Edit/Write が `frontend/e2e/**\/*.spec.ts` を変更したとき、`[data-testid^="esd-"]` の
 * ボタンを Playwright `locator.click()` で直接叩いていないかチェック。
 *
 * 違反があれば exit 2 で Claude にエラーを返す。Claude は `helpers/editSessionDropdown.ts`
 * の helper (esdClick / openEsdDropdown / attachAsViewer / takeOver / startNewDraft /
 * openHistoryModal) を使うように促される。
 *
 * 入力: stdin に PostToolUse hook の JSON ({ tool_input: { file_path, new_string|content } })
 * 出力: stderr にメッセージ (Claude に表示) + exit code 2
 */
import { readFileSync } from "node:fs";

const data = JSON.parse(readFileSync(0, "utf-8"));
const path = data.tool_input?.file_path ?? "";
if (!/frontend\/e2e\/.*\.spec\.ts$/.test(path)) process.exit(0);

const content = data.tool_input?.new_string ?? data.tool_input?.content ?? "";

// 違反パターン (exec ベースで quote escape の差を吸収):
//   page.getByTestId("esd-toggle-btn").click(...)
//   page.getByTestId('esd-toggle-btn').click(...)
//   page.locator('[data-testid="esd-toggle-btn"]').click(...)
//   page.locator('[data-testid^="esd-takeover-btn-"]').first().click(...)
const PATTERNS = [
  // getByTestId("esd-...").click
  /\.getByTestId\(\s*[\"'`]esd-[a-z0-9-]+[\"'`]\s*\)\s*\.click\(/,
  // locator(...esd-...).click — 緩めに「locator() の中身に esd- を含み、その後 .click() がある」
  /\.locator\(\s*[\"'`][^)]*esd-[a-z0-9-]*[^)]*[\"'`]\s*\)(\s*\.first\(\s*\))?\s*\.click\(/,
];

const violations = content
  .split("\n")
  .map((line, i) => ({ line, lineNum: i + 1 }))
  .filter(({ line }) => {
    if (/^\s*\/\//.test(line)) return false; // skip 行コメント
    return PATTERNS.some((re) => re.test(line));
  });

if (violations.length === 0) process.exit(0);

const msg = [
  `⚠️  #980-A 再発防止: ${path}`,
  `  esd-* ボタンを Playwright locator.click() で直接叩いています:`,
  ...violations.map((v) => `  L${v.lineNum}: ${v.line.trim().slice(0, 120)}`),
  ``,
  `  helpers/editSessionDropdown.ts の helper を使ってください:`,
  `    import { esdClick, openEsdDropdown, attachAsViewer, takeOver, startNewDraft, openHistoryModal } from "../helpers/editSessionDropdown";`,
  ``,
  `  理由: Playwright actionability check が \`.esd-root\` 親 div を拾うため、locator.click() は 180s timeout します。`,
  `  helper は \`page.evaluate(() => btn.click())\` で actionability を bypass しています。`,
  `  詳細: .claude/skills/test-strategy/SKILL.md の "EditSessionDropdown / 多重 context 系テストの注意" 節`,
].join("\n");

console.error(msg);
process.exit(2);
