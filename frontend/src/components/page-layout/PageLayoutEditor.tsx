/**
 * PageLayoutEditor — ページレイアウト構造編集 (pl-3, #1024)
 *
 * SequenceEditor.tsx を踏襲。
 * 編集対象:
 *  - name / description / maturity
 *  - regions[] (追加 / 削除 / 並び替え)
 *  - assignments (region → gadget Screen の割り当て)
 *  - processFlowId (optional)
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type { Maturity } from "../../types/v3";
import type { PageLayout, PageLayoutRegion } from "../../store/pageLayoutStore";
import { loadPageLayout, savePageLayout } from "../../store/pageLayoutStore";
import { mcpBridge } from "../../mcp/mcpBridge";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { useSaveShortcut } from "../../hooks/useSaveShortcut";
import { useSessionUrlSync } from "../../hooks/useSessionUrlSync";
import { EditorHeader, type EditorHeaderSaveReset, type EditorHeaderBackLink } from "../common/EditorHeader";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import { EditSessionDropdown } from "../editing/EditSessionDropdown";
import {
  DiscardConfirmDialog,
  ForceReleaseConfirmDialog,
  ForcedOutChoiceDialog,
  AfterForceUnlockChoiceDialog,
} from "../editing/ConfirmDialogs";
import { SaveConflictDialog } from "../editing/SaveConflictDialog";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import { MaturityBadge } from "../process-flow/MaturityBadge";
import { loadProject } from "../../store/flowStore";
import "../../styles/table.css";
import "../../styles/editMode.css";

const MATURITY_OPTIONS: Maturity[] = ["draft", "provisional", "committed"];
const MATURITY_LABELS: Record<Maturity, string> = {
  draft: "draft — 作業中",
  provisional: "provisional — 仮確定",
  committed: "committed — 確定",
};

const RESERVED_REGION_NAMES = ["header", "sidebar", "footer", "main"];

interface GadgetScreenOption {
  id: string;
  name: string;
}

export function PageLayoutEditor() {
  const { pageLayoutId: rawId } = useParams<{ pageLayoutId: string }>();
  const pageLayoutId = rawId ? decodeURIComponent(rawId) : rawId;
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  const [gadgetScreens, setGadgetScreens] = useState<GadgetScreenOption[]>([]);
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  const [regionNameError, setRegionNameError] = useState<string>("");
  const [newRegionName, setNewRegionName] = useState("");
  const [newRegionDescription, setNewRegionDescription] = useState("");

  const handleNotFound = useCallback(
    () => navigate(wsPath("/page-layout/list"), { replace: true }),
    [navigate, wsPath],
  );

  const sessionId = mcpBridge.getSessionId();

  const { syncSessionToUrl, initialEditSessionId } = useSessionUrlSync({
    resourceType: "page-layout",
    resourceId: pageLayoutId ?? "",
  });

  const {
    editSession, mode, loading: sessionLoading,
    isDirtyForTab, actions, attach, takeOver,
    saveConflict, onSaveConflictOverwrite, onSaveConflictCancel,
  } = useEditSession({
    resourceType: "page-layout",
    resourceId: pageLayoutId ?? "",
    sessionId,
    editSessionId: initialEditSessionId,
  });

  const {
    state: pl,
    isDirty, isSaving, serverChanged,
    update, postSave, dismissServerBanner,
    reload,
  } = useResourceEditor<PageLayout>({
    tabType: "page-layout",
    mtimeKind: "pageLayout",
    draftKind: "page-layout",
    id: pageLayoutId,
    load: loadPageLayout,
    save: savePageLayout,
    broadcastName: "pageLayoutChanged",
    broadcastIdField: "pageLayoutId",
    onNotFound: handleNotFound,
    viewerMode: mode.kind as "viewer" | "editing" | "readonly",
    viewerResourceType: "page-layout",
    viewerEditSessionId: editSession?.id,
  });

  const isReadonly = mode.kind !== "editing";

  // auto-edit (「作成して編集」経由)
  const autoEditFiredRef = useRef(false);
  useEffect(() => {
    if (autoEditFiredRef.current) return;
    if (!pageLayoutId) return;
    if (mode.kind !== "readonly") return;
    if (sessionLoading) return;
    const key = `harmony-auto-edit:page-layout:${pageLayoutId}`;
    if (sessionStorage.getItem(key) !== "1") return;
    autoEditFiredRef.current = true;
    sessionStorage.removeItem(key);
    void actions.startEditing();
  }, [pageLayoutId, mode.kind, sessionLoading, actions]);

  const plRef = useRef<PageLayout | null>(null);
  useEffect(() => { plRef.current = pl ?? null; }, [pl]);

  const draftUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateWithDraft = useCallback((fn: (s: PageLayout) => void) => {
    if (isReadonly) return;
    update(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!pageLayoutId || !plRef.current) return;
      if (editSession?.id) {
        mcpBridge.request("editSession.update", {
          editSessionId: editSession.id,
          payload: plRef.current,
        }).catch(console.error);
      }
    }, 300);
  }, [isReadonly, update, pageLayoutId, editSession]);

  const handleSave = useCallback(async () => {
    if (isReadonly || isSaving) return;
    if (draftUpdateTimer.current) {
      clearTimeout(draftUpdateTimer.current);
      draftUpdateTimer.current = null;
    }
    if (plRef.current && editSession?.id) {
      await mcpBridge.request("editSession.update", {
        editSessionId: editSession.id,
        payload: plRef.current,
      });
    }
    const { conflicted, failed } = await actions.save();
    if (conflicted || failed) return;
    await postSave();
  }, [isReadonly, isSaving, actions, postSave, editSession]);

  const handleDiscard = useCallback(async () => {
    setShowDiscardDialog(false);
    await actions.discard();
    await reload();
  }, [actions, reload]);

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
    await actions.discard();
    await reload();
  }, [actions, reload]);

  useSaveShortcut(() => {
    if (isDirty && !isSaving && !isReadonly) void handleSave();
  });

  useEffect(() => {
    if (!pageLayoutId) return;
    const tabId = makeTabId("page-layout", pageLayoutId);
    setTabDirty(tabId, isDirtyForTab || isDirty);
  }, [pageLayoutId, isDirtyForTab, isDirty]);

  useEffect(() => {
    if (!pageLayoutId || sessionLoading) return;
    if (mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.request("editSession.list", {
        resourceType: "page-layout",
        resourceId: pageLayoutId,
      }) as { sessions: Array<{ state?: string; participants?: Record<string, unknown> }> } | null;
      if (cancelled) return;
      const mySessionId = mcpBridge.getSessionId();
      const hasMyActiveSession = (res?.sessions ?? []).some((s) =>
        s.state === "Active" && !!s.participants?.[mySessionId],
      );
      if (hasMyActiveSession) setShowResumeDialog(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [pageLayoutId, sessionLoading, mode.kind]);

  // gadget Screen 一覧をロード
  useEffect(() => {
    mcpBridge.startWithoutEditor();
    loadProject().then((project) => {
      const gadgets = (project.screens ?? [])
        .filter((s) => s.purpose === "gadget")
        .map((s) => ({ id: s.id, name: s.name }));
      setGadgetScreens(gadgets);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!pageLayoutId || sessionLoading) return;
    syncSessionToUrl(editSession?.id ?? "");
  }, [pageLayoutId, sessionLoading, editSession?.id, syncSessionToUrl]);

  if (!pl || sessionLoading) {
    return <div className="table-editor-loading"><i className="bi bi-hourglass-split" /> 読み込み中...</div>;
  }

  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;

  const regionNames = new Set((pl.regions ?? []).map((r) => r.name));

  const handleAddRegion = () => {
    const name = newRegionName.trim();
    if (!name) return;
    if (!/^[a-z][a-zA-Z0-9_-]*$/.test(name)) {
      setRegionNameError("region 名は英小文字で始まり、英数字・_ ・- のみ使用できます");
      return;
    }
    if (regionNames.has(name)) {
      setRegionNameError(`region 名 "${name}" は既に存在します`);
      return;
    }
    setRegionNameError("");
    updateWithDraft((s) => {
      s.regions = [...(s.regions ?? []), { name, description: newRegionDescription.trim() || undefined }];
    });
    setNewRegionName("");
    setNewRegionDescription("");
  };

  const handleRemoveRegion = (name: string) => {
    updateWithDraft((s) => {
      s.regions = (s.regions ?? []).filter((r) => r.name !== name);
      if (s.assignments) {
        delete s.assignments[name];
      }
    });
  };

  const handleMoveRegion = (idx: number, direction: "up" | "down") => {
    updateWithDraft((s) => {
      const regions = [...(s.regions ?? [])];
      const swapIdx = direction === "up" ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= regions.length) return;
      [regions[idx], regions[swapIdx]] = [regions[swapIdx], regions[idx]];
      s.regions = regions;
    });
  };

  const handleUpdateRegionDescription = (idx: number, description: string) => {
    updateWithDraft((s) => {
      const regions = [...(s.regions ?? [])];
      regions[idx] = { ...regions[idx], description: description || undefined };
      s.regions = regions as PageLayoutRegion[];
    });
  };

  const handleAssignmentChange = (regionName: string, screenId: string) => {
    updateWithDraft((s) => {
      const assignments = { ...(s.assignments ?? {}) };
      if (screenId) {
        assignments[regionName] = screenId;
      } else {
        delete assignments[regionName];
      }
      s.assignments = assignments;
    });
  };

  const backLink: EditorHeaderBackLink = {
    label: "ページレイアウト一覧",
    onClick: () => navigate(wsPath("/page-layout/list")),
  };

  const saveReset: EditorHeaderSaveReset | undefined = isReadonly ? undefined : {
    isDirty,
    isSaving,
    onSave: handleSave,
    onReset: () => setShowDiscardDialog(true),
  };

  return (
    <div className="table-editor-page">
      {/* ─── Dialogs ──────────────────────────────────────────────────── */}
      {mode.kind === "force-released-pending" && (
        <ForcedOutChoiceDialog
          previousDraftExists={mode.previousDraftExists}
          onChoice={(choice) => actions.handleForcedOut(choice)}
        />
      )}

      {mode.kind === "after-force-unlock" && (
        <AfterForceUnlockChoiceDialog
          previousOwner={mode.previousOwner}
          onChoice={(choice) => actions.handleAfterForceUnlock(choice)}
        />
      )}

      {showResumeDialog && (
        <ResumeOrDiscardDialog
          onResume={handleResumeContinue}
          onDiscard={handleResumeDiscard}
          onCancel={() => setShowResumeDialog(false)}
        />
      )}

      {showDiscardDialog && (
        <DiscardConfirmDialog
          onConfirm={handleDiscard}
          onCancel={() => setShowDiscardDialog(false)}
        />
      )}

      {showForceReleaseDialog && lockedByOther && (
        <ForceReleaseConfirmDialog
          ownerSessionId={lockedByOther.ownerSessionId}
          onConfirm={handleForceRelease}
          onCancel={() => setShowForceReleaseDialog(false)}
        />
      )}

      {saveConflict && (
        <SaveConflictDialog
          conflict={saveConflict}
          onOverwrite={async () => {
            try {
              await onSaveConflictOverwrite();
              await postSave();
            } catch (e) {
              console.error("[PageLayoutEditor] save overwrite failed:", e);
            }
          }}
          onCancel={onSaveConflictCancel}
        />
      )}

      {/* ─── Header ───────────────────────────────────────────────────── */}
      <EditorHeader
        title={<><i className="bi bi-layout-wtf" /> ページレイアウト編集: <code>{pl.name}</code></>}
        backLink={backLink}
        extraRight={
          <EditSessionDropdown
            resourceType="page-layout"
            resourceId={pageLayoutId ?? ""}
            currentMode={mode}
            currentSessionId={sessionId}
            onStartEditing={() => { void actions.startEditing(); }}
            onViewerAttached={syncSessionToUrl}
            onAttachAsView={attach}
            onTakeOver={takeOver}
          />
        }
        saveReset={saveReset}
      />

      {serverChanged && (
        <ServerChangeBanner onDismiss={dismissServerBanner} onReload={() => { void reload(); }} />
      )}

      <EditModeToolbar
        mode={mode}
        onStartEditing={actions.startEditing}
        onSave={handleSave}
        onDiscardClick={() => setShowDiscardDialog(true)}
        onForceReleaseClick={() => setShowForceReleaseDialog(true)}
        saving={isSaving}
        ownerLabel={lockedByOther?.ownerSessionId}
      />

      <div className="table-editor-content">
        {/* ─── 基本情報 ─────────────────────────────────────────────── */}
        <section className="tbl-editor-section">
          <h3 className="tbl-editor-section-title">基本情報</h3>
          <div className="tbl-field-group">
            <label className="tbl-field">
              <span>名前</span>
              <input
                type="text"
                value={pl.name}
                onChange={(e) => updateWithDraft((s) => { s.name = e.target.value as typeof s.name; })}
                disabled={isReadonly}
                className="tbl-input"
              />
            </label>
            <label className="tbl-field">
              <span>説明</span>
              <textarea
                value={pl.description ?? ""}
                onChange={(e) => updateWithDraft((s) => { s.description = e.target.value || undefined; })}
                disabled={isReadonly}
                rows={2}
                className="tbl-input"
              />
            </label>
            <label className="tbl-field">
              <span>成熟度</span>
              <select
                value={pl.maturity ?? "draft"}
                onChange={(e) => updateWithDraft((s) => { s.maturity = e.target.value as Maturity; })}
                disabled={isReadonly}
                className="tbl-select"
              >
                {MATURITY_OPTIONS.map((m) => (
                  <option key={m} value={m}>{MATURITY_LABELS[m]}</option>
                ))}
              </select>
            </label>
            <label className="tbl-field">
              <span>エディタ種別 <small className="tbl-field-hint">(作成後変更不可)</small></span>
              <input
                type="text"
                value={pl.design?.editorKind ?? "—"}
                disabled
                className="tbl-input"
              />
            </label>
            <label className="tbl-field">
              <span>CSS フレームワーク <small className="tbl-field-hint">(作成後変更不可)</small></span>
              <input
                type="text"
                value={pl.design?.cssFramework ?? "—"}
                disabled
                className="tbl-input"
              />
            </label>
          </div>
        </section>

        {/* ─── Regions ──────────────────────────────────────────────── */}
        <section className="tbl-editor-section">
          <h3 className="tbl-editor-section-title">
            Regions <span className="tbl-editor-badge">{(pl.regions ?? []).length}</span>
          </h3>
          <p className="tbl-editor-section-desc">
            予約名: <code>header</code> / <code>sidebar</code> / <code>footer</code> / <code>main</code>。
            <code>main</code> は page Screen 本文が嵌まる content slot。
          </p>
          <table className="tbl-inline-table">
            <thead>
              <tr>
                <th style={{ width: "36px" }} />
                <th>region 名</th>
                <th>説明</th>
                <th style={{ width: "80px" }} />
              </tr>
            </thead>
            <tbody>
              {(pl.regions ?? []).map((region, idx) => (
                <tr key={region.name} className={RESERVED_REGION_NAMES.includes(region.name) ? "tbl-row-reserved" : undefined}>
                  <td>
                    <div className="tbl-reorder-btns">
                      <button
                        className="tbl-icon-btn"
                        onClick={() => handleMoveRegion(idx, "up")}
                        disabled={isReadonly || idx === 0}
                        title="上へ"
                      >
                        <i className="bi bi-chevron-up" />
                      </button>
                      <button
                        className="tbl-icon-btn"
                        onClick={() => handleMoveRegion(idx, "down")}
                        disabled={isReadonly || idx === (pl.regions?.length ?? 0) - 1}
                        title="下へ"
                      >
                        <i className="bi bi-chevron-down" />
                      </button>
                    </div>
                  </td>
                  <td>
                    <code className="region-name-code">{region.name}</code>
                    {RESERVED_REGION_NAMES.includes(region.name) && (
                      <span className="tbl-reserved-badge" title="予約 region">予約</span>
                    )}
                  </td>
                  <td>
                    <input
                      type="text"
                      value={region.description ?? ""}
                      onChange={(e) => handleUpdateRegionDescription(idx, e.target.value)}
                      disabled={isReadonly}
                      placeholder="用途を記述..."
                      className="tbl-input tbl-input-sm"
                    />
                  </td>
                  <td>
                    <button
                      className="tbl-icon-btn danger"
                      onClick={() => handleRemoveRegion(region.name)}
                      disabled={isReadonly || region.name === "main"}
                      title={region.name === "main" ? "main region は削除できません" : "削除"}
                    >
                      <i className="bi bi-trash" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {!isReadonly && (
            <div className="tbl-add-row">
              <div className="tbl-add-row-fields">
                <input
                  type="text"
                  value={newRegionName}
                  onChange={(e) => { setNewRegionName(e.target.value); setRegionNameError(""); }}
                  placeholder="region 名 (例: breadcrumb)"
                  className={`tbl-input tbl-input-sm${regionNameError ? " input-error" : ""}`}
                  onKeyDown={(e) => { if (e.key === "Enter") handleAddRegion(); }}
                />
                <input
                  type="text"
                  value={newRegionDescription}
                  onChange={(e) => setNewRegionDescription(e.target.value)}
                  placeholder="説明 (任意)"
                  className="tbl-input tbl-input-sm"
                />
                <button
                  className="tbl-btn tbl-btn-ghost"
                  onClick={handleAddRegion}
                  disabled={!newRegionName.trim()}
                >
                  <i className="bi bi-plus" /> 追加
                </button>
              </div>
              {regionNameError && (
                <div className="tbl-field-error">{regionNameError}</div>
              )}
            </div>
          )}
        </section>

        {/* ─── Assignments ──────────────────────────────────────────── */}
        <section className="tbl-editor-section">
          <h3 className="tbl-editor-section-title">
            Assignments <span className="tbl-editor-badge">{Object.keys(pl.assignments ?? {}).length}</span>
          </h3>
          <p className="tbl-editor-section-desc">
            各 region に割り当てる gadget Screen を指定します。
            <code>main</code> は page Screen 本文が嵌まるため通常割り当て不要。
          </p>
          {gadgetScreens.length === 0 && (
            <div className="tbl-editor-hint">
              <i className="bi bi-info-circle" />
              {" "}割り当て可能な gadget Screen がありません。
              画面一覧で purpose = gadget の画面を作成してください。
            </div>
          )}
          <table className="tbl-inline-table">
            <thead>
              <tr>
                <th>region</th>
                <th>割り当て gadget Screen</th>
              </tr>
            </thead>
            <tbody>
              {(pl.regions ?? [])
                .filter((r) => r.name !== "main")
                .map((region) => (
                  <tr key={region.name}>
                    <td>
                      <code className="region-name-code">{region.name}</code>
                    </td>
                    <td>
                      <select
                        value={(pl.assignments ?? {})[region.name] ?? ""}
                        onChange={(e) => handleAssignmentChange(region.name, e.target.value)}
                        disabled={isReadonly}
                        className="tbl-select tbl-select-sm"
                      >
                        <option value="">— 未割り当て —</option>
                        {gadgetScreens.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>

        {/* ─── ProcessFlow (任意) ───────────────────────────────────── */}
        <section className="tbl-editor-section">
          <h3 className="tbl-editor-section-title">ProcessFlow 連携 <small className="tbl-field-hint">(任意)</small></h3>
          <p className="tbl-editor-section-desc">
            ガジェット間連携 orchestrator として紐付ける ProcessFlow を指定します (RFC #1021)。
          </p>
          <label className="tbl-field">
            <span>processFlowId</span>
            <input
              type="text"
              value={pl.processFlowId ?? ""}
              onChange={(e) => updateWithDraft((s) => { s.processFlowId = (e.target.value || undefined) as typeof s.processFlowId; })}
              disabled={isReadonly}
              placeholder="ProcessFlow UUID (任意)"
              className="tbl-input"
            />
          </label>
        </section>
      </div>

      {/* ─── maturity badge (bottom corner) ──────────────────────────── */}
      <div style={{ position: "fixed", bottom: 16, right: 16 }}>
        <MaturityBadge maturity={pl.maturity} />
      </div>
    </div>
  );
}
