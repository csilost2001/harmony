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
import { Puck, createUsePuck } from "@measured/puck";
import type { Data, Overrides } from "@measured/puck";
import "@measured/puck/puck.css";

// usePuck は <Puck> context 内 (children / overrides) でのみ利用可 (Puck 0.20)。
// 複合部品化ボタンを overrides.headerActions に置くために factory で生成する。
const usePuck = createUsePuck();

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
import {
  buildConfigWithCustomComponents,
  mergeExternalComponents,
  mergeCompositeComponents,
  compositeErrorTypeName,
  BUILTIN_PRIMITIVE_TYPE_NAMES,
} from "../puck/buildConfig";
import {
  loadExternalComponents,
  type LoadedExternalComponent,
} from "../puck/externalComponents";
import {
  loadCustomPuckComponents,
  type CustomPuckComponentDef,
  type CompositePuckComponentDef,
} from "../store/puckComponentsStore";
import {
  expandCompositePlaceholders,
  extractSubtree,
  collectDependencies,
  type ExpandableComposite,
} from "./puckSubtree";
import { RegisterComponentDialog } from "../components/puck/RegisterComponentDialog";
import { SaveCompositeDialog } from "../components/puck/SaveCompositeDialog";
import { mcpBridge } from "../mcp/mcpBridge";
import { useWorkspacePath } from "../hooks/useWorkspacePath";

// -----------------------------------------------------------------------
// 空の Puck Data (新規画面のデフォルト)
// -----------------------------------------------------------------------

/** 空の Puck Data (新規画面のデフォルト)。 */
const EMPTY_PUCK_DATA: Data = {
  root: { props: {} },
  content: [],
};

/**
 * built-in primitive の Puck config type 名集合 (S-3)。
 * collectDependencies に渡すと外部 component を「built-in 扱いしない」→ 依存として正しく記録される。
 */
