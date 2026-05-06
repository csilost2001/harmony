/**
 * puckScreenValidation.ts
 * Puck 画面の仕様準拠を検証するユーティリティ。
 *
 * 仕様書: docs/spec/multi-editor-puck.md § 8
 *
 * #806 子 5
 */

import type { Screen } from "../types/v3/screen";
import type { CustomPuckComponentDef } from "../store/puckComponentsStore";
import { BUILTIN_PRIMITIVE_NAMES } from "../puck/buildConfig";

// ─── 型定義 ───────────────────────────────────────────────────────────────────

export interface PuckScreenValidationError {
  severity: "error" | "warning";
  message: string;
  field?: string;
}

// ─── 値域定数 ──────────────────────────────────────────────────────────────────

const VALID_EDITOR_KINDS = ["grapesjs", "puck"] as const;
const VALID_CSS_FRAMEWORKS = ["bootstrap", "tailwind"] as const;

// 共通レイアウト props の正規値域
const VALID_ALIGN = ["left", "center", "right"];
const VALID_SPACING = ["none", "sm", "md", "lg", "xl"];
const VALID_GAP = ["none", "sm", "md", "lg"];
const VALID_COLOR_ACCENT = ["default", "primary", "secondary", "muted", "success", "warning", "danger"];
const VALID_BG_ACCENT = ["none", "white", "muted", "primary-soft", "success-soft", "warning-soft", "danger-soft"];
const VALID_BORDER = ["none", "default", "strong"];
const VALID_ROUNDED = ["none", "sm", "md", "lg", "full"];
const VALID_SHADOW = ["none", "sm", "md", "lg"];

const LAYOUT_PROP_RANGES: Record<string, string[]> = {
  align: VALID_ALIGN,
  padding: VALID_SPACING,
  paddingX: VALID_SPACING,
  paddingY: VALID_SPACING,
  margin: VALID_SPACING,
  marginBottom: VALID_SPACING,
  marginTop: VALID_SPACING,
  gap: VALID_GAP,
  colorAccent: VALID_COLOR_ACCENT,
  bgAccent: VALID_BG_ACCENT,
  border: VALID_BORDER,
  rounded: VALID_ROUNDED,
  shadow: VALID_SHADOW,
};

// ─── 型ガード ──────────────────────────────────────────────────────────────────

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// ─── Puck Data ──────────────────────────────────────────────────────────────────

interface PuckContent {
  type: string;
  props?: Record<string, unknown>;
}

interface PuckData {
  root?: { props?: Record<string, unknown> };
  content?: PuckContent[];
}

function isPuckData(v: unknown): v is PuckData {
  return isRecord(v) && ("root" in v || "content" in v);
}

// ─── 検証関数 ──────────────────────────────────────────────────────────────────

/**
 * 単一の Puck 画面を検証して PuckScreenValidationError[] を返す。
 *
 * @param screen          検証対象画面エンティティ
 * @param allScreens      全画面一覧 (参照解決に使用、現実装では未使用だが署名互換性のため残す)
 * @param customComponents workspace のカスタムコンポーネント定義一覧
 * @param puckDataPayload puck-data.json の内容 (未ロードなら undefined でも可)
 */
