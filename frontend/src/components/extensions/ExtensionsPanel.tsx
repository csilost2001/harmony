import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { mcpBridge } from "../../mcp/mcpBridge";
import { loadExtensionsFromBundle, type RawExtensionsBundle } from "../../schemas/loadExtensions";
import { StepsTab } from "./StepsTab";
import { FieldTypesTab } from "./FieldTypesTab";
import { TriggersTab } from "./TriggersTab";
import { DbOperationsTab } from "./DbOperationsTab";
import { ResponseTypesTab } from "./ResponseTypesTab";
import { useEditSession } from "../../hooks/useEditSession";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import {
  DiscardConfirmDialog,
  ForceReleaseConfirmDialog,
  ForcedOutChoiceDialog,
  AfterForceUnlockChoiceDialog,
} from "../editing/ConfirmDialogs";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import "../../styles/editMode.css";

export type ExtensionKind = "steps" | "fieldTypes" | "triggers" | "dbOperations" | "responseTypes";

export interface ExtensionTabProps {
  bundle: RawExtensionsBundle;
  saving: boolean;
  onSave: (kind: ExtensionKind, content: unknown) => Promise<void>;
  isReadonly?: boolean;
}

const TABS: Array<{ key: ExtensionKind; label: string; icon: string }> = [
  { key: "steps", label: "ステップ型", icon: "bi-diagram-2" },
  { key: "fieldTypes", label: "フィールド型", icon: "bi-input-cursor-text" },
  { key: "triggers", label: "トリガー", icon: "bi-lightning-charge" },
  { key: "dbOperations", label: "DB 操作", icon: "bi-database-gear" },
  { key: "responseTypes", label: "レスポンス型", icon: "bi-braces" },
];

function isTabKey(value: string | null): value is ExtensionKind {
  return TABS.some((tab) => tab.key === value);
}

