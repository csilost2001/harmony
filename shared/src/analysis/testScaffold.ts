/**
 * テストの雛形の生成。テスト観点表 (画面入力・処理の分岐、ID つき) から、選んだ観点のテストの雛形 (題名・入力値・期待結果をコメントに持つ未実装のテスト) を、
 * 画面・処理ごとのファイルとして作る。中身 (操作と検証) は、技術スタックと実装に合わせて書き足す。
 */
import type { FlowTestCase, ScreenInputCase, TestViewpointSheet } from "../testViewpoints.js";
import { oneLine } from "./common.js";

export type TestFramework = "vitest" | "jest" | "playwright";
export const TEST_FRAMEWORK_LABELS: Record<TestFramework, string> = { vitest: "Vitest (単体)", jest: "Jest (単体)", playwright: "Playwright (E2E)" };

export interface ScaffoldFile { path: string; content: string; cases: number }
export interface ScaffoldOptions {
  /** 作る観点の ID (省略なら全部) */
  ids?: ReadonlySet<string>;
  /** 出力先のフォルダ (既定 `tests`) */
  dir?: string;
}

/** 文字列リテラルにする (引用符・改行・バッククォート・`${` を安全に) */
const lit = (s: unknown) => JSON.stringify(String(s ?? "")).split(String.fromCharCode(0x2028)).join("\\u2028").split(String.fromCharCode(0x2029)).join("\\u2029");
/** コメントの 1 行にする (改行と、コメントを閉じる文字列を除く) */
const cm = (s: unknown) => oneLine(s).replace(/\*\//g, "* /");
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, "_");

function header(framework: TestFramework): string {
  if (framework === "playwright") return `import { test } from "@playwright/test";\n`;
  if (framework === "vitest") return `import { describe, it } from "vitest";\n`;
  return ""; // Jest は describe / it がグローバル
}

const todo = (framework: TestFramework, title: string): string => (framework === "playwright" ? `test.fixme(${lit(title)}, async ({ page }) => {\n    // TODO: 操作と検証を書く\n  });` : `it.todo(${lit(title)});`);

function screenCase(c: ScreenInputCase, fw: TestFramework): string {
  return [
    `  // 項目: ${cm(c.itemLabel)} / 区分: ${cm(c.category)}`,
    `  // 入力: ${cm(c.input)}${c.value !== undefined ? `  (値: ${cm(JSON.stringify(c.value))})` : ""}`,
    `  // 期待結果: ${cm(c.expected)}${c.expectedMessage ? `  (メッセージ: ${cm(c.expectedMessage)})` : ""}`,
    `  ${todo(fw, `${c.id}: ${c.viewpoint}`)}`,
  ].join("\n");
}
function flowCase(c: FlowTestCase, fw: TestFramework): string {
  return [
    `  // 区分: ${cm(c.category)}${c.actionName ? ` / アクション: ${cm(c.actionName)}` : ""}`,
    `  // 条件: ${cm(c.conditions.join(" かつ "))}`,
    `  // 期待結果: ${cm(c.expected)}`,
    `  ${todo(fw, `${c.id}: ${c.conditions.join(" かつ ") || c.expected}`)}`,
  ].join("\n");
}

export function scaffoldTests(sheet: TestViewpointSheet, framework: TestFramework, options: ScaffoldOptions = {}): ScaffoldFile[] {
  const dir = (options.dir ?? "tests").replace(/\/+$/, "");
  const ext = framework === "playwright" ? "spec.ts" : "test.ts";
  const pick = <T extends { id: string }>(cases: T[]) => (options.ids ? cases.filter((c) => options.ids!.has(c.id)) : cases);
  const open = (title: string) => (framework === "playwright" ? `test.describe(${lit(title)}, () => {` : `describe(${lit(title)}, () => {`);
  const files: ScaffoldFile[] = [];
  for (const s of sheet.screens) {
    const cases = pick(s.cases);
    if (!cases.length) continue;
    files.push({
      path: `${dir}/screens/${fileSafe(s.screenId)}.${ext}`, cases: cases.length,
      content: `${header(framework)}\n// 画面「${cm(s.screenName ?? s.screenId)}」の入力のテスト観点 (Harmony のテスト観点表から生成)\n${open(`画面 ${s.screenName ?? s.screenId}`)}\n${cases.map((c) => screenCase(c, framework)).join("\n\n")}\n});\n`,
    });
  }
  for (const f of sheet.flows) {
    const cases = pick(f.cases);
    if (!cases.length) continue;
    files.push({
      path: `${dir}/flows/${fileSafe(f.flowId)}.${ext}`, cases: cases.length,
      content: `${header(framework)}\n// 処理「${cm(f.flowName ?? f.flowId)}」の分岐のテスト観点 (Harmony のテスト観点表から生成)\n${open(`処理 ${f.flowName ?? f.flowId}`)}\n${cases.map((c) => flowCase(c, framework)).join("\n\n")}\n});\n`,
    });
  }
  return files;
}