export function validatePuckScreen(
  screen: Screen,
  _allScreens: Screen[],
  customComponents: CustomPuckComponentDef[],
  puckDataPayload?: unknown,
): PuckScreenValidationError[] {
  const errors: PuckScreenValidationError[] = [];

  const design = screen.design;

  // ── editorKind 値域検証 ──────────────────────────────────────────────────
  if (design?.editorKind !== undefined) {
    if (!(VALID_EDITOR_KINDS as readonly string[]).includes(design.editorKind)) {
      errors.push({
        severity: "error",
        message: `editorKind "${design.editorKind}" は不正な値です。grapesjs または puck を指定してください。`,
        field: "design.editorKind",
      });
    }
  }

  // ── cssFramework 値域検証 ────────────────────────────────────────────────
  if (design?.cssFramework !== undefined) {
    if (!(VALID_CSS_FRAMEWORKS as readonly string[]).includes(design.cssFramework)) {
      errors.push({
        severity: "error",
        message: `cssFramework "${design.cssFramework}" は不正な値です。bootstrap または tailwind を指定してください。`,
        field: "design.cssFramework",
      });
    }
  }

  // 以下は editorKind=puck 画面固有の検証
  const resolvedEditorKind = design?.editorKind ?? "grapesjs";
  if (resolvedEditorKind !== "puck") {
    return errors;
  }

  // ── puckDataRef 存在検証 ─────────────────────────────────────────────────
  if (!design?.puckDataRef) {
    errors.push({
      severity: "error",
      message: "editorKind=puck の画面には puckDataRef が必要です。",
      field: "design.puckDataRef",
    });
  }

  // ── Puck Data 検証 (payload がある場合) ──────────────────────────────────
  if (puckDataPayload !== undefined) {
    if (!isPuckData(puckDataPayload)) {
      errors.push({
        severity: "error",
        message: "Puck Data の形式が不正です (root / content が存在しません)。",
        field: "puckData",
      });
    } else {
      const puckData = puckDataPayload as PuckData;

      // root が空かどうか
      const rootProps = puckData.root?.props ?? {};
      const hasRootProps = Object.keys(rootProps).length > 0;
      const hasContent = Array.isArray(puckData.content) && puckData.content.length > 0;

      if (!hasRootProps && !hasContent) {
        errors.push({
          severity: "error",
          message: "Puck Data の root が空で、コンテンツも配置されていません。",
          field: "puckData.root",
        });
      }

      if (!hasContent) {
        errors.push({
          severity: "warning",
          message: "画面に primitive が配置されていません。",
          field: "puckData.content",
        });
      }

      // content 内の各コンポーネント検証
      if (Array.isArray(puckData.content)) {
        const allKnownTypes = new Set<string>([
          ...BUILTIN_PRIMITIVE_NAMES,
          ...customComponents.map((c) => c.id),
          // Puck は PascalCase でコンポーネント名を登録するため両方チェック
          ...BUILTIN_PRIMITIVE_NAMES.map((n) => n.charAt(0).toUpperCase() + n.slice(1)),
        ]);

        for (const item of puckData.content) {
          if (!isRecord(item)) continue;

          // カスタムコンポーネントの primitive 存在検証
          const customDef = customComponents.find((c) => c.id === item.type);
          if (customDef) {
            if (!(BUILTIN_PRIMITIVE_NAMES as readonly string[]).includes(customDef.primitive)) {
              errors.push({
                severity: "error",
                message: `カスタムコンポーネント "${customDef.id}" の primitive "${customDef.primitive}" がビルトインに存在しません。`,
                field: `puckData.content[${item.type}].primitive`,
              });
            }
          }

          // 共通レイアウト props 値域検証
          if (isRecord(item.props)) {
            for (const [propKey, validValues] of Object.entries(LAYOUT_PROP_RANGES)) {
              const propVal = item.props[propKey];
              if (propVal !== undefined && propVal !== null && propVal !== "") {
                if (typeof propVal === "string" && !validValues.includes(propVal)) {
                  errors.push({
                    severity: "error",
                    message: `コンポーネント "${String(item.type)}" の ${propKey} 値 "${propVal}" は不正です。有効値: ${validValues.join(", ")}`,
                    field: `puckData.content[${String(item.type)}].props.${propKey}`,
                  });
                }
              }
            }
          }

          // allKnownTypes is defined for future use; currently primitive validation is via customDef check above
          void allKnownTypes;
        }
      }
    }
  }

  // ── カスタムコンポーネント定義の primitive 存在検証 ───────────────────────
  for (const def of customComponents) {
    if (!(BUILTIN_PRIMITIVE_NAMES as readonly string[]).includes(def.primitive)) {
      errors.push({
        severity: "error",
        message: `カスタムコンポーネント定義 "${def.id}" の primitive "${def.primitive}" がビルトインに存在しません。`,
        field: `customComponents[${def.id}].primitive`,
      });
    }
  }

  // ── label 空チェック ─────────────────────────────────────────────────────
  if (!screen.name || !screen.name.trim()) {
    errors.push({
      severity: "warning",
      message: "画面名 (label) が空です。",
      field: "name",
    });
  }

  return errors;
}
