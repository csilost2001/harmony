/**
 * Enter で確定・送信する処理が、日本語の変換確定の Enter を取りこぼさないことの検査。
 *
 * `key === "Enter"` を見る処理は、isImeComposing / isPlainEnter で変換中を除くこと。
 * 例外: Ctrl / Meta 付き (変換確定は修飾キーなしの Enter)・Space と並べたボタンの操作・
 * 下の許可リスト (入力欄でないところの Enter)。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
// 入力欄ではなく、ボタン・図・ツアーなどの Enter (変換が起きない)
const ALLOW = new Set([
  "components/help/Tour.tsx",
  // 先頭で変換中を除いている
  "hooks/useReferenceCompletion.ts",
  "components/common/SearchableSelect.tsx",
]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("Enter の処理は日本語の変換中を除く", () => {
  it("変換中を見ていない Enter の処理が無い", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      if (ALLOW.has(rel)) continue;
      fs.readFileSync(file, "utf-8").split("\n").forEach((line, i) => {
        if (!/key === "Enter"/.test(line)) return;
        if (/isImeComposing|isPlainEnter|isComposing/.test(line)) return;
        if (/ctrlKey|metaKey/.test(line)) return;
        if (/key === " "/.test(line)) return;
        offenders.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
