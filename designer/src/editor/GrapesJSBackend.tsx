/* eslint-disable react-refresh/only-export-components */
/**
 * GrapesJSBackend — EditorBackend の GrapesJS 実装。
 *
 * #806 子 3 / #815 (interface 真の等価性) で完全実装に格上げ。
 *
 * 設計方針:
 * - <GjsEditor> + Canvas + BlocksPanel + RightPanel + DesignSubToolbar (WithEditor 経由)
 *   をラップした完全なエディタペイン (GrapesJSEditorPane) を ReactNode として返す。
 * - Designer.tsx は editorKind に関わらず backend.renderEditor(props) を render するだけになり、
 *   <GjsEditor> 直接マウントを廃止する。
 * - editor lifecycle (registerBlocks / registerValidationTraits / mcpBridge.start /
 *   screenChanged broadcast / カスタムブロック / canvas empty 追跡 等) は本ペイン内に閉じ込める。
 * - 編集中変更 / ready 通知 / server change / mcp status 変化は親 (Designer.tsx) に
 *   onChange / onReady / onServerChanged / onMcpStatusChange callback で伝える。
 * - editor 由来の imperative 操作 (theme apply / reload / refreshCanvas /
 *   isCanvasEmpty / captureThumbnail / getProjectData / clearUndo) は EditorApi として
 *   onReady で expose する。Designer.tsx は API を使って save / discard / theme 切替 /
 *   server change reload / サムネイル生成 を行う。
 *
 * 詳細仕様: docs/spec/multi-editor-puck.md § 3
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { Editor as GEditor } from "grapesjs";
import grapesjs from "grapesjs";
import "grapesjs/dist/css/grapes.min.css";
import GjsEditor, {
  Canvas,
  BlocksProvider,
  WithEditor,
} from "@grapesjs/react";
import html2canvas from "html2canvas";

import type {
  EditorApi,
  EditorBackend,
  EditorState,
  PanelMode,
  RenderEditorProps,
  ThemeId,
} from "./EditorBackend";
import type { CssFramework } from "../types/v3/project";
import { registerBlocks } from "../grapes/blocks";
import { registerValidationTraits } from "../grapes/validationTraits";
import { attachDataItemIdAutoAssign } from "../grapes/dataItemId";
import { attachScreenItemsSync, reconcileScreenItems } from "../grapes/screenItemsSync";
import { registerRemoteStorage } from "../grapes/remoteStorage";
import { mcpBridge, type McpStatus } from "../mcp/mcpBridge";
import { loadCustomBlocks, injectCustomBlockCss } from "../store/customBlockStore";
import { clearItemsFromCache } from "../store/screenItemsStore";
import { BlocksPanel } from "../components/BlocksPanel";
import { RightPanel } from "../components/RightPanel";

// -----------------------------------------------------------------------
// CSS 注入用 URL (Designer.tsx から移植)
// -----------------------------------------------------------------------

const FRAMEWORK_URLS: Record<CssFramework, string> = {
  bootstrap: new URL("../styles/themes/theme-bootstrap.css", import.meta.url).href,
  tailwind: new URL("../styles/themes/theme-tailwind.css", import.meta.url).href,
};

const VARIANT_URLS: Record<ThemeId, string | null> = {
  standard: null,
  card: new URL("../styles/theme-card.css", import.meta.url).href,
  compact: new URL("../styles/theme-compact.css", import.meta.url).href,
  dark: new URL("../styles/theme-dark.css", import.meta.url).href,
};

/**
 * canvas iframe に framework × variant の 2 軸 CSS を注入する (#793 子 5)。
 *
 * 注入順:
 *   1. dz-framework-css  ← FRAMEWORK_URLS[framework] (Bootstrap または Tailwind theme)
 *   2. dz-variant-override ← VARIANT_URLS[variant] (card/compact/dark の上書き、standard は省略)
 */
