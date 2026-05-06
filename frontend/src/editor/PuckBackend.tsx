/* eslint-disable react-refresh/only-export-components */
/**
 * PuckBackend — EditorBackend の Puck 実装。
 *
 * 子 3 の HeadingBlock 単体 Config を廃止し、子 4 で実装した全 primitive
 * (20 個) を buildPuckConfig() 経由で組み込む。
 *
 * 子 5: 動的コンポーネント (customComponents) を buildPuckConfig() に渡し、
 * workspace 永続化のカスタムコンポーネントを Puck Config に反映する。
 * puckComponentsChanged broadcast event を購読し、コンポーネント変更時に Config 再構築。
 *
 * CssFrameworkContext.Provider で Puck コンポーネントツリーを wrap することで、
 * 各 primitive の render 関数が useCssFramework() で cssFramework を参照できる。
 *
 * 詳細仕様: docs/spec/multi-editor-puck.md § 3 / § 4.2 / § 4.3
 *
 * #806 子 4 / 子 5 / #815 (renderEditor が ReactNode を返す形に統一)
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Puck } from "@measured/puck";
import type { Data, Config } from "@measured/puck";
import "@measured/puck/puck.css";

// Puck canvas はメイン app DOM 内に描画されるため、GrapesJS の canvas iframe と異なり
// theme CSS をメイン document.head に直接注入する必要がある (#835)。
const PUCK_THEME_URLS: Record<"bootstrap" | "tailwind", string> = {
  bootstrap: new URL("../styles/themes/theme-bootstrap.css", import.meta.url).href,
  tailwind: new URL("../styles/themes/theme-tailwind.css", import.meta.url).href,
};

import type {
  EditorApi,
  EditorBackend,
  EditorState,
  PuckRenderEditorProps,
} from "./EditorBackend";
import { CssFrameworkProvider } from "../puck/CssFrameworkContext";
import { buildPuckConfig } from "../puck/buildConfig";
import {
  loadCustomPuckComponents,
  type CustomPuckComponentDef,
} from "../store/puckComponentsStore";
import { RegisterComponentDialog } from "../components/puck/RegisterComponentDialog";
import { mcpBridge } from "../mcp/mcpBridge";

// -----------------------------------------------------------------------
// 空の Puck Data (新規画面のデフォルト)
// -----------------------------------------------------------------------

/** 空の Puck Data (新規画面のデフォルト)。 */
const EMPTY_PUCK_DATA: Data = {
  root: { props: {} },
  content: [],
};

/** unknown を Puck Data に安全にキャストする。失敗したら EMPTY_PUCK_DATA を返す。 */
function toPuckData(payload: unknown): Data {
  if (
    payload !== null &&
    typeof payload === "object" &&
    "root" in payload &&
    "content" in payload
  ) {
    return payload as Data;
  }
  return EMPTY_PUCK_DATA;
}

// -----------------------------------------------------------------------
// buildPuckConfig with custom components (§ 4.2)
// -----------------------------------------------------------------------

/**
 * カスタムコンポーネント定義を Puck Config に動的追加する。
 * ビルトイン primitive の config をベースに、個別 propsSchema + 共通 LAYOUT_FIELDS をマージ。
 */
function buildConfigWithCustomComponents(customComponents: CustomPuckComponentDef[]): Config {
  const base = buildPuckConfig();

  if (customComponents.length === 0) return base;

  const extraComponents: Config["components"] = {};

  for (const def of customComponents) {
    const primitiveKey = Object.keys(base.components).find(
      (k) => k.toLowerCase() === def.primitive.toLowerCase().replace(/-/g, ""),
    );
    const baseComponentConfig = primitiveKey ? base.components[primitiveKey] : undefined;

    const customFields: Config["components"][string]["fields"] = {};
    for (const [fieldName, fieldDef] of Object.entries(def.propsSchema)) {
      if (fieldDef.type === "enum" && fieldDef.enum && fieldDef.enum.length > 0) {
        customFields[fieldName] = {
          type: "select" as const,
          label: fieldDef.label ?? fieldName,
          options: fieldDef.enum.map((opt) => ({ label: opt.label, value: opt.value })),
        };
      } else if (fieldDef.type === "boolean") {
        customFields[fieldName] = {
          type: "radio" as const,
          label: fieldDef.label ?? fieldName,
          options: [
            { label: "はい", value: "true" },
            { label: "いいえ", value: "false" },
          ],
        };
      } else {
        customFields[fieldName] = {
          type: "text" as const,
          label: fieldDef.label ?? fieldName,
        };
      }
    }

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
          ...customFields,
          ...(baseComponentConfig.fields ?? {}),
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
        render: (props: Record<string, unknown>) => (
          <div data-custom-component={def.id} data-primitive={def.primitive}>
            {JSON.stringify(props)}
          </div>
        ),
      };
    }
  }

  return {
    ...base,
    components: {
      ...base.components,
      ...extraComponents,
    },
  };
}

