/**
 * buildConfig.ts — 全 Puck primitive を組み合わせた Puck Config を構築する。
 *
 * 共通レイアウト props の fields (LAYOUT_FIELDS) を全 primitive にマージして返す。
 * これにより各 primitive ファイルに共通レイアウト props の field 定義を重複させない。
 *
 * 詳細仕様: docs/spec/multi-editor-puck.md § 4.1 / § 4.3
 *
 * #806 子 4
 */

import type { Config, Fields } from "@measured/puck";
import { createElement } from "react";

import { ContainerConfig } from "./primitives/Container";
import { RowConfig } from "./primitives/Row";
import { ColConfig } from "./primitives/Col";
import { SectionConfig } from "./primitives/Section";
import { HeadingConfig } from "./primitives/Heading";
import { ParagraphConfig } from "./primitives/Paragraph";
import { LinkConfig } from "./primitives/Link";
import { InputConfig } from "./primitives/Input";
import { SelectConfig } from "./primitives/Select";
import { TextareaConfig } from "./primitives/Textarea";
import { CheckboxConfig } from "./primitives/Checkbox";
import { RadioConfig } from "./primitives/Radio";
import { ButtonConfig } from "./primitives/Button";
import { TableConfig } from "./primitives/Table";
import { ImageConfig } from "./primitives/Image";
import { IconConfig } from "./primitives/Icon";
import { InputGroupConfig } from "./primitives/InputGroup";
import { CardConfig } from "./primitives/Card";
import { DataListConfig } from "./primitives/DataList";
import { PaginationConfig } from "./primitives/Pagination";
import { RegionHeaderConfig } from "./primitives/RegionHeader";
import { RegionSidebarConfig } from "./primitives/RegionSidebar";
import { RegionFooterConfig } from "./primitives/RegionFooter";
import { RegionMainConfig } from "./primitives/RegionMain";
import type {
  CustomPuckComponentDef,
  CompositePuckComponentDef,
  PrimitivePuckComponentDef,
} from "../store/puckComponentsStore";
import type {
  LoadedExternalComponent,
  ExternalComponentErrorKind,
} from "./externalComponents";
import type { ExternalSlotDecl } from "./externalComponentManifest";
import { ExternalComponentErrorCard } from "../components/puck/ExternalComponentErrorCard";
import { compositeTypeName } from "../editor/puckSubtree";

// ---------------------------------------------------------------------------
// 共通レイアウト props の Fields 定義
// 全 primitive にマージして Puck プロパティパネルに表示する。
// ---------------------------------------------------------------------------

const ALIGN_OPTIONS = [
  { label: "左", value: "left" },
  { label: "中央", value: "center" },
  { label: "右", value: "right" },
];

const SPACING_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "小 (sm)", value: "sm" },
  { label: "中 (md)", value: "md" },
  { label: "大 (lg)", value: "lg" },
  { label: "特大 (xl)", value: "xl" },
];

const GAP_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "小 (sm)", value: "sm" },
  { label: "中 (md)", value: "md" },
  { label: "大 (lg)", value: "lg" },
];

const COLOR_ACCENT_OPTIONS = [
  { label: "デフォルト", value: "default" },
  { label: "プライマリ", value: "primary" },
  { label: "セカンダリ", value: "secondary" },
  { label: "ミュート", value: "muted" },
  { label: "成功", value: "success" },
  { label: "警告", value: "warning" },
  { label: "危険", value: "danger" },
];

const BG_ACCENT_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "白", value: "white" },
  { label: "ミュート", value: "muted" },
  { label: "プライマリ (薄)", value: "primary-soft" },
  { label: "成功 (薄)", value: "success-soft" },
  { label: "警告 (薄)", value: "warning-soft" },
  { label: "危険 (薄)", value: "danger-soft" },
];

const BORDER_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "標準", value: "default" },
  { label: "強調", value: "strong" },
];