function applyThemeToCanvas(editor: GEditor, variant: ThemeId, framework: CssFramework) {
  try {
    const canvasDoc = editor.Canvas.getDocument();
    if (!canvasDoc) return;

    const existingFw = canvasDoc.getElementById("dz-framework-css");
    if (existingFw) existingFw.remove();
    const fwLink = canvasDoc.createElement("link");
    fwLink.id = "dz-framework-css";
    fwLink.rel = "stylesheet";
    fwLink.href = FRAMEWORK_URLS[framework];
    canvasDoc.head.appendChild(fwLink);

    const existingVariant = canvasDoc.getElementById("dz-variant-override");
    if (existingVariant) existingVariant.remove();
    const variantUrl = VARIANT_URLS[variant];
    if (variantUrl) {
      const variantLink = canvasDoc.createElement("link");
      variantLink.id = "dz-variant-override";
      variantLink.rel = "stylesheet";
      variantLink.href = variantUrl;
      canvasDoc.head.appendChild(variantLink);
    }
  } catch {
    // canvas not ready
  }
}

/** GrapesJS options を構築する。Designer.tsx の buildGjsOptions から移植 */
function buildGjsOptions(): object {
  return {
    height: "100%",
    width: "auto",
    storageManager: {
      type: "remote",
      autosave: false,
      autoload: true,
    },
    undoManager: { trackSelection: false },
    canvas: {
      styles: [
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css",
        "https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css",
        new URL("../styles/common.css", import.meta.url).href,
      ],
      scripts: [
        "https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js",
      ],
    },
    blockManager: { blocks: [] },
    deviceManager: {
      default: "desktop",
      devices: [
        { id: "desktop", name: "PC", width: "" },
        { id: "tablet", name: "タブレット", width: "768px" },
        { id: "smartphone", name: "スマートフォン", width: "375px" },
      ],
    },
  };
}

/** GrapesJS の getProjectData() が返すプロジェクトデータの最小型 */
interface GjsProjectData {
  pages?: unknown[];
  styles?: unknown[];
  [key: string]: unknown;
}

/** GrapesJS が empty な payload かどうかを判定する */
function isEmptyGjsPayload(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return true;
  const data = payload as GjsProjectData;
  if (!data.pages || !Array.isArray(data.pages) || data.pages.length === 0) return true;
  return false;
}

/**
 * editor.getComponents() が GrapesJS の load() 中に一時的に undefined を返すケース (#131) に対する
 * safe accessor。
 */
function safeComponentsLength(editor: GEditor): number {
  try {
    const comps = editor.getComponents?.();
    return comps?.length ?? 0;
  } catch {
    return 0;
  }
}

/** キャンバスの縮小サムネイルを生成して data URL で返す */
async function captureThumbnail(editor: GEditor): Promise<string | null> {
  try {
    const canvasDoc = editor.Canvas.getDocument();
    if (!canvasDoc?.body) return null;
    const canvasEl = await html2canvas(canvasDoc.body, {
      backgroundColor: "#ffffff",
      scale: 0.5,
      logging: false,
      useCORS: true,
      allowTaint: true,
    });
    const maxWidth = 320;
    if (canvasEl.width <= maxWidth) {
      return canvasEl.toDataURL("image/jpeg", 0.6);
    }
    const scale = maxWidth / canvasEl.width;
    const resized = document.createElement("canvas");
    resized.width = maxWidth;
    resized.height = Math.round(canvasEl.height * scale);
    resized.getContext("2d")?.drawImage(canvasEl, 0, 0, resized.width, resized.height);
    return resized.toDataURL("image/jpeg", 0.6);
  } catch {
    return null;
  }
}

// -----------------------------------------------------------------------
// GrapesJSEditorPane — GrapesJS の完全な React ペイン
// -----------------------------------------------------------------------

/**
 * GrapesJSEditorPane の追加 props。RenderEditorProps の汎用 props に加え、
 * GrapesJS 固有のコールバック (onServerChanged / onMcpStatusChange / onExternalThemeChange)
 * を Designer.tsx から受け取る。
 */