const BUILTIN_PRIMITIVE_TYPE_SET = new Set<string>(BUILTIN_PRIMITIVE_TYPE_NAMES);

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
  // 現在の active workspace の wsId (#1415 P2-1)。外部 component asset URL を当該 workspace に
  // scope するために loadExternalComponents に渡す。Designer は /w/:wsId/screen/design/:id 配下で
  // マウントされるため useParams 経由で取得できる。
  const { wsId } = useWorkspacePath();
  const [customComponents, setCustomComponents] = useState<CustomPuckComponentDef[]>([]);
  // 複合部品 (#1412 P-4): subtree 再利用部品。同じ puck-components.json に相乗りで永続化。
  const [composites, setComposites] = useState<CompositePuckComponentDef[]>([]);
  // 外部 React Component (#1409 P-1): manifest 経由で runtime 読込される業務 component。
  // 初期は空配列、解決後に反映 (ロード中も既存 UI を阻害しない)。
  const [externalComponents, setExternalComponents] = useState<LoadedExternalComponent[]>([]);
  const [showRegisterDialog, setShowRegisterDialog] = useState(false);
  // 複合部品保存ダイアログ。headerActions ボタンが切出し済 subtree をセットして開く。
  const [compositeToSave, setCompositeToSave] = useState<{
    tree: import("./puckSubtree").Subtree;
    dependencies: string[];
  } | null>(null);
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
      // primitive / composite を kind で振り分ける (#1412 P-4)。
      setCustomComponents(loaded);
      setComposites(
        loaded.filter(
          (c): c is CompositePuckComponentDef => c.kind === "composite",
        ),
      );
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

  // 外部 React Component (#1409 P-1) を manifest 経由で読み込む。
  // manifest 無し → 空配列 (正常系)。失敗 entry はエラーカードとして config に統合される。
  const reloadExternalComponents = useCallback(async () => {
    try {
      // wsId scope (#1415 P2-1)。wsId が取れない場合は loader が空配列を返す (外部部品なし扱い)。
      const loaded = await loadExternalComponents({ wsId });
      setExternalComponents(loaded);
      setRemountKey((k) => k + 1);
    } catch (e) {
      console.warn("[PuckBackend] Failed to load external components:", e);
    }
  }, [wsId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void reloadExternalComponents();
  }, [reloadExternalComponents]);

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
      setProjectData: (payload: unknown) => {
        const newData = toPuckData(payload);
        setCurrentData(newData);
        currentDataRef.current = newData;
        setRemountKey((k) => k + 1);
      },
      clearUndo: () => { /* Puck has its own history; no-op */ },
    };
    onReady(api);
  }, [onReady]);

  const config = useMemo(
    () =>
      // config チェーン 3 段: custom (primitive) → external (#1411) → composite (#1412 P-4)。
      mergeCompositeComponents(
        mergeExternalComponents(
          buildConfigWithCustomComponents(customComponents),
          externalComponents,
        ),
        composites,
      ),
    [customComponents, externalComponents, composites],
  );

  // 複合部品展開で「依存解決済」判定に使う、現 config に存在する全 type 名集合。
  const availableTypes = useMemo(
    () => new Set(Object.keys(config.components)),
    [config],
  );

  // 複合部品の展開可能形 (placeholder type 検出 + 依存欠落差し替え先 errorType)。
  const expandableComposites = useMemo<ExpandableComposite[]>(
    () =>
      composites.map((c) => ({
        id: c.id,
        label: c.label,
        tree: { content: c.tree.content, ...(c.tree.zones ? { zones: c.tree.zones } : {}) },
        errorType: compositeErrorTypeName(c.id),
      })),
    [composites],
  );

  const handleChange = useCallback(
    (data: Data) => {
      // 複合部品 placeholder が含まれていればその場で subtree に展開する (expand-on-drop)。
      // expandCompositePlaceholders は冪等 (placeholder 無し → 同一構造) なので
      // 展開後 data には placeholder が無く、再度の onChange でループしない。
      const expanded = expandCompositePlaceholders(
        data,
        expandableComposites,
        availableTypes,
      );
      setCurrentData(expanded);
      onChange?.({ payload: expanded });
    },
    [onChange, expandableComposites, availableTypes],
  );

  const handleComponentSaved = useCallback(() => {
    void reloadCustomComponents();
  }, [reloadCustomComponents]);

  // 「選択を複合部品化」要求のハンドラ。CompositeSaveButton (usePuck で selectedItem /
  // appState.data を取得) から呼ばれ、subtree を切出して保存ダイアログを開く。
  const handleRequestSaveComposite = useCallback(
    (data: Data, rootItemId: string) => {
      const tree = extractSubtree(data, rootItemId);
      if (!tree) {
        // S-2: 完全無音失敗を避ける (zones 探索後も見つからない異常系のみここに来る)。
        console.warn(
          `[PuckBackend] 複合部品化: rootItemId '${rootItemId}' のノードが content・zones いずれにも見つかりません`,
        );
        return;
      }
      // S-3: 依存メタは built-in primitive 型のみを「built-in 扱い」にする。
      // availableTypes (= 全 config 型、外部 component 込み) を渡すと外部 component が
      // dependencies[] から除外され不完全になるため、BUILTIN_PRIMITIVE_NAMES から集合を作る。
      const dependencies = collectDependencies(tree, BUILTIN_PRIMITIVE_TYPE_SET);
      setCompositeToSave({ tree, dependencies });
    },
    [],
  );

  // overrides.headerActions に複合部品化ボタンを差し込む (<Puck> context 内で usePuck 利用可)。
  const overrides = useMemo<Partial<Overrides>>(
    () => ({
      headerActions: ({ children }) => (
        <>
          <CompositeSaveButton onRequestSave={handleRequestSaveComposite} />
          {children}
        </>
      ),
    }),
    [handleRequestSaveComposite],
  );

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
        overrides={overrides}
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

      {compositeToSave && (
        <SaveCompositeDialog
          tree={compositeToSave.tree}
          dependencies={compositeToSave.dependencies}
          onClose={() => setCompositeToSave(null)}
          onSaved={() => {
            setCompositeToSave(null);
            void reloadCustomComponents();
          }}
        />
      )}
    </CssFrameworkProvider>
  );
}

// -----------------------------------------------------------------------
// CompositeSaveButton — <Puck> context 内で selectedItem を読む複合部品化ボタン。
//   usePuck は <Puck> の children / overrides でのみ利用可 (Puck 0.20) のため、
//   overrides.headerActions から render される本コンポーネント内で利用する。
// -----------------------------------------------------------------------

interface CompositeSaveButtonProps {
  /** 選択中ノードを root とする subtree 切出し + 保存ダイアログ起動を要求する。 */
  onRequestSave: (data: Data, rootItemId: string) => void;
}

function CompositeSaveButton({ onRequestSave }: CompositeSaveButtonProps) {
  // 選択中 item と現在の Data を granular selector で購読する (無関係 state 変化で再描画しない)。
  const selectedItem = usePuck((s) => s.selectedItem);
  const data = usePuck((s) => s.appState.data);

  const selectedId =
    selectedItem && typeof selectedItem.props?.id === "string"
      ? selectedItem.props.id
      : null;
  const disabled = !selectedId;

  return (
    <button
      type="button"
      data-testid="save-composite-button"
      disabled={disabled}
      title={
        disabled
          ? "キャンバス上のノードを選択すると複合部品化できます"
          : "選択中ノードを複合部品として保存"
      }
      onClick={() => {
        if (!selectedId) return;
        onRequestSave(data, selectedId);
      }}
      style={{
        padding: "6px 12px",
        background: disabled ? "#9bb7e0" : "#0070f3",
        color: "#fff",
        border: "none",
        borderRadius: 4,
        cursor: disabled ? "not-allowed" : "pointer",
        fontSize: 13,
        marginRight: 8,
      }}
    >
      + 選択を複合部品化
    </button>
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