const ROUNDED_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "小", value: "sm" },
  { label: "中", value: "md" },
  { label: "大", value: "lg" },
  { label: "全角", value: "full" },
];

const SHADOW_OPTIONS = [
  { label: "なし", value: "none" },
  { label: "小", value: "sm" },
  { label: "中", value: "md" },
  { label: "大", value: "lg" },
];

// ---------------------------------------------------------------------------
// palette カテゴリ定義 (#1410 P-2)
// ---------------------------------------------------------------------------

/**
 * buildPuckConfig の戻り値に乗せる静的カテゴリ定義。
 *
 * 重要: Puck は categories を定義すると、どのカテゴリにも未割当の component を
 * `other` カテゴリへ落とす。そのためビルトイン 24 個を必ず全て割り当てる。
 * (各カテゴリの意味区分は従来 buildPuckConfig 内コメントの区分を踏襲)
 */
const BUILTIN_CATEGORIES: NonNullable<Config["categories"]> = {
  layout: { title: "レイアウト", components: ["Container", "Row", "Col", "Section"] },
  text: { title: "テキスト", components: ["Heading", "Paragraph", "Link"] },
  form: {
    title: "フォーム",
    components: ["Input", "Select", "Textarea", "Checkbox", "Radio", "Button"],
  },
  data: { title: "データ", components: ["Table", "Image", "Icon"] },
  composite: {
    title: "業務複合",
    components: ["InputGroup", "Card", "DataList", "Pagination"],
  },
  regions: {
    title: "レイアウト領域",
    components: ["RegionHeader", "RegionSidebar", "RegionFooter", "RegionMain"],
  },
};

// ---------------------------------------------------------------------------
// props → Puck fields 変換ヘルパー (#1410 P-2)
// custom 経路と external 経路の両方が使う共有ロジック (divergence 防止)。
// ---------------------------------------------------------------------------

/**
 * props → fields 変換の正規化入力。
 * custom (PropSchemaField) と external (ExternalPropDecl) の両方を
 * この形に揃えてから buildFieldsFromPropDecls に渡す。
 */
interface NormalizedPropDecl {
  name: string;
  type: "string" | "number" | "boolean" | "enum";
  label?: string;
  enum?: { label: string; value: string }[];
}

/**
 * 正規化済み prop 宣言の配列を Puck Fields に変換する。
 *
 * - enum (非空) → select
 * - number → number (P-2 で追加した分岐)
 * - boolean → radio (はい/いいえ、value は string で既存 custom 挙動を厳密保持)
 * - その他 (string 含む) → text
 */
function buildFieldsFromPropDecls(
  decls: NormalizedPropDecl[],
): NonNullable<Config["components"][string]["fields"]> {
  const fields: NonNullable<Config["components"][string]["fields"]> = {};
  for (const decl of decls) {
    if (decl.type === "enum" && decl.enum && decl.enum.length > 0) {
      fields[decl.name] = {
        type: "select" as const,
        label: decl.label ?? decl.name,
        options: decl.enum.map((opt) => ({ label: opt.label, value: opt.value })),
      };
    } else if (decl.type === "number") {
      fields[decl.name] = {
        type: "number" as const,
        label: decl.label ?? decl.name,
      };
    } else if (decl.type === "boolean") {
      fields[decl.name] = {
        type: "radio" as const,
        label: decl.label ?? decl.name,
        options: [
          { label: "はい", value: "true" },
          { label: "いいえ", value: "false" },
        ],
      };
    } else {
      fields[decl.name] = {
        type: "text" as const,
        label: decl.label ?? decl.name,
      };
    }
  }
  return fields;
}

/**
 * 外部 component の slot 宣言を Puck の slot field に変換する (#1411 P-3)。
 *
 * Puck v0.20 の `{ type: "slot" }` field を宣言すると、Puck は render 時に当該 prop を
 * SlotComponent (= render-prop) に変換して props 経由で注入する。slot 中身は
 * 当該 component の props に co-located で保存されるため、save/load (PuckBackend が
 * Puck Data JSON をそのまま draftWrite/draftRead) を無改修で素通りする。
 *
 * prop field 生成 (buildFieldsFromPropDecls) とは別ヘルパー。マージ側で
 * `{ ...propFields, ...slotFields }` の順で合流させる。
 */