interface GrapesJSEditorPaneProps {
  screenId: string;
  isReadonly: boolean;
  panelMode: PanelMode;
  cssFramework: CssFramework;
  themeVariant: ThemeId;

  subToolbarSlot: ReactNode;
  dialogsSlot: ReactNode;

  onTogglePin: () => void;
  onClosePanel: () => void;
  onStartEditing: () => void;

  /** 編集中変更通知 — markDirty の signal (payload は API.getProjectData() で取得する想定で undefined) */
  onChange?: (state: EditorState) => void;
  /** init 完了時に EditorApi を expose する */
  onReady?: (api: EditorApi) => void;
  /** 他タブ / 別クライアントから screenChanged broadcast を受信した通知 */
  onServerChanged?: () => void;
  /** mcpBridge 接続状態の変化通知 */
  onMcpStatusChange?: (status: McpStatus) => void;
  /** mcpBridge.setThemeHandler 経由で外部から theme 変更要求が来たときの通知 (AI rename 等) */
  onExternalThemeChange?: (themeId: ThemeId) => void;
}

function GrapesJSEditorPane(props: GrapesJSEditorPaneProps) {
  const {
    screenId,
    isReadonly,
    panelMode,
    cssFramework,
    themeVariant,
    subToolbarSlot,
    dialogsSlot,
    onTogglePin,
    onClosePanel,
    onStartEditing,
    onChange,
    onReady,
    onServerChanged,
    onMcpStatusChange,
    onExternalThemeChange,
  } = props;

  const editorRef = useRef<GEditor | null>(null);
  // 初期 load 中および discard 中は markDirty を抑制 (component:* 内部発火を user 編集と区別)
  const isInternalLoadRef = useRef(true);
  const isReadonlyRef = useRef(isReadonly);
  useEffect(() => {
    isReadonlyRef.current = isReadonly;
  }, [isReadonly]);

  // canvas 状態
  const [ready, setReady] = useState(false);
  const [canvasEmpty, setCanvasEmpty] = useState(true);

  // theme 適用に最新の cssFramework を参照する用 ref (closure 越しに最新値を取るため)
  const cssFrameworkRef = useRef<CssFramework>(cssFramework);
  useEffect(() => {
    cssFrameworkRef.current = cssFramework;
  }, [cssFramework]);

  const themeVariantRef = useRef<ThemeId>(themeVariant);
  useEffect(() => {
    themeVariantRef.current = themeVariant;
  }, [themeVariant]);

  // callback ref 化 — onEditor が再生成されないようにする (deps を screenId のみに縮小)
  const onChangeRef = useRef(onChange);
  const onReadyRef = useRef(onReady);
  const onServerChangedRef = useRef(onServerChanged);
  const onMcpStatusChangeRef = useRef(onMcpStatusChange);
  const onExternalThemeChangeRef = useRef(onExternalThemeChange);
  useEffect(() => {
    onChangeRef.current = onChange;
    onReadyRef.current = onReady;
    onServerChangedRef.current = onServerChanged;
    onMcpStatusChangeRef.current = onMcpStatusChange;
    onExternalThemeChangeRef.current = onExternalThemeChange;
  }, [onChange, onReady, onServerChanged, onMcpStatusChange, onExternalThemeChange]);

  /**
   * GrapesJS editor 取得時の初期化 — registerRemoteStorage / registerBlocks / カスタムブロック /
   * 各種 listener / mcpBridge.start を行う。返り値の cleanup 関数は GjsEditor unmount 時に呼ばれる。
   */
  const onEditor = useCallback(
    (editor: GEditor): (() => void) => {
      editorRef.current = editor;

      // remote storage を登録 (GrapesJS が autoload で本体ファイル / draft を読み込む)
      registerRemoteStorage(editor, screenId);

      registerBlocks(editor);
      registerValidationTraits(editor);
      (window as unknown as { editor?: GEditor }).editor = editor;

      // カスタムブロック復元 (非同期で読み込んで GrapesJS に登録)
      loadCustomBlocks()
        .then((customBlocks) => {
          for (const cb of customBlocks) {
            editor.BlockManager.add(cb.id, {
              label: cb.label,
              category: cb.category,
              content: cb.content,
              ...(cb.shared ? { shared: true } : {}),
              ...(cb.media ? { media: cb.media } : {}),
            } as Parameters<typeof editor.BlockManager.add>[1]);
          }
        })
        .catch(console.error);

      const handleDragStart = () => document.body.setAttribute("data-gjs-dragging", "1");
      const handleDragStop = () => document.body.removeAttribute("data-gjs-dragging");
      editor.on("block:drag:start", handleDragStart);
      editor.on("block:drag:stop", handleDragStop);

      // 変更検知: 親 (Designer.tsx) で debounce + updateDraft を行うため、
      // payload は同梱せず undefined を渡す。Designer.tsx は API.getProjectData() で都度取得する。
      const markDirty = () => {
        if (isInternalLoadRef.current) return;
        if (isReadonlyRef.current) return;
        onChangeRef.current?.({ payload: undefined });
      };
      editor.on("component:add component:remove component:update style:change", markDirty);

      // #322: input/select/textarea ブロック drop 時に data-item-id を自動発番
      const unsubDataItemId = attachDataItemIdAutoAssign(editor);

      // #358: canvas ↔ screen-items 双方向同期
      const unsubScreenItemsSync = attachScreenItemsSync(editor, screenId, isInternalLoadRef);

      // mcpBridge 起動
      const unsubStatus = mcpBridge.onStatusChange((status) => {
        onMcpStatusChangeRef.current?.(status);
      });
      mcpBridge.setThemeHandler((themeId) => {
        onExternalThemeChangeRef.current?.(themeId as ThemeId);
      });
      mcpBridge.setCurrentScreenId(screenId);
      mcpBridge.start(editor);

      // 他タブ / 別クライアントの screenChanged broadcast 購読
      const unsubScreenChanged = mcpBridge.onBroadcast("screenChanged", (data) => {
        const d = data as { screenId?: string; deleted?: boolean };
        if (d.screenId !== screenId || d.deleted) return;
        onServerChangedRef.current?.();
      });

      return () => {
        editor.off("component:add component:remove component:update style:change", markDirty);
        editor.off("block:drag:start", handleDragStart);
        editor.off("block:drag:stop", handleDragStop);
        unsubDataItemId();
        unsubScreenItemsSync();
        unsubStatus();
        unsubScreenChanged();
        mcpBridge.setThemeHandler(null);
        mcpBridge.setCurrentScreenId(null);
        clearItemsFromCache(screenId);
      };
    },
    [screenId],
  );

  /** GrapesJS init 完了時 — theme 適用 / カスタムブロック CSS 注入 / EditorApi expose */
  const onGjsReady = useCallback(async () => {
    setReady(true);
    // GrapesJS が ensureValidProject 経由で空データから component:add を 1 回発火するため、
    // 次のマクロタスクでガードを下げる (#131)。同タイミングで canvas ↔ screen-items 初回突合 (#358)。
    setTimeout(() => {
      isInternalLoadRef.current = false;
      if (editorRef.current) reconcileScreenItems(editorRef.current, screenId);
    }, 0);

    if (editorRef.current) {
      // framework × variant の 2 軸 CSS を注入 (#793 子 5)
      applyThemeToCanvas(editorRef.current, themeVariantRef.current, cssFrameworkRef.current);
      // カスタムブロック CSS をキャンバスに注入
      try {
        const customBlocks = await loadCustomBlocks();
        if (customBlocks.some((b) => b.styles)) {
          injectCustomBlockCss(editorRef.current, customBlocks);
        }
      } catch {
        /* ignore */
      }
    }

    // EditorApi を親に expose
    if (onReadyRef.current && editorRef.current) {
      const editor = editorRef.current;
      const api: EditorApi = {
        applyTheme: (variant: ThemeId, framework: CssFramework) => {
          applyThemeToCanvas(editor, variant, framework);
        },
        reload: async () => {
          isInternalLoadRef.current = true;
          try {
            await editor.load();
            editor.UndoManager.clear();
          } finally {
            setTimeout(() => {
              isInternalLoadRef.current = false;
              if (editorRef.current) reconcileScreenItems(editorRef.current, screenId);
            }, 0);
          }
        },
        refreshCanvas: () => {
          editor.refresh();
        },
        isCanvasEmpty: () => safeComponentsLength(editor) === 0,
        captureThumbnail: () => captureThumbnail(editor),
        getProjectData: () => editor.getProjectData(),
        clearUndo: () => editor.UndoManager.clear(),
      };
      onReadyRef.current(api);
    }
  }, [screenId]);

  // canvas-empty 状態を追跡
  useEffect(() => {
    if (!ready || !editorRef.current) return;
    const editor = editorRef.current;
    const check = () => setCanvasEmpty(safeComponentsLength(editor) === 0);
    check();
    editor.on("component:add", check);
    editor.on("component:remove", check);
    return () => {
      editor.off("component:add", check);
      editor.off("component:remove", check);
    };
  }, [ready]);

  return (
    <GjsEditor
      className={`designer-root${isReadonly ? " is-readonly" : ""}`}
      grapesjs={grapesjs}
      options={buildGjsOptions()}
      onEditor={onEditor}
      onReady={onGjsReady}
      waitReady={
        <div className="loading-screen">
          <div className="spinner" />
          <p>デザイナーを起動中...</p>
        </div>
      }
    >
      <div className="designer-layout">
        <WithEditor>{subToolbarSlot}</WithEditor>

        {dialogsSlot}

        <div className="designer-body">
          <div className={`panel-left-wrapper is-${panelMode}`}>
            <aside className="panel-left">
              <div className="panel-section-title">
                <span className="title-text">
                  <i className="bi bi-grid-3x3-gap-fill" /> ブロック
                </span>
                <div className="panel-ctrl-btns">
                  <button
                    className={`panel-ctrl-btn${panelMode === "pinned" ? " pin-active" : ""}`}
                    onClick={onTogglePin}
                    title={panelMode === "pinned" ? "ピンを外す（ホバー表示に切替）" : "ピンで固定"}
                  >
                    <i className={`bi bi-pin${panelMode === "pinned" ? "-fill" : ""}`} />
                  </button>
                  <button
                    className="panel-ctrl-btn"
                    onClick={onClosePanel}
                    title="パネルを閉じる"
                  >
                    <i className="bi bi-x-lg" />
                  </button>
                </div>
              </div>
              <BlocksProvider>
                {(blocksProps) => <BlocksPanel {...blocksProps} />}
              </BlocksProvider>
            </aside>
          </div>

          <main className="panel-canvas">
            <Canvas className="designer-canvas" />
            {/* read-only オーバーレイ: 編集中でないときに canvas 中央に「編集開始」ボタンを表示 */}
            {isReadonly && ready && (
              <div className="canvas-readonly-overlay" data-testid="canvas-readonly-overlay">
                <button
                  type="button"
                  className="canvas-readonly-start-btn"
                  onClick={onStartEditing}
                  data-testid="canvas-readonly-start"
                >
                  <i className="bi bi-pencil-fill" />
                  編集開始
                </button>
              </div>
            )}
            {canvasEmpty && ready && !isReadonly && (
              <div className="canvas-empty-hint">
                <i className="bi bi-grid-1x2" />
                <p>左のパネルからブロックをここにドラッグしてください</p>
              </div>
            )}
          </main>

          <aside className="panel-right">
            <RightPanel screenId={screenId} />
          </aside>
        </div>
      </div>
    </GjsEditor>
  );
}

