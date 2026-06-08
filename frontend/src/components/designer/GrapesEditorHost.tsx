// #1388 sub-section A 派生 2 件: Designer.tsx L1106 で trigger していた
// react-hooks/refs (renderEditor 戻り値の JSX expression 内で ref 書き込み closure
// を含む grapesProps が読まれる) を解消するため、grapesBackend.renderEditor() の
// 呼び出し + subToolbar / props 構築 + 関連 banner / modal を独立 component に隔離。
// `grapesEditorInstanceRef` / `showCompositionPreview` も host 内に閉じ込め、
// Designer scope から ref / state を取り除く。
import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { DesignSubToolbarGrapesJSBridge } from "../design/DesignSubToolbar";
import type { GrapesJSBackend } from "../../editor/GrapesJSBackend";
import type {
  DesignerResourceKind,
  EditorApi,
  EditorState,
  GrapesJSRenderEditorProps,
  PanelMode,
  ThemeId,
} from "../../editor/EditorBackend";
import type { McpStatus } from "../../mcp/mcpBridge";
import type { CssFramework } from "../../types/v3/harmony";
import type { EditMode } from "../../hooks/useEditSession";
import type { GadgetBlockScreen } from "../../grapes/blocks";
import {
  composePreviewHtml,
  buildCompositionPreviewSrcDoc,
} from "../../utils/pageLayoutCompositionPreview";
import { buildPreviewStyleHrefs } from "../../editor/grapesCanvasAssets";

export interface GrapesEditorHostProps {
  backend: GrapesJSBackend;
  state: EditorState;

  cssFramework: CssFramework;
  themeVariant: ThemeId;
  isReadonly: boolean;
  panelMode: PanelMode;
  screenId: string;
  resourceKind?: DesignerResourceKind;
  screenName?: string;

  mcpStatus: McpStatus;
  isDirty: boolean;
  isSaving: boolean;

  sessionMode: EditMode;
  sessionId: string;
  onBack?: () => void;

  onTogglePin: () => void;
  onClosePanel: () => void;
  onOpenPanel: () => void;

  onThemeChange: (themeId: ThemeId) => void;

  onSaveToFile: () => Promise<void>;
  onResetRequest: () => void;
  onAiGenerate: () => void;

  onStartEditing: () => void;
  onViewerAttached: (editSessionId: string) => void;
  onAttachAsView: (editSessionId: string) => Promise<void>;
  onTakeOver: (editSessionId: string) => Promise<void>;
  onOpenRenameDialog?: () => void;

  onChange: GrapesJSRenderEditorProps["onChange"];
  onReady: (api: EditorApi) => void;
  onServerChanged: GrapesJSRenderEditorProps["onServerChanged"];
  onMcpStatusChange: GrapesJSRenderEditorProps["onMcpStatusChange"];
  onExternalThemeChange: GrapesJSRenderEditorProps["onExternalThemeChange"];
  reloadPayload: GrapesJSRenderEditorProps["reloadPayload"];

  dialogsSlot: ReactNode;

  // page layout 関連 (pl-5 #1026 / pl-6 #1021)
  mismatchWarnings: string[];
  pageLayoutId?: string;
  pageLayoutName?: string;
  pageLayoutHtml?: string;
  pageLayoutAssignments?: Record<string, string>;
  gadgetHtmlMap?: Map<string, string>;
  // #1406: composition preview に project CSS を合成するための CSS データ
  pageLayoutCss?: string;
  gadgetCssMap?: Map<string, string>;
  onGrapesEditorReady?: (editor: import("grapesjs").Editor) => void;
  gadgetBlocks?: GadgetBlockScreen[];
}