function buildSlotFields(
  slots: ExternalSlotDecl[],
): NonNullable<Config["components"][string]["fields"]> {
  const fields: NonNullable<Config["components"][string]["fields"]> = {};
  for (const slot of slots) {
    fields[slot.name] = {
      type: "slot" as const,
      label: slot.label ?? slot.name,
    };
  }
  return fields;
}

/**
 * 全 primitive に共通追加するレイアウト props の Puck Fields 定義。
 * escape hatch の rawClass は隠し扱い (custom フィールドは Puck v0.20 では type:"custom" が必要だが、
 * 簡易実装として text 型で提供し、UI 上末尾に配置する)。
 */
export const LAYOUT_FIELDS: Fields<Record<string, unknown>> = {
  align: { type: "select", label: "整列", options: ALIGN_OPTIONS },
  padding: { type: "select", label: "padding (全方向)", options: SPACING_OPTIONS },
  paddingX: { type: "select", label: "paddingX (左右)", options: SPACING_OPTIONS },
  paddingY: { type: "select", label: "paddingY (上下)", options: SPACING_OPTIONS },
  margin: { type: "select", label: "margin (全方向)", options: SPACING_OPTIONS },
  marginBottom: { type: "select", label: "marginBottom", options: SPACING_OPTIONS },
  marginTop: { type: "select", label: "marginTop", options: SPACING_OPTIONS },
  gap: { type: "select", label: "gap (子要素の間隔)", options: GAP_OPTIONS },
  colorAccent: { type: "select", label: "文字色", options: COLOR_ACCENT_OPTIONS },
  bgAccent: { type: "select", label: "背景色", options: BG_ACCENT_OPTIONS },
  border: { type: "select", label: "枠線", options: BORDER_OPTIONS },
  rounded: { type: "select", label: "角丸", options: ROUNDED_OPTIONS },
  shadow: { type: "select", label: "影", options: SHADOW_OPTIONS },
  rawClass: { type: "text", label: "カスタム class (escape hatch)" },
};

// ---------------------------------------------------------------------------
// buildPuckConfig: 全 primitive + 共通レイアウト fields をマージして Config を返す
// ---------------------------------------------------------------------------

/**
 * Puck Config を構築する。
 * 各 primitive の固有 fields に LAYOUT_FIELDS をマージすることで、
 * 全 primitive が共通レイアウト props を Puck プロパティパネルで操作できる。
 */
