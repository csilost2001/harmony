/**
 * screenRefValidation.ts — Screen entity の cross-resource ref 整合性検証 (#1318)
 *
 * 検証対象:
 *  - ScreenItem.events[].effects[] の TemplateString 内 `@dialog.<n>` / `@messageArea.<n>` /
 *    `@options.<n>` 参照が対応 catalog (dialog / message-area / options) に存在するか (#1318)
 *
 * effects[] の TemplateString 内 prefix 参照は AJV では実在検証できないため、ここで担う。
 *
 * 設計方針:
 * - ProcessFlow 側の `referentialIntegrity.ts` (#1090 Phase 1) と同じ責務分離パターン
 * - Puck data 検証 (`puckScreenValidation.ts`) とは別ファイル / 別関数 (editor-agnostic)
 * - severity は既存 referentialIntegrity 慣行に合わせて warning 統一
 * - **prefix を扱う**: kind は `message-area` (kebab) だが prefix は `@messageArea.` (camelCase、
 *   log-event/logEvent と同じ分離パターン、#1318)。`genericDefinitionNames` の key は **kind-keyed**。
 *   caller は kind 名で渡し、内部で prefix regex と突合する。
 *
 * 仕様: docs/spec/generic-definition-layer.md §4.2
 */

import type { Screen } from "../types/v3/screen";

/**
 * Screen 検証で参照する Generic Definition Catalog の name set (#1318)。
 * 各 kind が undefined の場合は当該検証を silent pass (catalog ロード失敗時の互換性維持)。
 * key は **kind 名** (`message-area` 等、kebab-case)、prefix (`messageArea` 等) ではないことに注意。
 */
export interface ScreenGenericDefinitionNames {
  /** dialog catalog name set (#1318)。`@dialog.<name>` の <name> 部の存在検証に使用 */
  dialog?: Set<string>;
  /** message-area catalog name set (#1318)。`@messageArea.<name>` の <name> 部の存在検証に使用 */
  "message-area"?: Set<string>;
  /** options catalog name set (#1318)。`@options.<name>` の <name> 部の存在検証に使用 */
  options?: Set<string>;
}

export interface ScreenRefIssue {
  severity: "error" | "warning";
  message: string;
  /** ドットパス (例: "items[0].events[1].effects[2].target") */
  field: string;
  /** 識別子 */
  code:
    | "UNKNOWN_DIALOG_REF"
    | "UNKNOWN_MESSAGE_AREA_REF"
    | "UNKNOWN_OPTIONS_REF";
}

/**
 * TemplateString 内の `@<prefix>.<name>` を **全件** 抽出する (#1318)。
 *
 * effects[].target / effects[].value は string (TemplateString) で、複数 `@<prefix>.<name>`
 * 参照を含み得る。本関数は指定 prefix にマッチする全 <name> を順番に返す。
 *
 * 注意: schema pattern が name 部に許容する文字は `[A-Za-z][A-Za-z0-9_]*` (GENERIC_DEFINITION_NAME_PATTERN)。
 * regex は `[A-Za-z][\w]*` で先頭 1 文字 + 残りを word 文字に限定する。
 */
function extractPrefixNames(value: string, prefix: string): string[] {
  // `(?<![\w])` で `xx@dialog.` のような誤検出を抑止
  // `(?![\w])` で `@dialog.Foo bar` のような name 末尾境界を担保
  const re = new RegExp(`(?<![\\w])@${prefix}\\.([A-Za-z][\\w]*)`, "g");
  const names: string[] = [];
  for (const m of value.matchAll(re)) {
    names.push(m[1]);
  }
  return names;
}

/**
 * Screen 単体の cross-resource ref 整合性を検証する。
 * - items[].events[].effects[] の dialog/messageArea/options 参照 → 対応 catalog 突合 (#1318)
 */
export function validateScreenRefs(
  screen: Screen,
  options?: { genericDefinitionNames?: ScreenGenericDefinitionNames },
): ScreenRefIssue[] {
  const issues: ScreenRefIssue[] = [];
  const gdNames = options?.genericDefinitionNames;
  const dialogNames = gdNames?.dialog;
  const messageAreaNames = gdNames?.["message-area"];
  const optionsNames = gdNames?.options;

  // ─── effects[] の dialog/messageArea/options 参照 (#1318) ──────────────────
  // 検証対象 prefix と effect field のマッピング:
  //   showDialog.target  → @dialog.<name>
  //   setMessage.target  → @messageArea.<name>
  //   setOptions.value   → @options.<name>
  // 各 catalog Set が undefined の場合は当該 prefix を silent pass (catalog ロード失敗互換)
  const items = screen.items ?? [];
  items.forEach((item, i) => {
    const events = item.events ?? [];
    events.forEach((event, ei) => {
      const effects = event.effects ?? [];
      effects.forEach((eff, fi) => {
        const pathPrefix = `items[${i}].events[${ei}].effects[${fi}]`;

        if (eff.kind === "showDialog" && dialogNames) {
          const target = eff.target;
          if (typeof target === "string" && target) {
            for (const name of extractPrefixNames(target, "dialog")) {
              if (!dialogNames.has(name)) {
                issues.push({
                  severity: "warning",
                  message: `${pathPrefix}.target "@dialog.${name}" が generic-definitions/dialog catalog に存在しません`,
                  field: `${pathPrefix}.target`,
                  code: "UNKNOWN_DIALOG_REF",
                });
              }
            }
          }
        } else if (eff.kind === "setMessage" && messageAreaNames) {
          const target = eff.target;
          if (typeof target === "string" && target) {
            for (const name of extractPrefixNames(target, "messageArea")) {
              if (!messageAreaNames.has(name)) {
                issues.push({
                  severity: "warning",
                  message: `${pathPrefix}.target "@messageArea.${name}" が generic-definitions/message-area catalog に存在しません`,
                  field: `${pathPrefix}.target`,
                  code: "UNKNOWN_MESSAGE_AREA_REF",
                });
              }
            }
          }
        } else if (eff.kind === "setOptions" && optionsNames) {
          const value = eff.value;
          if (typeof value === "string" && value) {
            for (const name of extractPrefixNames(value, "options")) {
              if (!optionsNames.has(name)) {
                issues.push({
                  severity: "warning",
                  message: `${pathPrefix}.value "@options.${name}" が generic-definitions/options catalog に存在しません`,
                  field: `${pathPrefix}.value`,
                  code: "UNKNOWN_OPTIONS_REF",
                });
              }
            }
          }
        }
      });
    });
  });

  return issues;
}