// -----------------------------------------------------------------------
// GrapesJSBackend 実装
// -----------------------------------------------------------------------

/**
 * GrapesJSBackend — GrapesJS エディタの load / save / renderEditor を提供する。
 *
 * Designer.tsx との役割分担 (#815 PR-B 完了後):
 * - Designer.tsx: 編集セッション state、dirty 追跡、debounce updateDraft、サムネイル保存、
 *   各種ダイアログ、 legacy localStorage 救済、theme/cssFramework state
 * - GrapesJSBackend: <GjsEditor> マウント、registerBlocks 等 editor 初期化、canvas-empty 追跡、
 *   theme apply、reload、サムネイル生成 (API として expose)、screenChanged broadcast 受信通知
 *
 * #815: renderEditor() は <GrapesJSEditorPane> を返す。Designer.tsx の
 * editorKind === "grapesjs" 経路は backend.renderEditor(props) を render するだけになる。
 */
export class GrapesJSBackend implements EditorBackend {
  /**
   * screen の payload を読み込み EditorState を返す。
   * draftRead は MCP bridge 経由の draft 読込み (edit-session-draft #683)。
   *
   * GrapesJS 自体の load() は registerRemoteStorage 経由で内部処理されるため、
   * ここでは payload を EditorState にラップして返すだけ (PR-B 段階)。
   * PR-C で registerRemoteStorage を撤去し、明示 load (editor.loadProjectData) に切り替える。
   */
  async load(screenId: string, draftRead: () => Promise<unknown>): Promise<EditorState> {
    let payload: unknown = null;
    try {
      payload = await draftRead();
    } catch {
      // draft が存在しない場合は null のまま (GrapesJS が autoload で本体ファイルを読む)
    }
    return { payload, ui: { screenId } };
  }

