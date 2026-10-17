import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { MENU_SHORTCUTS } from "./menuShortcuts";
import { SHORTCUT_GROUPS } from "./shortcuts";

/** ショートカット一覧の、キーの組み合わせ (例: "Ctrl+S"。「Ctrl+Shift+PageUp / PageDown」のような併記は、別々に) */
const helpCombos = new Set(
  SHORTCUT_GROUPS.flatMap((g) => g.entries).flatMap((e) => {
    const joined = e.keys.join("+");
    const alts = joined.split(" / ");
    // "Ctrl+Shift+PageUp / PageDown" → Ctrl+Shift+PageUp, Ctrl+Shift+PageDown
    const base = alts[0].split("+").slice(0, -1).join("+");
    return [joined, ...alts, ...(alts.length > 1 ? [`${base}+${alts[1]}`] : []), ...(e.keys.some((k) => k.includes("↑↓")) ? [joined.replace("↑↓", "↑"), joined.replace("↑↓", "↓")] : [])];
  }),
);

describe("MENU_SHORTCUTS (続編 第 10 弾 #197)", () => {
  it("台帳のキーは、すべてショートカット一覧に載っている", () => {
    const missing = Object.entries(MENU_SHORTCUTS).filter(([, k]) => !helpCombos.has(k)).map(([id, k]) => `${id}: ${k}`);
    expect(missing).toEqual([]);
  });
});

/** 一覧の右クリックメニューの標準の操作 (コピー・貼り付け・削除など) は、台帳のキーを必ず併記する */
describe("右クリックメニューの標準の操作のキー併記", () => {
  const STANDARD: Record<string, string> = { copy: "Ctrl+C", cut: "Ctrl+X", paste: "Ctrl+V", duplicate: "Ctrl+D", delete: "Delete", moveUp: "Alt+↑", moveDown: "Alt+↓" };
  const walk = (dir: string): string[] => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p) : /\.tsx$/.test(n) && !/\.test\./.test(n) ? [p] : []; });
  it("key: copy / cut / paste / duplicate / delete / moveUp / moveDown の項目は、標準のキーを併記している", () => {
    const bad: string[] = [];
    for (const f of walk(join(__dirname, "../components"))) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/\{\s*key:\s*"(copy|cut|paste|duplicate|delete|moveUp|moveDown)",\s*label:\s*"[^"]*"([^}]*?)\}/g)) {
        const [, key, rest] = m;
        // 無効の項目の説明だけのもの (disabled: true, onClick だけ) は、対象にしない
        if (/shortcut:\s*"/.test(rest)) { if (!rest.includes(`shortcut: "${STANDARD[key]}"`)) bad.push(`${f.split("components/")[1]}: ${key} のキーが標準 (${STANDARD[key]}) と違う`); }
        else if (!/disabled:\s*true,\s*disabledReason/.test(rest)) bad.push(`${f.split("components/")[1]}: ${key} にキーの併記が無い`);
      }
    }
    expect(bad).toEqual([]);
  });
});
