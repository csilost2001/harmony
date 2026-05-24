/**
 * screenRefValidation.ts — Screen entity の cross-resource ref 整合性検証 (#1090 Phase 2、#1318 で 3 prefix 拡張)
 *
 * 検証対象:
 *  1. Screen.fragments[].fragmentRef が Generic Definition Catalog の ui-fragment に存在するか (#1090 Phase 2)
 *  2. ScreenItem.events[].effects[] の TemplateString 内 `@dialog.<n>` / `@messageArea.<n>` /
 *     `@options.<n>` 参照が対応 catalog (dialog / message-area / options) に存在するか (#1318)
 *
 * AJV pattern (`generic-definitions/ui-fragment/<Name>` 形式) は schema layer で gate 済みだが、
 * `<Name>` 部の実在検証は AJV では行えない。effects[] の TemplateString 内 prefix 参照も同様。
 *
 * 設計方針:
 * - ProcessFlow 側の `referentialIntegrity.ts` (#1090 Phase 1) と同じ責務分離パターン
 * - Puck data 検証 (`puckScreenValidation.ts`) とは別ファイル / 別関数 (editor-agnostic)
 * - severity は既存 referentialIntegrity 慣行に合わせて warning 統一
 * - **prefix を扱う**: kind は `message-area` (kebab) だが prefix は `@messageArea.` (camelCase、
 *   log-event/logEvent と同じ分離パターン、#1318)。`genericDefinitionNames` の key は **prefix-keyed**
 *   ではなく **kind-keyed** とする (ui-fragment と統一)。caller は kind 名で渡し、内部で prefix
 *   regex と突合する。
 *
 * 仕様: docs/spec/generic-definition-layer.md §3.6 / §4.2
 */

import type { Screen } from "../types/v3/screen";

/**
 * Screen 検証で参照する Generic Definition Catalog の name set (#1090 Phase 2 / #1318)。
 * 各 kind が undefined の場合は当該検証を silent pass (catalog ロード失敗時の互換性維持)。
 * key は **kind 名** (`message-area` 等、kebab-case)、prefix (`messageArea` 等) ではないことに注意。
 */
export interface ScreenGenericDefinitionNames {
  "ui-fragment"?: Set<string>;
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
  /** ドットパス (例: "fragments[0].fragmentRef" / "items[0].events[1].effects[2].target") */
  field: string;
  /** 識別子 */
  code:
    | "UNKNOWN_FRAGMENT_REF"
    | "UNKNOWN_DIALOG_REF"
    | "UNKNOWN_MESSAGE_AREA_REF"
    | "UNKNOWN_OPTIONS_REF";
}

/**
 * `generic-definitions/ui-fragment/<Name>` 形式の参照から <Name> を抽出する。
 * AJV pattern gate で形式は担保される前提だが、防御的に regex 一致を確認する。
 * 形式不一致の場合は null (= AJV 側で error 報告される領域なので本検証は skip)。
 */
function extractUiFragmentName(ref: string): string | null {
  const m = ref.match(/^generic-definitions\/ui-fragment\/([A-Za-z][A-Za-z0-9_]*)$/);
  return m ? m[1] : null;
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
 * - fragments[].fragmentRef → ui-fragment catalog 突合 (#1090 Phase 2)
 * - items[].events[].effects[] の dialog/messageArea/options 参照 → 対応 catalog 突合 (#1318)
 */
export function validateScreenRefs(
  screen: Screen,
  options?: { genericDefinitionNames?: ScreenGenericDefinitionNames },
): ScreenRefIssue[] {
  const issues: ScreenRefIssue[] = [];
  const gdNames = options?.genericDefinitionNames;
  const fragmentNames = gdNames?.["ui-fragment"];
  const dialogNames = gdNames?.dialog;
  const messageAreaNames = gdNames?.["message-area"];
  const optionsNames = gdNames?.options;

  // ─── ui-fragment 参照 (#1090 Phase 2) ─────────────────────────────────────
  if (fragmentNames) {
    const fragments = screen.fragments ?? [];
    fragments.forEach((f, i) => {
      const ref = f?.fragmentRef;
      if (!ref) return; // schema 側で required 担保
      const name = extractUiFragmentName(ref);
      if (name && !fragmentNames.has(name)) {
        issues.push({
          severity: "warning",
          message: `screen.fragments[${i}].fragmentRef "${ref}" の <Name> が generic-definitions/ui-fragment catalog に存在しません`,
          field: `fragments[${i}].fragmentRef`,
          code: "UNKNOWN_FRAGMENT_REF",
        });
      }
    });
  }

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