export function buildPuckConfig(): Config {
  return {
    categories: { ...BUILTIN_CATEGORIES },
    components: {
      // --- レイアウト ---
      Container: {
        ...ContainerConfig,
        fields: { ...ContainerConfig.fields, ...LAYOUT_FIELDS },
      },
      Row: {
        ...RowConfig,
        fields: { ...RowConfig.fields, ...LAYOUT_FIELDS },
      },
      Col: {
        ...ColConfig,
        fields: { ...ColConfig.fields, ...LAYOUT_FIELDS },
      },
      Section: {
        ...SectionConfig,
        fields: { ...SectionConfig.fields, ...LAYOUT_FIELDS },
      },
      // --- テキスト ---
      Heading: {
        ...HeadingConfig,
        fields: { ...HeadingConfig.fields, ...LAYOUT_FIELDS },
      },
      Paragraph: {
        ...ParagraphConfig,
        fields: { ...ParagraphConfig.fields, ...LAYOUT_FIELDS },
      },
      Link: {
        ...LinkConfig,
        fields: { ...LinkConfig.fields, ...LAYOUT_FIELDS },
      },
      // --- フォーム ---
      Input: {
        ...InputConfig,
        fields: { ...InputConfig.fields, ...LAYOUT_FIELDS },
      },
      Select: {
        ...SelectConfig,
        fields: { ...SelectConfig.fields, ...LAYOUT_FIELDS },
      },
      Textarea: {
        ...TextareaConfig,
        fields: { ...TextareaConfig.fields, ...LAYOUT_FIELDS },
      },
      Checkbox: {
        ...CheckboxConfig,
        fields: { ...CheckboxConfig.fields, ...LAYOUT_FIELDS },
      },
      Radio: {
        ...RadioConfig,
        fields: { ...RadioConfig.fields, ...LAYOUT_FIELDS },
      },
      Button: {
        ...ButtonConfig,
        fields: { ...ButtonConfig.fields, ...LAYOUT_FIELDS },
      },
      // --- データ ---
      Table: {
        ...TableConfig,
        fields: { ...TableConfig.fields, ...LAYOUT_FIELDS },
      },
      Image: {
        ...ImageConfig,
        fields: { ...ImageConfig.fields, ...LAYOUT_FIELDS },
      },
      Icon: {
        ...IconConfig,
        fields: { ...IconConfig.fields, ...LAYOUT_FIELDS },
      },
      // --- 業務複合 ---
      InputGroup: {
        ...InputGroupConfig,
        fields: { ...InputGroupConfig.fields, ...LAYOUT_FIELDS },
      },
      Card: {
        ...CardConfig,
        fields: { ...CardConfig.fields, ...LAYOUT_FIELDS },
      },
      DataList: {
        ...DataListConfig,
        fields: { ...DataListConfig.fields, ...LAYOUT_FIELDS },
      },
      Pagination: {
        ...PaginationConfig,
        fields: { ...PaginationConfig.fields, ...LAYOUT_FIELDS },
      },
      // --- Layout Regions (pl-5 follow-up: composition preview) ---
      RegionHeader: {
        ...RegionHeaderConfig,
        fields: { ...RegionHeaderConfig.fields, ...LAYOUT_FIELDS },
      },
      RegionSidebar: {
        ...RegionSidebarConfig,
        fields: { ...RegionSidebarConfig.fields, ...LAYOUT_FIELDS },
      },
      RegionFooter: {
        ...RegionFooterConfig,
        fields: { ...RegionFooterConfig.fields, ...LAYOUT_FIELDS },
      },
      RegionMain: {
        ...RegionMainConfig,
        fields: { ...RegionMainConfig.fields, ...LAYOUT_FIELDS },
      },
    },
  };
}

/**
 * カスタムコンポーネント定義を Puck Config に動的追加する。
 * ビルトイン primitive の config をベースに、個別 propsSchema + 共通 LAYOUT_FIELDS をマージ。
 */
export function buildConfigWithCustomComponents(customComponents: CustomPuckComponentDef[]): Config {
  const base = buildPuckConfig();

  // primitive 経路のみ対象 (composite は mergeCompositeComponents が別途扱う、#1412 P-4)。
  const primitiveComponents = customComponents.filter(
    (c): c is PrimitivePuckComponentDef => c.kind === "primitive",
  );

  if (primitiveComponents.length === 0) return base;

  const extraComponents: Config["components"] = {};
  const customIds: string[] = [];

  for (const def of primitiveComponents) {
    customIds.push(def.id);
    const primitiveKey = Object.keys(base.components).find(
      (k) => k.toLowerCase() === def.primitive.toLowerCase().replace(/-/g, ""),
    );
    const baseComponentConfig = primitiveKey ? base.components[primitiveKey] : undefined;

    const customFields = buildFieldsFromPropDecls(
      Object.entries(def.propsSchema).map(([name, f]) => ({
        name,
        type: f.type,
        label: f.label,
        enum: f.enum,
      })),
    );

    const defaultProps: Record<string, unknown> = {};
    for (const [fieldName, fieldDef] of Object.entries(def.propsSchema)) {
      if (fieldDef.default !== undefined) {
        defaultProps[fieldName] = fieldDef.default;
      }
    }

    if (baseComponentConfig) {
      extraComponents[def.id] = {
        ...baseComponentConfig,
        label: `(カスタム) ${def.label}`,
        fields: {
          ...(baseComponentConfig.fields ?? {}),
          ...customFields,
        },
        defaultProps: {
          ...(baseComponentConfig.defaultProps ?? {}),
          ...defaultProps,
        },
      };
    } else {
      extraComponents[def.id] = {
        label: `(カスタム) ${def.label}`,
        fields: customFields,
        defaultProps,
        render: (props: Record<string, unknown>) => createElement(
          "div",
          { "data-custom-component": def.id, "data-primitive": def.primitive },
          JSON.stringify(props),
        ),
      };
    }
  }

  // categories は base を immutable に複製。custom が 1 件以上あるときのみ
  // projectCustom を追加する (0 件なら空カテゴリを作らない)。base の既存カテゴリは不変。
  const categories: Config["categories"] = {
    ...(base.categories ?? {}),
    ...(customIds.length > 0
      ? {
          projectCustom: {
            title: "プロジェクト部品 (カスタム)",
            components: customIds,
          },
        }
      : {}),
  };

  return {
    ...base,
    categories,
    components: {
      ...base.components,
      ...extraComponents,
    },
  };
}