export function ExtensionsPanel() {
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const [active, setActive] = useState<ExtensionKind>(isTabKey(requestedTab) ? requestedTab : "steps");
  const [bundle, setBundle] = useState<RawExtensionsBundle>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);
  // tab switching confirm: pending tab to switch to after confirm
  const [pendingTab, setPendingTab] = useState<ExtensionKind | null>(null);

  const sessionId = mcpBridge.getSessionId();

  const { mode, loading: sessionLoading, isDirtyForTab, actions } = useEditSession({
    resourceType: "extension",
    resourceId: active,
    sessionId,
  });

  const isReadonly = mode.kind !== "editing";

  const load = useCallback(async (forceReload = false) => {
    setLoading(true);
    const next = await mcpBridge.getExtensions(forceReload);
    setBundle(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
    return mcpBridge.onExtensionsChanged(() => {
      void load(true);
    });
  }, [load]);

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (isTabKey(tab) && tab !== active) setActive(tab);
  }, [active, searchParams]);

  // タブ dirty マーク
  useEffect(() => {
    const tabId = makeTabId("extensions", "main");
    setTabDirty(tabId, isDirtyForTab);
  }, [isDirtyForTab]);

  // 復元ダイアログ (readonly + draft 存在時)
  useEffect(() => {
    if (sessionLoading) return;
    if (mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.hasDraft("extension", active) as { exists: boolean } | null;
      if (cancelled) return;
      if (res?.exists) setShowResumeDialog(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [active, sessionLoading, mode.kind]);

  const setActiveTab = (key: ExtensionKind) => {
    if (key === active) return;
    // タブ切替: 編集中なら確認
    if (isDirtyForTab) {
      setPendingTab(key);
      setShowDiscardDialog(true);
      return;
    }
    setActive(key);
    setSearchParams({ tab: key });
  };

  const summary = useMemo(() => loadExtensionsFromBundle(bundle), [bundle]);

  const handleSave = useCallback(async (kind: ExtensionKind, content: unknown) => {
    if (isReadonly) return;
    setSaving(true);
    setMessage(null);
    try {
      await mcpBridge.request("saveExtensionPackage", { type: kind, content });
      await actions.save();
      setMessage("保存しました。");
      await load(true);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [isReadonly, actions, load]);

  const handleDiscard = useCallback(async () => {
    if (pendingTab) {
      // タブ切替確認で「破棄して切替」
      setShowDiscardDialog(false);
      await actions.discard();
      await mcpBridge.discardDraft("extension", active);
      await load(true);
      setActive(pendingTab);
      setSearchParams({ tab: pendingTab });
      setPendingTab(null);
    } else {
      setShowDiscardDialog(false);
      await actions.discard();
      await load(true);
    }
  }, [pendingTab, actions, active, load, setSearchParams]);

  const handleDiscardCancel = useCallback(() => {
    setShowDiscardDialog(false);
    setPendingTab(null);
  }, []);

  const handleForceRelease = useCallback(async () => {
    setShowForceReleaseDialog(false);
    await actions.forceReleaseOther();
  }, [actions]);

  const handleResumeContinue = useCallback(async () => {
    setShowResumeDialog(false);
    await actions.startEditing();
  }, [actions]);

  const handleResumeDiscard = useCallback(async () => {
    setShowResumeDialog(false);
    await mcpBridge.discardDraft("extension", active);
    await load(true);
  }, [active, load]);

  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;

  const tabProps: ExtensionTabProps = { bundle, saving, onSave: handleSave, isReadonly };

  return (
    <div className={`container-fluid py-3 extensions-panel${isReadonly ? " readonly-mode" : ""}`}>
      {showDiscardDialog && (
        <DiscardConfirmDialog
          onConfirm={() => { void handleDiscard(); }}
          onCancel={handleDiscardCancel}
        />
      )}
      {showForceReleaseDialog && lockedByOther && (
        <ForceReleaseConfirmDialog
          ownerSessionId={lockedByOther.ownerSessionId}
          ownerLabel={lockedByOther.ownerLabel}
          onConfirm={() => { void handleForceRelease(); }}
          onCancel={() => setShowForceReleaseDialog(false)}
        />
      )}
      {mode.kind === "force-released-pending" && (
        <ForcedOutChoiceDialog
          previousDraftExists={mode.previousDraftExists}
          onChoice={(choice) => { void actions.handleForcedOut(choice); if (choice !== "continue") void load(true); }}
        />
      )}
      {mode.kind === "after-force-unlock" && (
        <AfterForceUnlockChoiceDialog
          previousOwner={mode.previousOwner}
          onChoice={(choice) => { void actions.handleAfterForceUnlock(choice); if (choice === "discard") void load(true); }}
        />
      )}
      {showResumeDialog && (
        <ResumeOrDiscardDialog
          onResume={() => { void handleResumeContinue(); }}
          onDiscard={() => { void handleResumeDiscard(); }}
          onCancel={() => setShowResumeDialog(false)}
        />
      )}

      <EditModeToolbar
        mode={mode}
        onStartEditing={() => { void actions.startEditing(); }}
        onSave={() => {/* extensions save is per-tab */}}
        onDiscardClick={() => setShowDiscardDialog(true)}
        onForceReleaseClick={() => setShowForceReleaseDialog(true)}
        saving={saving}
        ownerLabel={lockedByOther?.ownerSessionId}
      />

      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <h1 className="h5 mb-1">拡張管理</h1>
          <div className="text-muted small">
            data/extensions のステップ型・フィールド型・トリガー・DB 操作・レスポンス型を管理します。
          </div>
        </div>
        <button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => void load(true)} disabled={loading || saving}>
          <i className="bi bi-arrow-clockwise me-1" />
          再読み込み
        </button>
      </div>

      {message ? <div className="alert alert-info py-2">{message}</div> : null}
      {summary.errors.length > 0 ? (
        <div className="alert alert-warning py-2">
          {summary.errors.map((issue, index) => (
            <div key={index}>{issue.message}</div>
          ))}
        </div>
      ) : null}

      <ul className="nav nav-tabs" role="tablist">
        {TABS.map((tab) => (
          <li className="nav-item" role="presentation" key={tab.key}>
            <button
              type="button"
              className={`nav-link${active === tab.key ? " active" : ""}`}
              role="tab"
              aria-selected={active === tab.key}
              onClick={() => setActiveTab(tab.key)}
            >
              <i className={`bi ${tab.icon} me-1`} />
              {tab.label}
            </button>
          </li>
        ))}
      </ul>

      <div className="border border-top-0 p-3 bg-white">
        {loading ? (
          <div className="text-muted">読み込み中...</div>
        ) : (
          <>
            {active === "steps" && <StepsTab {...tabProps} />}
            {active === "fieldTypes" && <FieldTypesTab {...tabProps} />}
            {active === "triggers" && <TriggersTab {...tabProps} />}
            {active === "dbOperations" && <DbOperationsTab {...tabProps} />}
            {active === "responseTypes" && <ResponseTypesTab {...tabProps} />}
          </>
        )}
      </div>
    </div>
  );
}
