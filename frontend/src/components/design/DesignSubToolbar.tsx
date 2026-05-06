import { useEffect, useState, useCallback, useRef } from "react";
import type { Editor as GEditor } from "grapesjs";
import { useEditorMaybe } from "@grapesjs/react";
import type { PanelMode, ThemeId } from "../Designer";
import type { McpStatus } from "../../mcp/mcpBridge";
import { mcpBridge } from "../../mcp/mcpBridge";
import { generateUUID } from "../../utils/uuid";
import { CodeEditorModal } from "../CodeEditorModal";
import { SaveBlockModal } from "../SaveBlockModal";
import { SaveResetButtons } from "../common/SaveResetButtons";
import { EditorHeader } from "../common/EditorHeader";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { upsertCustomBlock } from "../../store/customBlockStore";

const MCP_HTTP_BASE = `http://${window.location.hostname}:5179`;

type AiRenameStage = "auth-check" | "analyzing" | "inferring" | "proposed" | "applying" | "done" | "error";

interface AiRenameProgress {
  stage: AiRenameStage;
  message: string;
  error?: string;
  mapping?: Record<string, string>;
}

export const CUSTOM_BLOCK_CATEGORY = "マイブロック";

/** 共有ブロックとして保存する際、HTML のルート要素に data-shared-block-id を付与する */
function addSharedBlockId(html: string, blockId: string): string {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<body>${html}</body>`, "text/html");
  if (doc.body.children.length === 1) {
    doc.body.children[0].setAttribute("data-shared-block-id", blockId);
    return doc.body.innerHTML;
  }
  return `<div data-shared-block-id="${blockId}">${html}</div>`;
}

const THEMES: { id: ThemeId; label: string; icon: string; color: string }[] = [
  { id: "standard", label: "標準",      icon: "bi-grid-3x3",   color: "#6c757d" },
  { id: "card",     label: "カード型",   icon: "bi-layers",     color: "#6366f1" },
  { id: "compact",  label: "コンパクト", icon: "bi-table",      color: "#0284c7" },
  { id: "dark",     label: "ダーク",     icon: "bi-moon-stars", color: "#0f172a" },
];

interface BackLink {
  label: string;
  onClick: () => void;
}

interface Props {
  panelMode: PanelMode;
  onOpenPanel: () => void;
  activeTheme: ThemeId;
  onThemeChange: (theme: ThemeId) => void;
  mcpStatus: McpStatus;
  backLink?: BackLink;
  isDirty?: boolean;
  isSaving?: boolean;
  onSaveToFile?: () => Promise<void>;
  onReset?: () => Promise<void>;
  screenId?: string;
  /** 読み取り専用モードの場合 true — 保存/リセットボタンを非表示にする */
  isReadonly?: boolean;
  /**
   * GrapesJS editor instance。GrapesJS 経路は `DesignSubToolbarGrapesJSBridge` 経由で
   * `<WithEditor>` 配下の `useEditorMaybe()` から得た値を渡す。Puck 経路は undefined。
   * editor が undefined の場合、GrapesJS 由来の機能 (Undo/Redo/Devices/runCommand 等) は
   * 無効化される (button disabled / onClick noop)。
   */
  editor: GEditor | undefined;
}

export function DesignSubToolbar({ panelMode, onOpenPanel, activeTheme, onThemeChange, mcpStatus, backLink, isDirty, isSaving, onSaveToFile, onReset, screenId, isReadonly, editor }: Props) {
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);

  // ── AI 命名 (#337) ───────────────────────────────────────────────────────
  const [aiRenameAuthOk, setAiRenameAuthOk] = useState<boolean | null>(null);
  const [aiRenameProgress, setAiRenameProgress] = useState<AiRenameProgress | null>(null);
  const [aiRenameMapping, setAiRenameMapping] = useState<Record<string, string> | null>(null);
  const [aiRenameToast, setAiRenameToast] = useState<{ msg: string; warn: boolean } | null>(null);
  const aiRenameAbortRef = useRef<AbortController | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const aiRenameSessionRef = useRef<string | null>(null);

  // auth-check: MCP 接続時に 1 回だけ実行
  useEffect(() => {
    if (mcpStatus !== "connected" || !screenId) return;
    fetch(`${MCP_HTTP_BASE}/ai/rename-screen-ids/auth-check`)
      .then((r) => r.json())
      .then((d: unknown) => { setAiRenameAuthOk((d as { authenticated: boolean }).authenticated); })
      .catch(() => { setAiRenameAuthOk(false); });
  }, [mcpStatus, screenId]);

  // aiRenameProgress イベントを購読（セッション ID が一致するイベントのみ処理）
  useEffect(() => {
    const unsub = mcpBridge.onBroadcast("aiRenameProgress", (data) => {
      const ev = data as AiRenameProgress & { sessionId?: string };
      if (ev.sessionId && ev.sessionId !== aiRenameSessionRef.current) return;
      setAiRenameProgress(ev);
      if (ev.stage === "proposed" && ev.mapping) {
        setAiRenameMapping(ev.mapping);
      }
    });
    return unsub;
  }, []);

  useEffect(() => () => { if (toastTimerRef.current) clearTimeout(toastTimerRef.current); }, []);

  const showToast = useCallback((msg: string, warn = false) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setAiRenameToast({ msg, warn });
    toastTimerRef.current = setTimeout(() => setAiRenameToast(null), 4000);
  }, []);

  const handleAiRename = useCallback(async () => {
    if (!screenId) return;
    const sessionId = generateUUID();
    aiRenameSessionRef.current = sessionId;
    const abort = new AbortController();
    aiRenameAbortRef.current = abort;
    setAiRenameProgress({ stage: "auth-check", message: "接続中..." });
    setAiRenameMapping(null);
    try {
      const res = await fetch(`${MCP_HTTP_BASE}/ai/rename-screen-ids/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ screenId, clientId: mcpBridge.getClientId(), sessionId }),
        signal: abort.signal,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: "不明なエラー" })) as { error?: string };
        setAiRenameProgress({ stage: "error", message: "サーバーエラー", error: err.error });
      }
    } catch (e) {
      if ((e as Error).name !== "AbortError") {
        setAiRenameProgress({ stage: "error", message: "通信エラー", error: String(e) });
      }
    }
  }, [screenId]);

  const handleAiRenameCancel = useCallback(() => {
    aiRenameSessionRef.current = null;
    aiRenameAbortRef.current?.abort();
    setAiRenameProgress(null);
    setAiRenameMapping(null);
  }, []);

  const handleAiRenameApply = useCallback(async () => {
    if (!screenId || !aiRenameMapping) return;
    const entries = Object.entries(aiRenameMapping);
    if (entries.length === 0) {
      setAiRenameProgress(null);
      setAiRenameMapping(null);
      showToast("リネーム対象がありません");
      return;
    }
    setAiRenameProgress({ stage: "applying", message: `${entries.length} 件を適用中...` });
    let succeeded = 0;
    let failed = 0;
    for (const [oldId, newId] of entries) {
      try {
        await mcpBridge.request("renameScreenItem", { screenId, oldId, newId });
        succeeded++;
      } catch {
        failed++;
      }
    }
    setAiRenameProgress({ stage: "done", message: "完了" });
    setAiRenameMapping(null);
    setTimeout(() => setAiRenameProgress(null), 800);
    showToast(`リネーム完了: 成功 ${succeeded} 件、失敗 ${failed} 件`, failed > 0);
  }, [screenId, aiRenameMapping, showToast]);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [hasSelected, setHasSelected] = useState(false);
  const [codeModalOpen, setCodeModalOpen] = useState(false);
  const [codeModalHtml, setCodeModalHtml] = useState("");
  const [codeModalName, setCodeModalName] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState("desktop");
  const [saveBlockOpen, setSaveBlockOpen] = useState(false);
  const [saveBlockDefaultName, setSaveBlockDefaultName] = useState("");

  useEffect(() => {
    if (!editor) return;
    const um = editor.UndoManager;
    const update = () => {
      setCanUndo(um.hasUndo());
      setCanRedo(um.hasRedo());
    };
    const onStorageStart = () => setSaveState("saving");
    const onStorageEnd = () => {
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 1200);
    };
    const onSelectionChange = () => {
      setHasSelected(editor.getSelectedAll().length > 0);
    };
    const onDeviceChange = () => {
      setSelectedDevice(editor.Devices.getSelected()?.get("id") ?? "desktop");
    };

    editor.on("component:add component:remove component:update", update);
    editor.on("undo redo", update);
    editor.on("storage:start:store", onStorageStart);
    editor.on("storage:end:store", onStorageEnd);
    editor.on("component:selected component:deselected", onSelectionChange);
    editor.on("device:select", onDeviceChange);
    update();
    onSelectionChange();
    onDeviceChange();

    return () => {
      editor.off("component:add component:remove component:update", update);
      editor.off("undo redo", update);
      editor.off("storage:start:store", onStorageStart);
      editor.off("storage:end:store", onStorageEnd);
      editor.off("component:selected component:deselected", onSelectionChange);
      editor.off("device:select", onDeviceChange);
    };
  }, [editor]);

  const handleUndo = () => editor?.UndoManager.undo();
  const handleRedo = () => editor?.UndoManager.redo();
  const handlePreview = () => editor?.runCommand("preview");
  const handleClear = () => {
    if (confirm("キャンバスをクリアします。よろしいですか？")) {
      editor?.DomComponents.clear();
    }
  };
  const handleSaveNow = () => onSaveToFile?.();

  const handleOpenCodeEditor = useCallback(() => {
    if (!editor) return;
    const selected = editor.getSelected();
    if (!selected) return;
    const html = selected.toHTML();
    const name = selected.getName() || selected.get("tagName") || "コンポーネント";
    setCodeModalHtml(html);
    setCodeModalName(name);
    setCodeModalOpen(true);
  }, [editor]);

  const handleOpenSaveBlock = useCallback(() => {
    if (!editor) return;
    const selected = editor.getSelected();
    if (!selected) return;
    const defaultName = selected.getName() || selected.get("tagName") || "マイブロック";
    setSaveBlockDefaultName(defaultName as string);
    setSaveBlockOpen(true);
  }, [editor]);

  const handleSaveBlock = useCallback(async (name: string, shared: boolean) => {
    if (!editor) return;
    const selected = editor.getSelected();
    if (!selected) return;

    const id = `custom-block-${Date.now()}`;
    const rawHtml = selected.toHTML();
    const content = shared ? addSharedBlockId(rawHtml, id) : rawHtml;
    const now = new Date().toISOString();

    const customBlock = {
      id,
      label: name,
      category: CUSTOM_BLOCK_CATEGORY,
      content,
      shared,
      createdAt: now,
      updatedAt: now,
    };

    await upsertCustomBlock(customBlock);

    editor.BlockManager.add(id, {
      label: name,
      category: CUSTOM_BLOCK_CATEGORY,
      content,
      ...(shared ? { shared: true } : {}),
    } as Parameters<typeof editor.BlockManager.add>[1]);

    setSaveBlockOpen(false);
  }, [editor]);

  const handleCodeApply = useCallback((newHtml: string) => {
    if (!editor) return;
    const selected = editor.getSelected();
    if (!selected) return;
    const parent = selected.parent();
    const index = selected.index();
    selected.replaceWith(newHtml);
    if (parent) {
      const newComp = parent.getChildAt(index);
      if (newComp) editor.select(newComp);
    }
    setCodeModalOpen(false);
  }, [editor]);

  const handleExportHtml = () => {
    if (!editor) return;
    const html = editor.getHtml();
    const css = editor.getCss();
    const fullHtml = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>エクスポート</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" />
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css" />
  <style>${css}</style>
</head>
<body>
${html}
  <script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
</body>
</html>`;
    const blob = new Blob([fullHtml], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "design-export.html";
    a.click();
    URL.revokeObjectURL(url);
  };

  useEffect(() => {
    if (!editor) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.isContentEditable
      ) {
        return;
      }

      const ctrl = e.ctrlKey || e.metaKey;

      if (ctrl && e.key === "p") {
        e.preventDefault();
        editor.runCommand("preview");
      } else if (ctrl && e.key === "d") {
        e.preventDefault();
        const selected = editor.getSelected();
        if (selected) {
          editor.runCommand("tlb-clone");
        }
      } else if (ctrl && e.key === "e") {
        e.preventDefault();
        const selected = editor.getSelected();
        if (selected) {
          const html = selected.toHTML();
          const name = selected.getName() || selected.get("tagName") || "コンポーネント";
          setCodeModalHtml(html);
          setCodeModalName(name as string);
          setCodeModalOpen(true);
        }
      } else if (e.key === "Delete" && !ctrl && !e.shiftKey && !e.altKey) {
        const selected = editor.getSelected();
        if (selected) {
          editor.runCommand("tlb-delete");
        }
      } else if (e.key === "?") {
        setHelpOpen((v) => !v);
      } else if (e.key === "Escape") {
        setHelpOpen(false);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [editor]);

  useSaveShortcut(() => {
    void onSaveToFile?.();
  });

  return (
    <>
      <EditorHeader
        variant="dark"
        backLink={backLink ? { label: backLink.label, onClick: backLink.onClick, title: "フロー図に戻る" } : undefined}
        title={
          panelMode === "hidden" ? (
            <button
              className="icon-btn"
              onClick={onOpenPanel}
              title="ブロックパネルを開く"
            >
              <i className="bi bi-layout-sidebar" />
            </button>
          ) : undefined
        }
        centerTools={
          <>
            {screenId && (
              <>
                <button
                  className="icon-btn"
                  onClick={() => { void handleAiRename(); }}
                  disabled={!aiRenameAuthOk || aiRenameProgress !== null}
                  title={
                    aiRenameAuthOk === false
                      ? "claude CLI が未認証です (claude login を実行してください)"
                      : aiRenameAuthOk === null
                      ? "認証を確認中..."
                      : "ID を AI で再命名"
                  }
                >
                  <i className="bi bi-stars" />
                </button>
                <div className="divider" />
              </>
            )}
            <button className="icon-btn" onClick={handlePreview} title="プレビュー (Ctrl+P)">
              <i className="bi bi-eye" />
            </button>
            <button
              className="icon-btn"
              onClick={handleOpenCodeEditor}
              disabled={!hasSelected}
              title="HTMLソースを編集 (Ctrl+E)"
            >
              <i className="bi bi-code-slash" />
            </button>
            <button
              className="icon-btn"
              onClick={handleOpenSaveBlock}
              disabled={!hasSelected}
              title="マイブロックとして保存"
            >
              <i className="bi bi-bookmark-plus" />
            </button>
            <button
              className="icon-btn danger"
              onClick={handleClear}
              title="キャンバスをクリア"
            >
              <i className="bi bi-trash" />
            </button>
            <div className="divider" />
            <div className="device-switcher">
              <button
                className={`device-btn${selectedDevice === "desktop" ? " active" : ""}`}
                onClick={() => editor?.setDevice("desktop")}
                title="PC（全幅）"
              >
                <i className="bi bi-display" />
              </button>
              <button
                className={`device-btn${selectedDevice === "tablet" ? " active" : ""}`}
                onClick={() => editor?.setDevice("tablet")}
                title="タブレット (768px)"
              >
                <i className="bi bi-tablet" />
              </button>
              <button
                className={`device-btn${selectedDevice === "smartphone" ? " active" : ""}`}
                onClick={() => editor?.setDevice("smartphone")}
                title="スマートフォン (375px)"
              >
                <i className="bi bi-phone" />
              </button>
            </div>
            <div className="divider" />
            <button
              className="icon-btn"
              onClick={() => setHelpOpen(true)}
              title="キーボードショートカット一覧 (?)"
            >
              <i className="bi bi-keyboard" />
            </button>
          </>
        }
        undoRedo={{ onUndo: handleUndo, onRedo: handleRedo, canUndo, canRedo }}
        extraRight={
          <>
            <div className="theme-selector">
              <button
                className="theme-selector-btn"
                onClick={() => setThemeMenuOpen((v) => !v)}
                title="デザインテーマを選択"
              >
                <i className={`bi ${THEMES.find((t) => t.id === activeTheme)?.icon ?? "bi-palette"}`} />
                <span>{THEMES.find((t) => t.id === activeTheme)?.label ?? "テーマ"}</span>
                <i className="bi bi-chevron-down" style={{ fontSize: 10 }} />
              </button>
              {themeMenuOpen && (
                <div className="theme-menu">
                  {THEMES.map((t) => (
                    <button
                      key={t.id}
                      className={`theme-menu-item${activeTheme === t.id ? " active" : ""}`}
                      onClick={() => { onThemeChange(t.id); setThemeMenuOpen(false); }}
                    >
                      <span className="theme-swatch" style={{ background: t.color }} />
                      <i className={`bi ${t.icon}`} />
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="divider" />
            {!isReadonly && (
              <>
                <SaveResetButtons
                  isDirty={!!isDirty}
                  isSaving={!!isSaving}
                  onSave={handleSaveNow}
                  onReset={() => { void onReset?.(); }}
                />
                <span className="save-indicator saved" style={{ visibility: saveState === "saved" ? "visible" : "hidden", marginLeft: 4 }}>
                  <i className="bi bi-check-circle-fill" /> 保存済み
                </span>
              </>
            )}
            <button className="btn-secondary-sm" onClick={handleExportHtml} title="HTMLファイルとしてダウンロード">
              <i className="bi bi-download" /> HTMLエクスポート
            </button>
            <div className="divider" />
            <McpIndicator status={mcpStatus} />
          </>
        }
      />

      {aiRenameProgress && (
        <AiRenameModal
          progress={aiRenameProgress}
          mapping={aiRenameMapping}
          onCancel={handleAiRenameCancel}
          onApply={() => { void handleAiRenameApply(); }}
        />
      )}

      {aiRenameToast && (
        <div className={`ai-rename-toast${aiRenameToast.warn ? " is-warn" : ""}`}>
          <i className={`bi ${aiRenameToast.warn ? "bi-exclamation-triangle-fill" : "bi-check-circle-fill"}`} />
          {aiRenameToast.msg}
        </div>
      )}

      <CodeEditorModal
        open={codeModalOpen}
        initialHtml={codeModalHtml}
        componentName={codeModalName}
        onApply={handleCodeApply}
        onClose={() => setCodeModalOpen(false)}
      />

      {helpOpen && <ShortcutsHelp onClose={() => setHelpOpen(false)} />}

      <SaveBlockModal
        open={saveBlockOpen}
        defaultName={saveBlockDefaultName}
        onSave={handleSaveBlock}
        onClose={() => setSaveBlockOpen(false)}
      />
    </>
  );
}

interface AiRenameModalProps {
  progress: AiRenameProgress;
  mapping: Record<string, string> | null;
  onCancel: () => void;
  onApply: () => void;
}

function AiRenameModal({ progress, mapping, onCancel, onApply }: AiRenameModalProps) {
  const isApplying = progress.stage === "applying" || progress.stage === "done";
  const isProposed = progress.stage === "proposed" && mapping !== null;
  const isError = progress.stage === "error";

  const stageIcon: Record<AiRenameStage, string> = {
    "auth-check": "bi-shield-check",
    "analyzing": "bi-search",
    "inferring": "bi-cpu",
    "proposed": "bi-list-check",
    "applying": "bi-arrow-repeat",
    "done": "bi-check-circle-fill",
    "error": "bi-exclamation-triangle-fill",
  };

  return (
    <div className="ai-rename-overlay">
      <div className="ai-rename-modal">
        <div className="ai-rename-modal-header">
          <i className="bi bi-stars" /> IDを AI で再命名
        </div>

        <div className="ai-rename-modal-body">
          <div className={`ai-rename-stage is-${progress.stage}`}>
            <i className={`bi ${stageIcon[progress.stage]}`} />
            <span>{progress.message}</span>
          </div>

          {isError && progress.error && (
            <div className="ai-rename-error-detail">{progress.error}</div>
          )}

          {isProposed && mapping && (
            <div className="ai-rename-mapping">
              <p className="ai-rename-mapping-title">
                以下の {Object.keys(mapping).length} 件をリネームします:
              </p>
              <table className="ai-rename-table">
                <thead>
                  <tr>
                    <th>現在の ID</th>
                    <th>推論した名前</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(mapping).map(([oldId, newId]) => (
                    <tr key={oldId}>
                      <td><code>{oldId}</code></td>
                      <td><code>{newId}</code></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="ai-rename-modal-footer">
          {!isApplying && (
            <button className="btn-secondary-sm" onClick={onCancel}>
              キャンセル
            </button>
          )}
          {isProposed && (
            <button className="btn-primary-sm" onClick={onApply}>
              <i className="bi bi-check-lg" /> 適用する
            </button>
          )}
          {isError && (
            <button className="btn-secondary-sm" onClick={onCancel}>
              閉じる
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function McpIndicator({ status }: { status: McpStatus }) {
  const label =
    status === "connected" ? "MCP接続中" :
    status === "connecting" ? "MCP接続試行中" :
    "MCP未接続";
  const title =
    status === "connected" ? "MCPサーバーに接続されています" :
    status === "connecting" ? "MCPサーバーへの接続を試みています..." :
    "MCPサーバーに接続されていません。backendサーバーを起動してください。";

  return (
    <div className={`mcp-indicator mcp-${status}`} title={title}>
      <span className="mcp-dot" />
      <span className="mcp-label">{label}</span>
    </div>
  );
}

const SHORTCUTS = [
  { key: "Ctrl + Z",         desc: "元に戻す" },
  { key: "Ctrl + Shift + Z", desc: "やり直し" },
  { key: "Ctrl + S",         desc: "今すぐ保存" },
  { key: "Ctrl + P",         desc: "プレビュー" },
  { key: "Ctrl + D",         desc: "選択コンポーネントを複製" },
  { key: "Ctrl + E",         desc: "HTMLソースエディタを開く" },
  { key: "Delete",           desc: "選択コンポーネントを削除" },
  { key: "?",                desc: "このヘルプを表示 / 非表示" },
  { key: "Esc",              desc: "ヘルプを閉じる" },
];

function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  return (
    <div className="shortcuts-overlay" onClick={onClose}>
      <div className="shortcuts-modal" onClick={(e) => e.stopPropagation()}>
        <div className="shortcuts-modal-header">
          <i className="bi bi-keyboard" />
          <span>キーボードショートカット</span>
          <button className="shortcuts-close" onClick={onClose}>
            <i className="bi bi-x-lg" />
          </button>
        </div>
        <ul className="shortcuts-list">
          {SHORTCUTS.map(({ key, desc }) => (
            <li key={key}>
              <span className="shortcuts-desc">{desc}</span>
              <kbd className="shortcuts-key">{key}</kbd>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// GrapesJS 専用ブリッジ — Provider-aware に useEditorMaybe() を呼んで forward する
// ---------------------------------------------------------------------------

/**
 * `DesignSubToolbarGrapesJSBridge` は GrapesJS 経路 (`<GjsEditor>` 配下) で
 * `useEditorMaybe()` を Rules-of-Hooks に従って正規呼び出しし、得られた `editor` を
 * `<DesignSubToolbar>` に props として forward する Provider-aware ブリッジ。
 *
 * Puck 経路 (`<GjsEditor>` ancestor 無し) は本ブリッジを **使わず**、Designer.tsx が
 * 直接 `<DesignSubToolbar editor={undefined} ... />` を render する。これにより
 * 旧実装の `try/catch` で hook 呼び出しを包む anti-pattern を解消する (#824)。
 */
type GrapesJSBridgeProps = Omit<Props, "editor">;

export function DesignSubToolbarGrapesJSBridge(props: GrapesJSBridgeProps) {
  const editor = useEditorMaybe();
  return <DesignSubToolbar {...props} editor={editor} />;
}
