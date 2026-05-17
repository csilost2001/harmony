/**
 * 規約カタログ編集ビュー (#317, #347, #555)
 *
 * 横断規約の機械可読カタログ (`data/conventions/catalog.json`) を designer 内で編集する
 * シングルトンタブ。カテゴリは 13 種、3 グループで表示:
 *   - 入力バリデーション: msg / regex / limit
 *   - 役割・権限: role / permission
 *   - プロダクト規約: scope / currency / tax / auth / db / numbering / tx / externalOutcomeDefaults
 *
 * #1145 Phase-5: 各カテゴリの編集 panel を `internal/categories/*Panel.tsx` に抽出。
 * 共通部品は `internal/SharedRowParts.tsx` / `internal/sharedOptions.ts` / `internal/sharedTypes.ts` に集約。
 * 拡張カテゴリ read-only 表示は `internal/categories/ExtensionCategoriesPanel.tsx` に分離。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TableSubToolbar } from "../table/TableSubToolbar";
import { EditorHeader } from "../common/EditorHeader";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { useResourceEditor } from "../../hooks/useResourceEditor";
import { useEditSession } from "../../hooks/useEditSession";
import { EditModeToolbar } from "../editing/EditModeToolbar";
import { EditSessionDropdown } from "../editing/EditSessionDropdown";
import {
  DiscardConfirmDialog,
  ForceReleaseConfirmDialog,
  ForcedOutChoiceDialog,
  AfterForceUnlockChoiceDialog,
} from "../editing/ConfirmDialogs";
import { ResumeOrDiscardDialog } from "../editing/ResumeOrDiscardDialog";
import { SaveConflictDialog } from "../editing/SaveConflictDialog";
import { setDirty as setTabDirty, makeTabId } from "../../store/tabStore";
import {
  loadConventions,
  saveConventions,
  createEmptyCatalog,
} from "../../store/conventionsStore";
import {
  type ConventionsCatalog,
  type ConventionIssue,
  checkConventionsCatalogIntegrity,
} from "../../schemas/conventionsValidator";
import type { SemVer } from "../../types/v3";
import { mcpBridge } from "../../mcp/mcpBridge";
import "../../styles/conventions.css";
import "../../styles/editMode.css";

import { MsgPanel } from "./internal/categories/MsgPanel";
import { RegexPanel } from "./internal/categories/RegexPanel";
import { LimitPanel } from "./internal/categories/LimitPanel";
import { ScopePanel } from "./internal/categories/ScopePanel";
import { CurrencyPanel } from "./internal/categories/CurrencyPanel";
import { TaxPanel } from "./internal/categories/TaxPanel";
import { AuthPanel } from "./internal/categories/AuthPanel";
import { RolePanel } from "./internal/categories/RolePanel";
import { PermissionPanel } from "./internal/categories/PermissionPanel";
import { DbPanel } from "./internal/categories/DbPanel";
import { NumberingPanel } from "./internal/categories/NumberingPanel";
import { TxPanel } from "./internal/categories/TxPanel";
import { ExternalOutcomeDefaultsPanel } from "./internal/categories/ExternalOutcomeDefaultsPanel";
import { ExtensionCategoriesPanel } from "./internal/categories/ExtensionCategoriesPanel";

type Category =
  | "msg" | "regex" | "limit"
  | "role" | "permission"
  | "scope" | "currency" | "tax" | "auth"
  | "db" | "numbering" | "tx" | "externalOutcomeDefaults";

const VALIDATION_CATEGORIES: Category[] = ["msg", "regex", "limit"];
const RBAC_CATEGORIES: Category[] = ["role", "permission"];
const PRODUCT_CATEGORIES: Category[] = [
  "scope", "currency", "tax", "auth", "db", "numbering", "tx", "externalOutcomeDefaults",
];

const CATEGORY_LABELS: Record<Category, string> = {
  msg: "メッセージ",
  regex: "正規表現",
  limit: "制限値",
  role: "役割",
  permission: "権限",
  scope: "スコープ",
  currency: "通貨",
  tax: "税",
  auth: "認証",
  db: "DB",
  numbering: "採番",
  tx: "TX",
  externalOutcomeDefaults: "外部連携既定",
};

const CATEGORY_ICONS: Record<Category, string> = {
  msg: "bi-chat-left-text",
  regex: "bi-regex",
  limit: "bi-rulers",
  role: "bi-person-badge",
  permission: "bi-shield-lock",
  scope: "bi-globe",
  currency: "bi-currency-yen",
  tax: "bi-calculator",
  auth: "bi-lock",
  db: "bi-database",
  numbering: "bi-hash",
  tx: "bi-arrow-repeat",
  externalOutcomeDefaults: "bi-broadcast",
};

const RESOURCE_ID = "main";

async function loadCatalog(): Promise<ConventionsCatalog> {
  const cat = await loadConventions();
  return cat ?? createEmptyCatalog();
}

async function saveCatalog(data: ConventionsCatalog): Promise<void> {
  await saveConventions(data);
}

function countCategoryEntries(catalog: ConventionsCatalog, cat: Category): number {
  const v = catalog[cat as keyof ConventionsCatalog];
  return v ? Object.keys(v as object).length : 0;
}

export function ConventionsCatalogView() {
  const [activeCategory, setActiveCategory] = useState<Category>("msg");
  const [showDiscardDialog, setShowDiscardDialog] = useState(false);
  const [showForceReleaseDialog, setShowForceReleaseDialog] = useState(false);
  const [showResumeDialog, setShowResumeDialog] = useState(false);

  const sessionId = mcpBridge.getSessionId();

  // #891 fix: useResourceEditor より前に呼び出し、viewerMode / viewerEditSessionId を渡せるようにする
  const { editSession, mode, loading: sessionLoading, isDirtyForTab, actions, attach, takeOver, saveConflict, onSaveConflictOverwrite, onSaveConflictCancel } = useEditSession({
    resourceType: "convention",
    resourceId: "singleton",
    sessionId,
  });

  const {
    state: catalog,
    isDirty, isSaving, serverChanged,
    update, updateSilent, commit,
    undo, redo, canUndo, canRedo,
    handleReset, dismissServerBanner,
    postSave,
    reload,
  } = useResourceEditor<ConventionsCatalog>({
    tabType: "conventions-catalog",
    mtimeKind: "conventions",
    draftKind: "conventions-catalog",
    id: RESOURCE_ID,
    load: loadCatalog,
    save: saveCatalog,
    broadcastName: "conventionsChanged",
    // #891 fix: viewer mode で mid-edit broadcast を受信するため渡す
    // 新 API では "viewer" | "editing" | "readonly" の 3 値のみ返す (legacy 値は発生しない)
    viewerMode: mode.kind as "viewer" | "editing" | "readonly",
    viewerResourceType: "convention",
    viewerEditSessionId: editSession?.id,
  });

  const isReadonly = mode.kind !== "editing";
  const catalogRef = useRef<ConventionsCatalog | null>(null);
  useEffect(() => { catalogRef.current = catalog ?? null; }, [catalog]);

  const draftUpdateTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const updateWithDraft = useCallback((fn: (c: ConventionsCatalog) => void) => {
    if (isReadonly) return;
    update(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!catalogRef.current) return;
      if (editSession?.id) {
        mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: catalogRef.current }).catch(console.error);
      }
    }, 300);
  }, [isReadonly, update, editSession]);

  const updateSilentWithDraft = useCallback((fn: (c: ConventionsCatalog) => void) => {
    if (isReadonly) return;
    updateSilent(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!catalogRef.current) return;
      if (editSession?.id) {
        mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: catalogRef.current }).catch(console.error);
      }
    }, 300);
  }, [isReadonly, updateSilent, editSession]);

  const handleSave = useCallback(async () => {
    if (isReadonly || isSaving) return;
    // pending debounce があればキャンセルして即 flush
    // 編集開始直後に保存した場合 draft が空のまま commitDraft に到達してゾンビロックになるのを防ぐ
    if (draftUpdateTimer.current) {
      clearTimeout(draftUpdateTimer.current);
      draftUpdateTimer.current = null;
    }
    if (catalogRef.current && editSession?.id) {
      await mcpBridge.request("editSession.update", { editSessionId: editSession.id, payload: catalogRef.current });
    }
    // P1-B fix (#908): conflict check (actions.save) を本体書き込みより先に実行する。
    // P1 fix (#908): conflict 時は postSave をスキップして clean 化を防ぐ。
    const { conflicted, failed } = await actions.save();
    if (conflicted || failed) return;
    // P1 fix (#908 round-5): convention は backend editSession.save で write skip されるため、
    // ここで catalog 本体ファイル書き込みを実行する (Extensions と同パターン)。
    if (catalogRef.current) {
      await saveCatalog(catalogRef.current);
    }
    await postSave();
  }, [isReadonly, isSaving, postSave, actions, editSession]);

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

  // タブ dirty マーク
  useEffect(() => {
    const tabId = makeTabId("conventions-catalog", "singleton");
    setTabDirty(tabId, isDirtyForTab || isDirty);
  }, [isDirtyForTab, isDirty]);

  // 復元ダイアログ (readonly + draft 存在時)
  useEffect(() => {
    if (sessionLoading) return;
    if (mode.kind !== "readonly") return;
    let cancelled = false;
    (async () => {
      const res = await mcpBridge.request("editSession.list", { resourceType: "convention", resourceId: "singleton" }) as { sessions: Array<{ state?: string; participants?: Record<string, unknown> }> } | null;
      if (cancelled) return;
      // #980-A: 自分が participant として参加していた Active session のみ対象。
      const mySessionId = mcpBridge.getSessionId();
      const hasMyActiveSession = (res?.sessions ?? []).some((s) =>
        s.state === "Active" && !!s.participants?.[mySessionId],
      );
      if (hasMyActiveSession) setShowResumeDialog(true);
    })().catch(console.error);
    return () => { cancelled = true; };
  }, [sessionLoading, mode.kind]);

  const addMsg = useCallback((key: string) => {
    updateWithDraft((c) => { if (!c.msg) c.msg = {}; if (!c.msg[key]) c.msg[key] = { template: "" }; });
  }, [updateWithDraft]);

  const addRegex = useCallback((key: string) => {
    updateWithDraft((c) => { if (!c.regex) c.regex = {}; if (!c.regex[key]) c.regex[key] = { pattern: "" }; });
  }, [updateWithDraft]);

  const addLimit = useCallback((key: string) => {
    updateWithDraft((c) => { if (!c.limit) c.limit = {}; if (!c.limit[key]) c.limit[key] = { value: 0 }; });
  }, [updateWithDraft]);

  const addScope = useCallback((key: string) => {
    updateWithDraft((c) => { if (!c.scope) c.scope = {}; if (!c.scope[key]) c.scope[key] = { value: "" }; });
  }, [updateWithDraft]);

  const addCurrency = useCallback((key: string) => {
    updateWithDraft((c) => { if (!c.currency) c.currency = {}; if (!c.currency[key]) c.currency[key] = { code: "" }; });
  }, [updateWithDraft]);

  const addTax = useCallback((key: string) => {
    updateWithDraft((c) => { if (!c.tax) c.tax = {}; if (!c.tax[key]) c.tax[key] = { kind: "exclusive", rate: 0 }; });
  }, [updateWithDraft]);

  const addAuth = useCallback((key: string) => {
    updateWithDraft((c) => { if (!c.auth) c.auth = {}; if (!c.auth[key]) c.auth[key] = { scheme: "" }; });
  }, [updateWithDraft]);

  const addRole = useCallback((key: string) => {
    updateWithDraft((c) => { if (!c.role) c.role = {}; if (!c.role[key]) c.role[key] = { permissions: [] }; });
  }, [updateWithDraft]);

  const addPermission = useCallback((key: string) => {
    updateWithDraft((c) => {
      if (!c.permission) c.permission = {};
      if (!c.permission[key]) c.permission[key] = { resource: "", action: "" };
    });
  }, [updateWithDraft]);

  const addDb = useCallback((key: string) => {
    updateWithDraft((c) => { if (!c.db) c.db = {}; if (!c.db[key]) c.db[key] = {}; });
  }, [updateWithDraft]);

  const addNumbering = useCallback((key: string) => {
    updateWithDraft((c) => { if (!c.numbering) c.numbering = {}; if (!c.numbering[key]) c.numbering[key] = { format: "" }; });
  }, [updateWithDraft]);

  const addTx = useCallback((key: string) => {
    updateWithDraft((c) => { if (!c.tx) c.tx = {}; if (!c.tx[key]) c.tx[key] = { policy: "" }; });
  }, [updateWithDraft]);

  const addExternalOutcomeDefault = useCallback((key: string) => {
    updateWithDraft((c) => {
      if (!c.externalOutcomeDefaults) c.externalOutcomeDefaults = {};
      if (!c.externalOutcomeDefaults[key]) c.externalOutcomeDefaults[key] = { outcome: "failure", action: "abort" };
    });
  }, [updateWithDraft]);

  const integrityIssues = useMemo<ConventionIssue[]>(
    () => (catalog ? checkConventionsCatalogIntegrity(catalog) : []),
    [catalog],
  );

  if (!catalog) return null;

  const lockedByOther = mode.kind === "locked-by-other" ? mode : null;

  const renderTabGroup = (label: string, categories: Category[]) => (
    <div className="conventions-tab-group">
      <span className="conventions-tab-group-label">{label}</span>
      <div className="conventions-category-tabs" role="tablist">
        {categories.map((cat) => {
          const count = countCategoryEntries(catalog, cat);
          return (
            <button
              key={cat}
              type="button"
              className={`conventions-category-tab ${activeCategory === cat ? "active" : ""}`}
              onClick={() => setActiveCategory(cat)}
              role="tab"
              aria-selected={activeCategory === cat}
            >
              <i className={`bi ${CATEGORY_ICONS[cat]}`} /> {CATEGORY_LABELS[cat]}
              {count > 0 && <span className="conventions-category-count">{count}</span>}
            </button>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className={`conventions-catalog-view${isReadonly ? " readonly-mode" : ""}`}>
      <TableSubToolbar />

      {serverChanged && (
        <ServerChangeBanner onReload={handleReset} onDismiss={dismissServerBanner} />
      )}

      <EditModeToolbar
        mode={mode}
        onStartEditing={actions.startEditing}
        onSave={() => { handleSave().catch(console.error); }}
        onDiscardClick={() => setShowDiscardDialog(true)}
        onForceReleaseClick={() => setShowForceReleaseDialog(true)}
        saving={isSaving}
        ownerLabel={lockedByOther?.ownerSessionId}
      />

      {/* #994: collab UX 整合 — Viewer attach / take-over / 新規 draft / 履歴 */}
      <div className="d-flex justify-content-end" style={{ padding: "4px 8px" }}>
        <EditSessionDropdown
          resourceType="convention"
          resourceId="singleton"
          currentMode={mode}
          currentSessionId={sessionId}
          onStartEditing={() => { void actions.startEditing(); }}
          onAttachAsView={attach}
          onTakeOver={takeOver}
        />
      </div>

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
            // P1 派生 fix (#911): backend force save 後に本体ファイル書き込み + cleanup を実行する。
            // convention は backend editSession.save で write skip されるため、ここで saveCatalog を呼ぶ。
            try {
              await onSaveConflictOverwrite();
              if (catalogRef.current) {
                await saveCatalog(catalogRef.current);
              }
              await postSave();
            } catch (e) {
              console.error("[ConventionsCatalogView] save overwrite failed:", e);
            }
          }}
          onCancel={onSaveConflictCancel}
        />
      )}

      <EditorHeader
        title={
          <span className="fw-semibold">
            規約カタログ
            {isDirtyForTab && (
              <span className="list-item-draft-mark" title="未保存の編集中 draft があります">●</span>
            )}
          </span>
        }
        undoRedo={{ onUndo: undo, onRedo: redo, canUndo, canRedo }}
        saveReset={isReadonly ? undefined : { isDirty, isSaving, onSave: handleSave, onReset: () => setShowDiscardDialog(true) }}
      />

      <div className="conventions-meta-bar">
        <label className="small text-muted">version</label>
        <input
          type="text"
          className="form-control form-control-sm conventions-version-input"
          value={catalog.version ?? ""}
          onChange={(e) => updateSilentWithDraft((c) => { c.version = e.target.value as SemVer; })}
          onBlur={commit}
          placeholder="1.0.0"
          disabled={isReadonly}
        />
        <label className="small text-muted">description</label>
        <input
          type="text"
          className="form-control form-control-sm conventions-description-input"
          value={catalog.description ?? ""}
          onChange={(e) => updateSilentWithDraft((c) => { c.description = e.target.value || undefined; })}
          onBlur={commit}
          placeholder="カタログの用途 (任意)"
          disabled={isReadonly}
        />
      </div>

      <div className="conventions-tabs-area">
        {renderTabGroup("入力バリデーション", VALIDATION_CATEGORIES)}
        {renderTabGroup("役割・権限", RBAC_CATEGORIES)}
        {renderTabGroup("プロダクト規約", PRODUCT_CATEGORIES)}
      </div>

      <div className="conventions-category-content">
        {activeCategory === "msg" && (
          <MsgPanel
            msg={catalog.msg ?? {}}
            onAdd={addMsg}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.msg?.[key]) Object.assign(c.msg[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.msg) delete c.msg[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "regex" && (
          <RegexPanel
            regex={catalog.regex ?? {}}
            onAdd={addRegex}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.regex?.[key]) Object.assign(c.regex[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.regex) delete c.regex[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "limit" && (
          <LimitPanel
            limit={catalog.limit ?? {}}
            onAdd={addLimit}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.limit?.[key]) Object.assign(c.limit[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.limit) delete c.limit[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "scope" && (
          <ScopePanel
            scope={catalog.scope ?? {}}
            onAdd={addScope}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.scope?.[key]) Object.assign(c.scope[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.scope) delete c.scope[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "currency" && (
          <CurrencyPanel
            currency={catalog.currency ?? {}}
            onAdd={addCurrency}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.currency?.[key]) Object.assign(c.currency[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.currency) delete c.currency[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "tax" && (
          <TaxPanel
            tax={catalog.tax ?? {}}
            onAdd={addTax}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.tax?.[key]) Object.assign(c.tax[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.tax) delete c.tax[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "auth" && (
          <AuthPanel
            auth={catalog.auth ?? {}}
            onAdd={addAuth}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.auth?.[key]) Object.assign(c.auth[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.auth) delete c.auth[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "role" && (
          <RolePanel
            role={catalog.role ?? {}}
            permissionKeys={Object.keys(catalog.permission ?? {})}
            issues={integrityIssues}
            onAdd={addRole}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.role?.[key]) Object.assign(c.role[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.role) delete c.role[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "permission" && (
          <PermissionPanel
            permission={catalog.permission ?? {}}
            onAdd={addPermission}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.permission?.[key]) Object.assign(c.permission[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.permission) delete c.permission[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "db" && (
          <DbPanel
            db={catalog.db ?? {}}
            onAdd={addDb}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.db?.[key]) Object.assign(c.db[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.db) delete c.db[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "numbering" && (
          <NumberingPanel
            numbering={catalog.numbering ?? {}}
            onAdd={addNumbering}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.numbering?.[key]) Object.assign(c.numbering[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.numbering) delete c.numbering[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "tx" && (
          <TxPanel
            tx={catalog.tx ?? {}}
            onAdd={addTx}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.tx?.[key]) Object.assign(c.tx[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.tx) delete c.tx[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "externalOutcomeDefaults" && (
          <ExternalOutcomeDefaultsPanel
            entries={catalog.externalOutcomeDefaults ?? {}}
            onAdd={addExternalOutcomeDefault}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => {
              if (c.externalOutcomeDefaults?.[key]) Object.assign(c.externalOutcomeDefaults[key], patch);
            })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.externalOutcomeDefaults) delete c.externalOutcomeDefaults[key]; })}
            isReadonly={isReadonly}
          />
        )}
      </div>

      <ExtensionCategoriesPanel extensionCategories={catalog.extensionCategories} />
    </div>
  );
}