// -----------------------------------------------------------------------
// PuckEditorPane (React コンポーネント)
//   #815 で createRoot 経由のマウントを廃止。Designer.tsx からは
//   PuckBackend.renderEditor() の戻り値として返される ReactNode に含まれる。
// -----------------------------------------------------------------------

interface PuckEditorPaneProps {
  initialData: Data;
  cssFramework: "bootstrap" | "tailwind";
  onChange?: (state: EditorState) => void;
  onReady?: (api: EditorApi) => void;
  /** discard / serverChange reload 時に最新 payload を取得する関数 (#815 Codex Must-fix #2/#3) */
  reloadPayload?: () => Promise<unknown>;
}

function PuckEditorPane({
  initialData,
  cssFramework,
  onChange,
  onReady,
  reloadPayload,
}: PuckEditorPaneProps) {
  const [customComponents, setCustomComponents] = useState<CustomPuckComponentDef[]>([]);
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  // 編集中の Puck Data を state として保持 (カスタムコンポーネント変更による Puck 再マウント時に
  // 未保存編集を保持するため Puck の data prop に渡す値を持続させる)。
  const [currentData, setCurrentData] = useState<Data>(initialData);
  // カスタムコンポーネント変更時に Puck を強制再マウントする key
  const [remountKey, setRemountKey] = useState(0);
  // EditorApi が getProjectData() で最新値を返すため、ref で同期する (effect/handler 内のみ参照)
  const currentDataRef = useRef<Data>(initialData);
  useEffect(() => {
    currentDataRef.current = currentData;
  }, [currentData]);

  // theme CSS を document.head に注入する。GrapesJS は canvas iframe に注入するが、
  // Puck はメイン app DOM 内に直接 render するためこちらで対応する (#835)。
  // mount 中のみ <head> へ注入。主 app の Bootstrap chrome と一部 utility が global collision するが、
  // unmount 時 cleanup で解消。完全 scoping は別 ISSUE。
  useEffect(() => {
    const ID = "puck-theme-css";
    const existing = document.getElementById(ID);
    if (existing) existing.remove();
    const link = document.createElement("link");
    link.id = ID;
    link.rel = "stylesheet";
    link.href = PUCK_THEME_URLS[cssFramework];
    document.head.appendChild(link);
    return () => {
      link.remove();
    };
  }, [cssFramework]);

  const reloadCustomComponents = useCallback(async () => {
    try {
      const loaded = await loadCustomPuckComponents();
      setCustomComponents(loaded);
      setRemountKey((k) => k + 1);
    } catch (e) {
      console.warn("[PuckBackend] Failed to load custom puck components:", e);
    }
  }, []);

  // 初期マウント時にカスタムコンポーネントを fetch する。setState を伴う effect だが
  // 「外部 (server) から data を取得して state に反映」の正規パターンのため抑制。
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadCustomComponents();
  }, [reloadCustomComponents]);

  // mcpBridge broadcast: 別タブでカスタムコンポーネントが変わったら再ロード
  useEffect(() => {
    const unsub = mcpBridge.onBroadcast("puckComponentsChanged", () => {
      void reloadCustomComponents();
    });
    return () => { unsub(); };
  }, [reloadCustomComponents]);

  // ready 通知 + 軽量 EditorApi expose (Puck は editor インスタンスを持たないので限定的)
  // reloadPayload を ref 化して effect の deps に含めず、最新 callback を使い続けられるようにする
  const reloadPayloadRef = useRef(reloadPayload);
  useEffect(() => {
    reloadPayloadRef.current = reloadPayload;
  }, [reloadPayload]);

  useEffect(() => {
    if (!onReady) return;
    const api: EditorApi = {
      // Puck は cssFramework を Context 経由で適用するため canvas iframe theme injection は不要
      applyTheme: () => { /* no-op for Puck */ },
      // #815 Codex Must-fix #2/#3: discard / serverChange reload で Puck の data を再取得して反映する
      reload: async () => {
        const fn = reloadPayloadRef.current;
        if (!fn) return;
        const newPayload = await fn();
        const newData = toPuckData(newPayload);
        setCurrentData(newData);
        // remountKey を increment して Puck を強制再マウント (initial data prop は mount 時のみ反映されるため)
        setRemountKey((k) => k + 1);
      },
      refreshCanvas: () => { /* Puck 内部で管理 */ },
      isCanvasEmpty: () => {
        const data = currentDataRef.current;
        return !data.content || data.content.length === 0;
      },
      captureThumbnail: async () => null,
      getProjectData: () => currentDataRef.current,
      clearUndo: () => { /* Puck has its own history; no-op */ },
    };
    onReady(api);
  }, [onReady]);

  const config = useMemo(
    () => buildConfigWithCustomComponents(customComponents),
    [customComponents],
  );

  const handleChange = useCallback(
    (data: Data) => {
      setCurrentData(data);
      onChange?.({ payload: data });
    },
    [onChange],
  );

  const handleComponentSaved = useCallback(() => {
    void reloadCustomComponents();
  }, [reloadCustomComponents]);

  return (
    <CssFrameworkProvider value={cssFramework}>
      {/* 新規コンポーネント登録ボタン (パレット上部相当) */}
      <div
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 100,
        }}
      >
        <button
          type="button"
          onClick={() => setShowRegisterDialog(true)}
          style={{
            padding: "6px 12px",
            background: "#0070f3",
            color: "#fff",
            border: "none",
            borderRadius: 4,
            cursor: "pointer",
            fontSize: 13,
          }}
        >
          + 新規コンポーネント
        </button>
      </div>

      <Puck
        key={remountKey}
        config={config}
        data={currentData}
        onChange={handleChange}
        // ヘッダーのデフォルト "Publish" ボタンは PuckBackend では使わない。
        // 明示保存式 (#683) なので onPublish は no-op。
        onPublish={() => { /* no-op: 明示保存は Designer.tsx の handleSave 経由 */ }}
      />

      {showRegisterDialog && (
        <RegisterComponentDialog
          onClose={() => setShowRegisterDialog(false)}
          onSaved={handleComponentSaved}
        />
      )}
    </CssFrameworkProvider>
  );
}