export function GrapesEditorHost(props: GrapesEditorHostProps) {
  // pl-5 #1026: raw GrapesJS editor instance を host 内 state で保有
  // (composition preview modal の getScreenContent で getHtml() 用)。
  // #1388 派生 2 件: ref ではなく state にすることで `react-hooks/refs` (render 中の
  // ref write closure 経由 trigger) を解消。PR #1389 の Backend ref → state 化と同じパターン。
  const [grapesEditor, setGrapesEditor] = useState<import("grapesjs").Editor | null>(null);
  // pl-6 (Codex C-1): composition preview modal の表示状態
  const [showCompositionPreview, setShowCompositionPreview] = useState(false);

  const onGrapesEditorReadyProp = props.onGrapesEditorReady;
  const handleGrapesEditorInstance = useCallback(
    (editor: import("grapesjs").Editor) => {
      setGrapesEditor(editor);
      onGrapesEditorReadyProp?.(editor);
    },
    [onGrapesEditorReadyProp],
  );

  const subToolbar = (
    <DesignSubToolbarGrapesJSBridge
      panelMode={props.panelMode}
      onOpenPanel={props.onOpenPanel}
      activeTheme={props.themeVariant}
      onThemeChange={props.onThemeChange}
      mcpStatus={props.mcpStatus}
      isDirty={props.isDirty}
      isSaving={props.isSaving}
      onSaveToFile={props.onSaveToFile}
      onReset={async () => props.onResetRequest()}
      onAiGenerate={props.onAiGenerate}
      backLink={props.onBack ? { label: props.screenName ?? "画面デザイン", onClick: props.onBack } : undefined}
      screenId={props.screenId}
      enableScreenRename={props.resourceKind !== "pageLayout"}
      isReadonly={props.isReadonly}
      sessionMode={props.sessionMode}
      sessionId={props.sessionId}
      onStartEditing={props.onStartEditing}
      onViewerAttached={props.onViewerAttached}
      onAttachAsView={props.onAttachAsView}
      onTakeOver={props.onTakeOver}
      onOpenRenameDialog={props.onOpenRenameDialog}
    />
  );

  const editorProps: GrapesJSRenderEditorProps = {
    state: props.state,
    cssFramework: props.cssFramework,
    themeVariant: props.themeVariant,
    isReadonly: props.isReadonly,
    subToolbarSlot: subToolbar,
    dialogsSlot: props.dialogsSlot,
    panelMode: props.panelMode,
    onTogglePin: props.onTogglePin,
    onClosePanel: props.onClosePanel,
    screenId: props.screenId,
    resourceKind: props.resourceKind,
    onChange: props.onChange,
    onReady: props.onReady,
    onServerChanged: props.onServerChanged,
    onMcpStatusChange: props.onMcpStatusChange,
    onExternalThemeChange: props.onExternalThemeChange,
    reloadPayload: props.reloadPayload,
    gadgetBlocks: props.gadgetBlocks,
    onGrapesEditorInstance: handleGrapesEditorInstance,
  };

  const getScreenContent = useCallback(() => {
    try {
      return grapesEditor?.getHtml() ?? "";
    } catch {
      return "";
    }
  }, [grapesEditor]);

  // #1406: 編集中 Screen の project CSS (GrapesJS Style Manager で付与された規則) を
  // composition preview に合成するため live editor から取得する。
  const getScreenCss = useCallback(() => {
    try {
      return grapesEditor?.getCss?.() ?? "";
    } catch {
      return "";
    }
  }, [grapesEditor]);

  const handlePreviewClick = useCallback(() => {
    setShowCompositionPreview(true);
  }, []);

  const handleClosePreview = useCallback(() => {
    setShowCompositionPreview(false);
  }, []);

  return (
    <>
      {/* pl-5 #1026: editorKind / cssFramework ミスマッチ警告バナー */}
      {props.mismatchWarnings.length > 0 && (
        <EditorKindMismatchBanner warnings={props.mismatchWarnings} />
      )}
      {/* pl-5 #1026: page Screen の pageLayout 外枠表示バナー */}
      {props.pageLayoutId && props.pageLayoutName && (
        <PageLayoutWireframeBanner
          pageLayoutName={props.pageLayoutName}
          pageLayoutId={props.pageLayoutId}
          onPreviewClick={props.pageLayoutHtml ? handlePreviewClick : undefined}
        />
      )}
      {props.backend.renderEditor(editorProps)}
      {/* RFC #1021 pl-6 (Codex C-1): composition preview modal */}
      {showCompositionPreview && props.pageLayoutHtml && (
        <CompositionPreviewModal
          pageLayoutName={props.pageLayoutName ?? ""}
          pageLayoutHtml={props.pageLayoutHtml}
          assignments={props.pageLayoutAssignments ?? {}}
          gadgetHtmlMap={props.gadgetHtmlMap ?? new Map()}
          getScreenContent={getScreenContent}
          getScreenCss={getScreenCss}
          cssFramework={props.cssFramework}
          themeVariant={props.themeVariant}
          pageLayoutCss={props.pageLayoutCss}
          gadgetCssMap={props.gadgetCssMap}
          onClose={handleClosePreview}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// pl-5 #1026: editorKind / cssFramework ミスマッチ警告バナー (C)
// ---------------------------------------------------------------------------

interface EditorKindMismatchBannerProps {
  warnings: string[];
}

function EditorKindMismatchBanner({ warnings }: EditorKindMismatchBannerProps) {
  return (
    <div
      data-testid="editor-kind-mismatch-banner"
      style={{
        background: "#fef3c7",
        borderBottom: "1px solid #fbbf24",
        padding: "6px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "#92400e",
        zIndex: 10,
        position: "relative",
      }}
    >
      <i className="bi bi-exclamation-triangle-fill" style={{ color: "#f59e0b" }} />
      <span>
        runtime composition が動作しない可能性があります: {warnings.join(" / ")}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// pl-5 #1026: page Screen の PageLayout 外枠表示バナー (B-簡易)
// ---------------------------------------------------------------------------

interface PageLayoutWireframeBannerProps {
  pageLayoutName: string;
  pageLayoutId: string;
  onPreviewClick?: () => void;
}

function PageLayoutWireframeBanner({ pageLayoutName, pageLayoutId, onPreviewClick }: PageLayoutWireframeBannerProps) {
  return (
    <div
      data-testid="page-layout-wireframe-banner"
      style={{
        background: "#ede9fe",
        borderBottom: "1px solid #a78bfa",
        padding: "6px 16px",
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 13,
        color: "#5b21b6",
        zIndex: 10,
        position: "relative",
      }}
    >
      <i className="bi bi-layout-wtf" style={{ color: "#7c3aed" }} />
      <span>
        ページレイアウトを使用中: <strong>{pageLayoutName}</strong>
        <span style={{ color: "#7c3aed", fontFamily: "monospace", fontSize: 11, marginLeft: 6 }}>
          ({pageLayoutId})
        </span>
      </span>
      <span style={{ color: "#8b5cf6", fontSize: 11, marginLeft: 4 }}>
        — 外枠はページレイアウト側で編集してください
      </span>
      {onPreviewClick && (
        <button
          type="button"
          onClick={onPreviewClick}
          data-testid="page-layout-composition-preview-btn"
          style={{
            marginLeft: "auto",
            padding: "2px 12px",
            border: "1px solid #7c3aed",
            borderRadius: 4,
            background: "#fff",
            color: "#7c3aed",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          <i className="bi bi-eye" style={{ marginRight: 4 }} />
          composition プレビューを開く
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// RFC #1021 pl-6 (Codex C-1): composition preview modal — Page Screen + PageLayout 外枠 + gadget の
// 完全な合成 HTML を read-only で表示する modal
// ---------------------------------------------------------------------------

interface CompositionPreviewModalProps {
  pageLayoutName: string;
  pageLayoutHtml: string;
  assignments: Record<string, string>;
  gadgetHtmlMap: Map<string, string>;
  getScreenContent: () => string;
  // #1406: canvas と同一の CSS スタックを再現するための framework / variant / project CSS
  getScreenCss: () => string;
  cssFramework: CssFramework;
  themeVariant: ThemeId;
  pageLayoutCss?: string;
  gadgetCssMap?: Map<string, string>;
  onClose: () => void;
}

function CompositionPreviewModal({
  pageLayoutName,
  pageLayoutHtml,
  assignments,
  gadgetHtmlMap,
  getScreenContent,
  getScreenCss,
  cssFramework,
  themeVariant,
  pageLayoutCss,
  gadgetCssMap,
  onClose,
}: CompositionPreviewModalProps) {
  const composedSrcDoc = useMemo(() => {
    const screenContent = getScreenContent();
    const composed = composePreviewHtml(pageLayoutHtml, assignments, gadgetHtmlMap, screenContent);

    // #1406: canvas (GrapesJSBackend) と同一の framework + variant CSS スタックを再現する。
    // grapesCanvasAssets が canvas / preview 双方の単一 source of truth。
    const styleHrefs = buildPreviewStyleHrefs(cssFramework, themeVariant);

    // #1406: PageLayout / gadget / 編集中 Screen の project CSS を `<style>` で注入。
    // gadget CSS は assignments で実際に使われているもののみ収集する。
    const projectCssBlocks: string[] = [];
    if (pageLayoutCss) projectCssBlocks.push(pageLayoutCss);
    if (gadgetCssMap) {
      for (const gadgetId of Object.values(assignments)) {
        const css = gadgetCssMap.get(gadgetId);
        if (css) projectCssBlocks.push(css);
      }
    }
    const screenCss = getScreenCss();
    if (screenCss) projectCssBlocks.push(screenCss);

    return buildCompositionPreviewSrcDoc(composed, styleHrefs, projectCssBlocks);
  }, [
    pageLayoutHtml,
    assignments,
    gadgetHtmlMap,
    getScreenContent,
    getScreenCss,
    cssFramework,
    themeVariant,
    pageLayoutCss,
    gadgetCssMap,
  ]);

  return (
    <div
      data-testid="composition-preview-modal"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.6)",
        display: "flex",
        alignItems: "stretch",
        justifyContent: "center",
        padding: 24,
        zIndex: 9999,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "#fff",
          borderRadius: 8,
          width: "100%",
          maxWidth: 1280,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 16px",
            borderBottom: "1px solid #e2e8f0",
            background: "#f8fafc",
          }}
        >
          <span style={{ fontSize: 14, color: "#0f172a", fontWeight: 600 }}>
            <i className="bi bi-eye" style={{ marginRight: 6, color: "#7c3aed" }} />
            composition プレビュー: <span style={{ color: "#5b21b6" }}>{pageLayoutName}</span>
            <span style={{ color: "#64748b", fontSize: 12, fontWeight: 400, marginLeft: 8 }}>
              (PageLayout 外枠 + 各 region の gadget + main slot に Screen 本文)
            </span>
          </span>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: "1px solid #e2e8f0",
              borderRadius: 4,
              background: "#fff",
              padding: "4px 10px",
              cursor: "pointer",
              fontSize: 12,
            }}
          >
            <i className="bi bi-x-lg" style={{ marginRight: 4 }} />
            閉じる
          </button>
        </div>
        <iframe
          title="composition-preview"
          srcDoc={composedSrcDoc}
          sandbox="allow-same-origin"
          style={{ flex: 1, border: "none", background: "#fff" }}
        />
      </div>
    </div>
  );
}