/**
 * 外部 React Component (#1409 P-1) を Puck config に統合する。
 *
 * - status="ok": entry.Component を render する component を登録。
 *   defaultProps は manifest props の default 集約。
 *   fields は manifest props を buildFieldsFromPropDecls で変換 (#1410 P-2)。
 * - status="error": ExternalComponentErrorCard を render するエラーカードを登録。
 * - id 衝突 (built-in / 既存 custom / 先行 external と同じ id): 既存を上書きせず、
 *   id-collision のエラーカードに差し替える。意図しない built-in 部品の置換を防ぐ。
 *
 * 衝突安全性 (defense-in-depth、validator で弾く前提でも merge 層で保証):
 *   1. base.components の既存 key は **絶対に上書きしない**。
 *   2. extraComponents の key はすべて usedKeys 採番済 (uniqueKey helper) で、
 *      base.components とも extraComponents 内でも非衝突であることを保証する。
 *   3. 同一 manifest 内で id が重複した entry は 2 件目以降が id-collision 扱いになり、
 *      silent overwrite を防ぐ。
 *
 * 既存 JSON-only custom component 経路 (buildConfigWithCustomComponents) とは別ソースとして
 * 統合する。両者を併用する場合は buildConfigWithCustomComponents の戻り値を base に渡せる。
 */