// -----------------------------------------------------------------------
// PuckBackend 実装
// -----------------------------------------------------------------------

/**
 * PuckBackend — @measured/puck を用いる EditorBackend 実装。
 *
 * ライフサイクル:
 *   1. load()         — draftRead で Puck Data を取得 (無ければ empty data)
 *   2. renderEditor() — ReactNode (PuckEditorPane を含むペイン) を返す
 *   3. save()         — Puck Data を draftWrite に渡す
 *
 * #815: createRoot 経由のマウントを廃止し React コンポーネントを返す形に統一。
 */
export class PuckBackend implements EditorBackend<PuckRenderEditorProps> {
  /**
   * screen の payload を読み込み EditorState を返す。
   * payload が空なら EMPTY_PUCK_DATA を使用する。
   */
  async load(
    _screenId: string,
    draftRead: () => Promise<unknown>,
  ): Promise<EditorState> {
    let payload: unknown = null;
    try {
      payload = await draftRead();
    } catch {
      // draft が存在しない場合は空 Puck Data を使用する
    }

    const puckData = toPuckData(payload);
    return { payload: puckData };
  }

  /**
   * editor state を save。
   * Puck Data を payload としてそのまま draftWrite に渡す。
   */
  async save(
    _screenId: string,
    state: EditorState,
    draftWrite: (payload: unknown) => Promise<void>,
  ): Promise<void> {
    await draftWrite(state.payload);
  }

  /**
   * エディタペイン全体 (subToolbar / dialogs / Puck 本体) を ReactNode として返す。
   *
   * Puck では editor 周辺 UI (左パレット / 右プロパティパネル / 上ヘッダー) は Puck 内部で
   * 完結しているため、Backend が提供する panelLeft / panelRight 等は無く、
   * subToolbarSlot と dialogsSlot のみ container 上部に配置する。
   */
  renderEditor(props: PuckRenderEditorProps): React.ReactNode {
    const puckData = toPuckData(props.state.payload);
    return (
      <div className={`designer-root${props.isReadonly ? " is-readonly" : ""}`}>
        <div className="designer-layout">
          {props.subToolbarSlot}
          {props.dialogsSlot}
          {/* Puck エディタコンテナ (data-testid は E2E で使用される) */}
          <div
            className="puck-editor-container"
            style={{ flex: 1, overflow: "auto" }}
            data-testid="puck-editor-container"
          >
            {/* key={screenId} で screenId 変更時に Pane を remount し initialData を確実に新 payload にする (#815 Codex Must-fix #1) */}
            <PuckEditorPane
              key={props.screenId}
              initialData={puckData}
              cssFramework={props.cssFramework}
              onChange={props.onChange}
              onReady={props.onReady}
              reloadPayload={props.reloadPayload}
            />
          </div>
        </div>
      </div>
    );
  }
}
