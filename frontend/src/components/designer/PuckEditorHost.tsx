// #1388 sub-section A 派生 2 件: Designer.tsx L1025 で trigger していた
// react-hooks/refs (props object 経由で ref を読む) を解消するため、
// puckBackend.renderEditor() の呼び出し + subToolbar / props 構築を独立 component に隔離。
// host 内では Designer scope の closure を直接見ない (props 経由) ため、
// ref を含む inline closure による警告が trigger されない。
import type { ReactNode } from "react";
import { DesignSubToolbar } from "../design/DesignSubToolbar";
import type { PuckBackend } from "../../editor/PuckBackend";
import type {
  EditorApi,
  EditorState,
  PanelMode,
  PuckRenderEditorProps,
  ThemeId,
} from "../../editor/EditorBackend";
import type { McpStatus } from "../../mcp/mcpBridge";
import type { CssFramework } from "../../types/v3/harmony";
import type { EditMode } from "../../hooks/useEditSession";

export interface PuckEditorHostProps {
  backend: PuckBackend;
  state: EditorState;

  cssFramework: CssFramework;
  themeVariant: ThemeId;
  isReadonly: boolean;
  panelMode: PanelMode;
  screenId: string;
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
  onOpenRenameDialog: () => void;

  onChange: PuckRenderEditorProps["onChange"];
  onReady: (api: EditorApi) => void;
  reloadPayload: PuckRenderEditorProps["reloadPayload"];

  dialogsSlot: ReactNode;
}

export function PuckEditorHost(props: PuckEditorHostProps) {
  const subToolbar = (
    <DesignSubToolbar
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
      isReadonly={props.isReadonly}
      editor={undefined}
      sessionMode={props.sessionMode}
      sessionId={props.sessionId}
      onStartEditing={props.onStartEditing}
      onViewerAttached={props.onViewerAttached}
      onAttachAsView={props.onAttachAsView}
      onTakeOver={props.onTakeOver}
      onOpenRenameDialog={props.onOpenRenameDialog}
    />
  );

  const editorProps: PuckRenderEditorProps = {
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
    onChange: props.onChange,
    onReady: props.onReady,
    reloadPayload: props.reloadPayload,
  };

  return <>{props.backend.renderEditor(editorProps)}</>;
}