export function mergeExternalComponents(
  base: Config,
  loaded: LoadedExternalComponent[],
): Config {
  if (loaded.length === 0) return base;

  const extraComponents: Config["components"] = {};
  // base の全 key を起点にした「使用済み key」集合。
  // 以降に登録する key (実 component / エラーカード / 衝突カード) はすべてこの集合に
  // add していき、新規 key 採番時の衝突判定に使う。base の key は不変。
  const usedKeys = new Set<string>(Object.keys(base.components));
  // projectExternal カテゴリに割り当てる外部由来の key (ok / error / 衝突カード) を全て収集。
  const externalKeys: string[] = [];

  for (let i = 0; i < loaded.length; i++) {
    const item = loaded[i];
    const { entry } = item;

    // id 衝突チェック: entry.id が built-in / 既存 custom / 先行 external のいずれかと
    // 既出なら衝突扱い。base を上書きせず、usedKeys に無い一意 key を採番して
    // id-collision エラーカードを登録する。
    if (usedKeys.has(entry.id)) {
      const collisionKey = uniqueKey(`__ext_error__${entry.id}__${i}`, usedKeys);
      extraComponents[collisionKey] = makeErrorCardConfig(
        entry.label,
        entry.id,
        "id-collision",
        `ID '${entry.id}' は既存 component と衝突`,
      );
      usedKeys.add(collisionKey);
      externalKeys.push(collisionKey);
      continue;
    }

    if (item.status === "ok") {
      const defaultProps: Record<string, unknown> = {};
      for (const prop of entry.props ?? []) {
        if (prop.default !== undefined) {
          defaultProps[prop.name] = prop.default;
        }
      }
      // slot は空の editable region として初期化する (#1411 P-3)。
      // Puck は defaultProps の slot 値 (= Content 配列) を起点に DropZone を描画する。
      for (const slot of entry.slots ?? []) {
        defaultProps[slot.name] = [];
      }
      // props field を先に作り、slot field を後ろにマージする (#1411 P-3)。
      const propFields = buildFieldsFromPropDecls(
        (entry.props ?? []).map((p) => ({
          name: p.name,
          type: p.type,
          label: p.label,
          enum: p.enum,
        })),
      );
      const slotFields = buildSlotFields(entry.slots ?? []);
      const Component = item.Component;
      extraComponents[entry.id] = {
        label: `(外部) ${entry.label}`,
        // props → Puck fields 変換 (#1410 P-2、custom 経路と共有ヘルパー)。
        // slot field (#1411 P-3) を後ろにマージ (Puck が render-prop に変換して注入する)。
        fields: { ...propFields, ...slotFields },
        defaultProps,
        render: (props: Record<string, unknown>) =>
          createElement(Component, props),
      };
    } else {
      // エラー entry はエラーカードを描画する component として登録する。
      const { errorKind, detail } = item;
      extraComponents[entry.id] = makeErrorCardConfig(
        entry.label,
        entry.id,
        errorKind,
        detail,
      );
    }
    usedKeys.add(entry.id);
    externalKeys.push(entry.id);
  }

  // categories は受け取った base を immutable に複製。外部が 1 件以上あるときのみ
  // projectExternal を追加する (0 件なら追加しない)。base の既存カテゴリ
  // (projectCustom 含む) は不変。なお loaded.length === 0 は冒頭で early return 済。
  const categories: Config["categories"] = {
    ...(base.categories ?? {}),
    ...(externalKeys.length > 0
      ? {
          projectExternal: {
            title: "プロジェクト部品 (外部)",
            components: externalKeys,
          },
        }
      : {}),
  };

  return {
    ...base,
    categories,
    components: {
      ...base.components,
      ...extraComponents,
    },
  };
}

/**
 * 複合部品 (composite / subtree 再利用、#1412 P-4) を Puck config に統合する。
 *
 * 設計方針: expand-on-drop。複合部品は **placeholder component** として登録され、
 * drop されると PuckBackend の handleChange → expandCompositePlaceholders で
 * その場で subtree に展開され、placeholder 自体は消える。
 *
 * 登録する key 2 種:
 *   1. placeholder: `compositeTypeName(def.id)` (= `__composite__<id>`)
 *      パレットに「複合部品: <label>」として並ぶ。render は最小ラベル。
 *   2. missing-dependency error-card: `compositeErrorTypeName(def.id)`
 *      展開時、subtree 内に config 未登録 type (= 未ロードの外部 component 等) があった
 *      ノードを差し替える先 (capability 6)。expandCompositePlaceholders が参照する。
 *
 * カテゴリは `projectComposite` (title「複合部品」)。既存 `composite` (業務複合 primitive) とは
 * 別物なので名前衝突を避けて projectComposite を使う。
 *
 * 衝突安全性: mergeExternalComponents と同じく base.components の既存 key は絶対に上書きせず、
 * usedKeys / uniqueKey で新規 key の非衝突を保証する。
 */