  /**
   * editor state を save。
   * GrapesJS の getProjectData() を payload として draftWrite に渡す。
   * 本体ファイルへの昇格 (commitDraft + releaseLock) は Designer.tsx が担う。
   */
  async save(
    _screenId: string,
    state: EditorState,
    draftWrite: (payload: unknown) => Promise<void>,
  ): Promise<void> {
    await draftWrite(state.payload);
  }

  /**
   * エディタペイン全体 (subToolbar / dialogs / Canvas / BlocksPanel / RightPanel) を ReactNode として返す。
   *
   * RenderEditorProps の汎用 callback (onChange / onReady) に加え、
   * GrapesJS 固有の callback (onServerChanged / onMcpStatusChange / onExternalThemeChange) も
   * Pane が要求するため、props を拡張する形で受け取る。これらは Designer.tsx が provide する。
   */
  renderEditor(props: RenderEditorProps): ReactNode {
    const grapesProps = props as RenderEditorProps & {
      onServerChanged?: () => void;
      onMcpStatusChange?: (status: McpStatus) => void;
      onExternalThemeChange?: (themeId: ThemeId) => void;
    };

    return (
      <GrapesJSEditorPane
        screenId={props.screenId}
        isReadonly={props.isReadonly}
        panelMode={props.panelMode}
        cssFramework={props.cssFramework}
        themeVariant={props.themeVariant}
        subToolbarSlot={props.subToolbarSlot}
        dialogsSlot={props.dialogsSlot}
        onTogglePin={props.onTogglePin}
        onClosePanel={props.onClosePanel}
        onStartEditing={props.onStartEditing}
        onChange={props.onChange}
        onReady={props.onReady}
        onServerChanged={grapesProps.onServerChanged}
        onMcpStatusChange={grapesProps.onMcpStatusChange}
        onExternalThemeChange={grapesProps.onExternalThemeChange}
      />
    );
  }
}

// -----------------------------------------------------------------------
// Helper: empty payload 判定 (テスト等から利用可能にする)
// -----------------------------------------------------------------------
export { isEmptyGjsPayload };
