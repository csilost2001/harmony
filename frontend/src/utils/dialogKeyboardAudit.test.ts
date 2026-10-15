/**
 * ダイアログ (aria-modal) のキー操作の統一の検査: すべて、Tab を中で循環させ (フォーカスの閉じ込め)、Esc で閉じる。
 * 共通の部品 (useFocusTrap の onEscape / ModalShell) を使うか、自分で Escape を処理する。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = path.resolve(__dirname, "..");
// 検索の入力欄にフォーカスがあり、自分で候補の移動・Esc を処理している (入力欄が最初から中にある)
const OWN_FOCUS = new Set(["components/quick-open/QuickOpen.tsx"]);
// aria-modal の文字が、ダイアログではなく、除外の指定 (セレクタ) として書かれているだけ
const SELECTOR_ONLY = new Set(["components/screen-layout/ScreenLayoutDesigner.tsx", "components/common/RegionNavigator.tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) walk(p, out);
    else if (/\.tsx$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("ダイアログのキー操作", () => {
  it("aria-modal のダイアログは、フォーカスを閉じ込め、Esc で閉じる", () => {
    const missingEsc: string[] = [];
    const missingTrap: string[] = [];
    for (const file of walk(path.join(SRC, "components"))) {
      const rel = path.relative(SRC, file).replace(/\\/g, "/");
      const text = fs.readFileSync(file, "utf-8");
      if (!/aria-modal/.test(text) || SELECTOR_ONLY.has(rel)) continue;
      const hasEsc = /Escape|ModalShell|useFocusTrap\([^)]*,[^)]*,/.test(text);
      const hasTrap = /useFocusTrap|ModalShell/.test(text);
      if (!hasEsc) missingEsc.push(rel);
      if (!hasTrap && !OWN_FOCUS.has(rel)) missingTrap.push(rel);
    }
    expect({ missingEsc, missingTrap }).toEqual({ missingEsc: [], missingTrap: [] });
  });
});