export function mergeCompositeComponents(
  base: Config,
  composites: CompositePuckComponentDef[],
): Config {
  if (composites.length === 0) return base;

  const extraComponents: Config["components"] = {};
  const usedKeys = new Set<string>(Object.keys(base.components));
  // パレット (projectComposite カテゴリ) に並べる placeholder key のみ収集する。
  // error-card key はパレットに出さない (展開時の差し替え先専用)。
  const placeholderKeys: string[] = [];

  for (let i = 0; i < composites.length; i++) {
    const def = composites[i];
    const placeholderType = uniqueKey(compositeTypeName(def.id), usedKeys);
    usedKeys.add(placeholderType);
    const errorType = uniqueKey(compositeErrorTypeName(def.id), usedKeys);
    usedKeys.add(errorType);

    // placeholder component (drop 直後に展開され消える、render は最小ラベル)。
    extraComponents[placeholderType] = {
      label: `複合部品: ${def.label}`,
      fields: {},
      defaultProps: {},
      render: () =>
        createElement(
          "div",
          {
            "data-composite-placeholder": def.id,
            style: { padding: 8, color: "#666", fontSize: 13 },
          },
          `複合部品: ${def.label}`,
        ),
    };
    placeholderKeys.push(placeholderType);

    // missing-dependency error-card (展開時の依存欠落ノード差し替え先、capability 6)。
    extraComponents[errorType] = {
      label: `(複合部品·依存エラー) ${def.label}`,
      fields: {},
      defaultProps: {},
      render: (props: Record<string, unknown>) =>
        createElement(ExternalComponentErrorCard, {
          errorKind: "missing-dependency",
          label:
            typeof props.compositeLabel === "string"
              ? props.compositeLabel
              : def.label,
          id: typeof props.missingType === "string" ? props.missingType : def.id,
          detail:
            typeof props.missingType === "string"
              ? `部品 type '${props.missingType}' が読み込めません (未ロードの外部 component の可能性)`
              : undefined,
        }),
    };
  }

  const categories: Config["categories"] = {
    ...(base.categories ?? {}),
    ...(placeholderKeys.length > 0
      ? {
          projectComposite: {
            title: "複合部品",
            components: placeholderKeys,
          },
        }
      : {}),
  };

  return {
    ...base,
    categories,
    components: {
      ...base.components,
      ...extraComponents,
    },
  };
}

/** entry.id から複合部品 missing-dependency error-card の Puck component type 名を作る。 */
export function compositeErrorTypeName(id: string): string {
  return `__composite_error__${id}`;
}

/**
 * usedKeys に存在しない一意な key を返す。
 * preferred がそのまま空いていればそれを返し、衝突する場合は suffix
 * (`__2`, `__3`, ...) を付与して必ず空き key を得る。
 * これにより、衝突カード用の key 自体が既存 literal key と衝突する事故を防ぐ。
 */
function uniqueKey(preferred: string, usedKeys: Set<string>): string {
  if (!usedKeys.has(preferred)) return preferred;
  let n = 2;
  let candidate = `${preferred}__${n}`;
  while (usedKeys.has(candidate)) {
    n += 1;
    candidate = `${preferred}__${n}`;
  }
  return candidate;
}

/** ExternalComponentErrorCard を render する Puck component config を生成する。 */
function makeErrorCardConfig(
  label: string,
  id: string,
  errorKind: ExternalComponentErrorKind,
  detail?: string,
): Config["components"][string] {
  return {
    label: `(外部·エラー) ${label}`,
    fields: {},
    defaultProps: {},
    render: () =>
      createElement(ExternalComponentErrorCard, {
        errorKind,
        label,
        id,
        detail,
      }),
  };
}

/** ビルトイン primitive 名一覧 (動的コンポーネント登録 UI で使う) */
export const BUILTIN_PRIMITIVE_NAMES = [
  "container",
  "row",
  "col",
  "section",
  "heading",
  "paragraph",
  "link",
  "input",
  "select",
  "textarea",
  "checkbox",
  "radio",
  "button",
  "table",
  "image",
  "icon",
  "input-group",
  "card",
  "data-list",
  "pagination",
  "region-header",
  "region-sidebar",
  "region-footer",
  "region-main",
] as const;

export type BuiltinPrimitiveName = (typeof BUILTIN_PRIMITIVE_NAMES)[number];
