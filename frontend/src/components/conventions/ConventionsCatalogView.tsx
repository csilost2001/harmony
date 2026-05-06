/**
 * 規約カタログ編集ビュー (#317, #347, #555)
 *
 * 横断規約の機械可読カタログ (`data/conventions/catalog.json`) を designer 内で編集する
 * シングルトンタブ。カテゴリは 13 種、3 グループで表示:
 *   - 入力バリデーション: msg / regex / limit
 *   - 役割・権限: role / permission
 *   - プロダクト規約: scope / currency / tax / auth / db / numbering / tx / externalOutcomeDefaults
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TableSubToolbar } from "../table/TableSubToolbar";
import { EditorHeader } from "../common/EditorHeader";
import { ServerChangeBanner } from "../common/ServerChangeBanner";
import { useResourceEditor } from "../../hooks/useResourceEditor";
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
import type {
  ScopeEntry,
  CurrencyEntry,
  TaxEntry,
  AuthEntry,
  RoleEntry,
  PermissionEntry,
  DbEntry,
  NumberingEntry,
  TxEntry,
  ExternalOutcomeEntry,
  SemVer,
} from "../../types/v3";
import { mcpBridge } from "../../mcp/mcpBridge";
import "../../styles/conventions.css";
import "../../styles/editMode.css";

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

  const {
    state: catalog,
    isDirty, isSaving, serverChanged,
    update, updateSilent, commit,
    undo, redo, canUndo, canRedo,
    handleSave: resourceHandleSave, handleReset, dismissServerBanner,
    reload,
  } = useResourceEditor<ConventionsCatalog>({
    tabType: "conventions-catalog",
    mtimeKind: "conventions",
    draftKind: "conventions-catalog",
    id: RESOURCE_ID,
    load: loadCatalog,
    save: saveCatalog,
    broadcastName: "conventionsChanged",
  });

  const { mode, loading: sessionLoading, isDirtyForTab, actions } = useEditSession({
    resourceType: "convention",
    resourceId: "singleton",
    sessionId,
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
      mcpBridge.updateDraft("convention", "singleton", catalogRef.current).catch(console.error);
    }, 300);
  }, [isReadonly, update]);

  const updateSilentWithDraft = useCallback((fn: (c: ConventionsCatalog) => void) => {
    if (isReadonly) return;
    updateSilent(fn);
    if (draftUpdateTimer.current) clearTimeout(draftUpdateTimer.current);
    draftUpdateTimer.current = setTimeout(() => {
      if (!catalogRef.current) return;
      mcpBridge.updateDraft("convention", "singleton", catalogRef.current).catch(console.error);
    }, 300);
  }, [isReadonly, updateSilent]);

  const handleSave = useCallback(async () => {
    if (isReadonly || isSaving) return;
    // pending debounce があればキャンセルして即 flush
    // 編集開始直後に保存した場合 draft が空のまま commitDraft に到達してゾンビロックになるのを防ぐ
    if (draftUpdateTimer.current) {
      clearTimeout(draftUpdateTimer.current);
      draftUpdateTimer.current = null;
    }
    if (catalogRef.current) {
      await mcpBridge.updateDraft("convention", "singleton", catalogRef.current);
    }
    await resourceHandleSave();
    await actions.save();
  }, [isReadonly, isSaving, resourceHandleSave, actions]);

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
    await mcpBridge.discardDraft("convention", "singleton");
    await reload();
  }, [reload]);

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
      const res = await mcpBridge.hasDraft("convention", "singleton") as { exists: boolean } | null;
      if (cancelled) return;
      if (res?.exists) setShowResumeDialog(true);
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
          <MsgEditor
            msg={catalog.msg ?? {}}
            onAdd={addMsg}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.msg?.[key]) Object.assign(c.msg[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.msg) delete c.msg[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "regex" && (
          <RegexEditor
            regex={catalog.regex ?? {}}
            onAdd={addRegex}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.regex?.[key]) Object.assign(c.regex[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.regex) delete c.regex[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "limit" && (
          <LimitEditor
            limit={catalog.limit ?? {}}
            onAdd={addLimit}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.limit?.[key]) Object.assign(c.limit[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.limit) delete c.limit[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "scope" && (
          <ScopeEditor
            scope={catalog.scope ?? {}}
            onAdd={addScope}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.scope?.[key]) Object.assign(c.scope[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.scope) delete c.scope[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "currency" && (
          <CurrencyEditor
            currency={catalog.currency ?? {}}
            onAdd={addCurrency}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.currency?.[key]) Object.assign(c.currency[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.currency) delete c.currency[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "tax" && (
          <TaxEditor
            tax={catalog.tax ?? {}}
            onAdd={addTax}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.tax?.[key]) Object.assign(c.tax[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.tax) delete c.tax[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "auth" && (
          <AuthEditor
            auth={catalog.auth ?? {}}
            onAdd={addAuth}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.auth?.[key]) Object.assign(c.auth[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.auth) delete c.auth[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "role" && (
          <RoleEditor
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
          <PermissionEditor
            permission={catalog.permission ?? {}}
            onAdd={addPermission}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.permission?.[key]) Object.assign(c.permission[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.permission) delete c.permission[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "db" && (
          <DbEditor
            db={catalog.db ?? {}}
            onAdd={addDb}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.db?.[key]) Object.assign(c.db[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.db) delete c.db[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "numbering" && (
          <NumberingEditor
            numbering={catalog.numbering ?? {}}
            onAdd={addNumbering}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.numbering?.[key]) Object.assign(c.numbering[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.numbering) delete c.numbering[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "tx" && (
          <TxEditor
            tx={catalog.tx ?? {}}
            onAdd={addTx}
            onUpdate={(key, patch) => updateSilentWithDraft((c) => { if (c.tx?.[key]) Object.assign(c.tx[key], patch); })}
            onCommit={commit}
            onRemove={(key) => updateWithDraft((c) => { if (c.tx) delete c.tx[key]; })}
            isReadonly={isReadonly}
          />
        )}
        {activeCategory === "externalOutcomeDefaults" && (
          <ExternalOutcomeDefaultEditor
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

/** 拡張カテゴリ表示 (read-only)。extensions.v3 の conventionCategories で定義された業界規約を一覧表示。 */
function ExtensionCategoriesPanel({
  extensionCategories,
}: {
  extensionCategories?: Record<string, Record<string, unknown>>;
}) {
  const entries = Object.entries(extensionCategories ?? {});
  return (
    <section className="conventions-extension-categories">
      <h3 className="conventions-section-title">
        <i className="bi bi-puzzle" /> 拡張カテゴリ
        <small className="text-muted ms-2">
          (extensions.v3 の conventionCategories で定義、`@conv.&lt;categoryName&gt;.&lt;key&gt;` で参照)
        </small>
      </h3>
      {entries.length === 0 ? (
        <div className="conventions-empty">拡張カテゴリは定義されていません。</div>
      ) : (
        <table className="conventions-table">
          <thead>
            <tr>
              <th>カテゴリ名</th>
              <th>エントリ数</th>
              <th>キー一覧</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(([catName, catEntries]) => {
              const keys = Object.keys(catEntries ?? {});
              return (
                <tr key={catName}>
                  <td><code className="conventions-key-badge">@conv.{catName}.*</code></td>
                  <td>{keys.length}</td>
                  <td className="text-muted">
                    {keys.length > 0 ? keys.join(", ") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ── 共通部品 ────────────────────────────────────────────────────────────

function DeleteBtn({ onClick, isReadonly }: { onClick: () => void; isReadonly?: boolean }) {
  return (
    <button
      type="button"
      className="btn btn-sm btn-link text-danger p-0"
      onClick={onClick}
      title="削除"
      aria-label="削除"
      disabled={isReadonly}
    >
      <i className="bi bi-x" />
    </button>
  );
}

function NewKeyRow({
  placeholder, value, setValue, onAdd, disabled, isReadonly,
}: {
  placeholder: string;
  value: string;
  setValue: (v: string) => void;
  onAdd: () => void;
  disabled: boolean;
  isReadonly?: boolean;
}) {
  return (
    <div className="conventions-new-key-row">
      <input
        className="form-control form-control-sm conventions-new-key-input"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && !disabled && !isReadonly) { e.preventDefault(); onAdd(); } }}
        disabled={isReadonly}
      />
      <button
        type="button"
        className="btn btn-sm btn-outline-primary"
        onClick={onAdd}
        disabled={disabled || isReadonly}
      >
        <i className="bi bi-plus-lg" /> 追加
      </button>
    </div>
  );
}

function EntriesWrapper({ children, empty }: { children: React.ReactNode; empty: boolean }) {
  return (
    <div className="conventions-entries">
      {empty && <div className="conventions-empty">エントリがありません。下の入力欄から追加してください。</div>}
      {children}
    </div>
  );
}

// ── 既存 3 エディタ ─────────────────────────────────────────────────────

interface MsgEntryLocal {
  template: string;
  params?: string[];
  description?: string;
}

function MsgEditor({
  msg, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  msg: Record<string, MsgEntryLocal>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<MsgEntryLocal>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(msg);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col />
          <col style={{ width: "18em" }} />
          <col style={{ width: "18em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.msg.xxx)</th>
            <th>template</th>
            <th>params (カンマ区切り)</th>
            <th>description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.template}
                  onChange={(e) => onUpdate(key, { template: e.target.value })}
                  onBlur={onCommit}
                  placeholder="{label}は必須入力です"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={(entry.params ?? []).join(", ")}
                  onChange={(e) => {
                    const params = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                    onUpdate(key, { params: params.length > 0 ? params : undefined });
                  }}
                  onBlur={onCommit}
                  placeholder="label, max"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: required)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !msg[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(msg, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

interface RegexEntryLocal {
  pattern: string;
  flags?: string;
  description?: string;
}

function RegexEditor({
  regex, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  regex: Record<string, RegexEntryLocal>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<RegexEntryLocal>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(regex);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col />
          <col style={{ width: "6em" }} />
          <col style={{ width: "18em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.regex.xxx)</th>
            <th>pattern</th>
            <th>flags</th>
            <th>description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <input
                  className="form-control form-control-sm conventions-mono"
                  value={entry.pattern}
                  onChange={(e) => onUpdate(key, { pattern: e.target.value })}
                  onBlur={onCommit}
                  placeholder="^[A-Za-z0-9]+$"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm conventions-mono"
                  value={entry.flags ?? ""}
                  onChange={(e) => onUpdate(key, { flags: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="i"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: phone-jp)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !regex[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(regex, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

interface LimitEntryLocal {
  value: number;
  unit?: string;
  description?: string;
}

function LimitEditor({
  limit, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  limit: Record<string, LimitEntryLocal>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<LimitEntryLocal>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(limit);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "8em" }} />
          <col />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.limit.xxx)</th>
            <th>value</th>
            <th>unit</th>
            <th>description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={entry.value}
                  onChange={(e) => onUpdate(key, { value: Number(e.target.value) })}
                  onBlur={onCommit}
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.unit ?? ""}
                  onChange={(e) => onUpdate(key, { unit: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="char"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: emailMax)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !limit[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(limit, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

// ── プロダクト規約 + role/permission エディタ群 ─────────────────────────

function DefaultCell<T extends { default?: boolean }>({
  entry, onUpdate, onCommit,
}: {
  entry: T;
  onUpdate: (patch: Partial<T>) => void;
  onCommit: () => void;
}) {
  return (
    <td className="text-center" title="プロジェクト全体の ambient default として扱う">
      <input
        type="checkbox"
        checked={entry.default ?? false}
        onChange={(e) => {
          onUpdate({ default: e.target.checked || undefined } as Partial<T>);
          onCommit();
        }}
      />
    </td>
  );
}

function ScopeEditor({
  scope, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  scope: Record<string, ScopeEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<ScopeEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(scope);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col style={{ width: "16em" }} />
          <col />
          <col style={{ width: "5em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.scope.xxx)</th>
            <th>value</th>
            <th>description</th>
            <th title="プロジェクト全体の ambient default として扱う">default</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.value}
                  onChange={(e) => onUpdate(key, { value: e.target.value })}
                  onBlur={onCommit}
                  placeholder="domestic"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <DefaultCell
                entry={entry}
                onUpdate={(patch) => onUpdate(key, patch)}
                onCommit={onCommit}
              />
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: customerRegion)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !scope[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(scope, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

const ROUNDING_OPTIONS = ["", "floor", "ceil", "round"] as const;

function CurrencyEditor({
  currency, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  currency: Record<string, CurrencyEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<CurrencyEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(currency);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "7em" }} />
          <col style={{ width: "8em" }} />
          <col style={{ width: "10em" }} />
          <col />
          <col style={{ width: "5em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.currency.xxx)</th>
            <th>code (ISO 4217)</th>
            <th>subunit</th>
            <th>roundingMode</th>
            <th>description</th>
            <th title="プロジェクト全体の ambient default として扱う">default</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <input
                  className="form-control form-control-sm conventions-mono"
                  value={entry.code}
                  onChange={(e) => onUpdate(key, { code: e.target.value })}
                  onBlur={onCommit}
                  placeholder="JPY"
                />
              </td>
              <td>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={entry.subunit ?? ""}
                  onChange={(e) => onUpdate(key, { subunit: e.target.value === "" ? undefined : Number(e.target.value) })}
                  onBlur={onCommit}
                  placeholder="0"
                  min={0}
                />
              </td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.roundingMode ?? ""}
                  onChange={(e) => {
                    onUpdate(key, { roundingMode: (e.target.value || undefined) as CurrencyEntry["roundingMode"] });
                    onCommit();
                  }}
                >
                  {ROUNDING_OPTIONS.map((o) => <option key={o} value={o}>{o || "(未指定)"}</option>)}
                </select>
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <DefaultCell
                entry={entry}
                onUpdate={(patch) => onUpdate(key, patch)}
                onCommit={onCommit}
              />
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: jpy)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !currency[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(currency, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

function TaxEditor({
  tax, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  tax: Record<string, TaxEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<TaxEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(tax);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "10em" }} />
          <col />
          <col style={{ width: "5em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.tax.xxx)</th>
            <th>kind</th>
            <th>rate (0〜1)</th>
            <th>roundingMode</th>
            <th>description</th>
            <th title="プロジェクト全体の ambient default として扱う">default</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.kind}
                  onChange={(e) => { onUpdate(key, { kind: e.target.value as TaxEntry["kind"] }); onCommit(); }}
                >
                  <option value="exclusive">exclusive (外税)</option>
                  <option value="inclusive">inclusive (内税)</option>
                </select>
              </td>
              <td>
                <input
                  type="number"
                  className="form-control form-control-sm"
                  value={entry.rate}
                  onChange={(e) => onUpdate(key, { rate: Number(e.target.value) })}
                  onBlur={onCommit}
                  step={0.01}
                  min={0}
                  max={1}
                  placeholder="0.10"
                />
              </td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.roundingMode ?? ""}
                  onChange={(e) => {
                    onUpdate(key, { roundingMode: (e.target.value || undefined) as TaxEntry["roundingMode"] });
                    onCommit();
                  }}
                >
                  {ROUNDING_OPTIONS.map((o) => <option key={o} value={o}>{o || "(未指定)"}</option>)}
                </select>
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <DefaultCell
                entry={entry}
                onUpdate={(patch) => onUpdate(key, patch)}
                onCommit={onCommit}
              />
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: standard)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !tax[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(tax, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

function AuthEditor({
  auth, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  auth: Record<string, AuthEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<AuthEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(auth);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "14em" }} />
          <col style={{ width: "14em" }} />
          <col style={{ width: "14em" }} />
          <col />
          <col style={{ width: "5em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.auth.xxx)</th>
            <th>scheme</th>
            <th>sessionStorage</th>
            <th>passwordHash</th>
            <th>description</th>
            <th title="プロジェクト全体の ambient default として扱う">default</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.scheme}
                  onChange={(e) => onUpdate(key, { scheme: e.target.value })}
                  onBlur={onCommit}
                  placeholder="session-cookie"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.sessionStorage ?? ""}
                  onChange={(e) => onUpdate(key, { sessionStorage: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="httpOnly-cookie"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.passwordHash ?? ""}
                  onChange={(e) => onUpdate(key, { passwordHash: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="bcrypt(cost=12)"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <DefaultCell
                entry={entry}
                onUpdate={(patch) => onUpdate(key, patch)}
                onCommit={onCommit}
              />
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: default)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !auth[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(auth, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

function RoleEditor({
  role, permissionKeys, issues, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  role: Record<string, RoleEntry>;
  permissionKeys: string[];
  issues: ConventionIssue[];
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<RoleEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(role);
  const roleKeys = Object.keys(role);

  // role.<key> から始まる issue を key 別に集約
  const issuesByKey = useMemo(() => {
    const map = new Map<string, ConventionIssue[]>();
    for (const iss of issues) {
      const m = /^role\.([^.[]+)/.exec(iss.path);
      if (!m) continue;
      const k = m[1];
      const arr = map.get(k) ?? [];
      arr.push(iss);
      map.set(k, arr);
    }
    return map;
  }, [issues]);

  const permissionListId = "conventions-permission-keys";
  const roleListId = "conventions-role-keys";

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <datalist id={permissionListId}>
        {permissionKeys.map((k) => <option key={k} value={k} />)}
      </datalist>
      <datalist id={roleListId}>
        {roleKeys.map((k) => <option key={k} value={k} />)}
      </datalist>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "14em" }} />
          <col />
          <col style={{ width: "16em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.role.xxx)</th>
            <th>name</th>
            <th>description</th>
            <th>permissions (カンマ区切り)</th>
            <th>inherits (カンマ区切り)</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => {
            const rowIssues = issuesByKey.get(key) ?? [];
            const hasPermIssue = rowIssues.some((i) =>
              i.code === "UNKNOWN_CONV_ROLE_PERMISSION" && i.path.startsWith(`role.${key}.permissions`),
            );
            const hasInheritsIssue = rowIssues.some((i) =>
              (i.code === "UNKNOWN_CONV_ROLE_INHERITS" || i.code === "ROLE_INHERITS_CYCLE") &&
              i.path.startsWith(`role.${key}.inherits`),
            );
            return (
              <Fragment key={key}>
                <tr>
                  <td><code className="conventions-key-badge">{key}</code></td>
                  <td>
                    <input
                      className="form-control form-control-sm"
                      value={entry.name ?? ""}
                      onChange={(e) => onUpdate(key, { name: e.target.value || undefined })}
                      onBlur={onCommit}
                      placeholder="顧客"
                    />
                  </td>
                  <td>
                    <input
                      className="form-control form-control-sm"
                      value={entry.description ?? ""}
                      onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                      onBlur={onCommit}
                    />
                  </td>
                  <td>
                    <input
                      className={`form-control form-control-sm ${hasPermIssue ? "is-invalid" : ""}`}
                      list={permissionListId}
                      value={(entry.permissions ?? []).join(", ")}
                      onChange={(e) => {
                        const perms = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        onUpdate(key, { permissions: perms });
                      }}
                      onBlur={onCommit}
                      placeholder="order.create, order.read"
                    />
                  </td>
                  <td>
                    <input
                      className={`form-control form-control-sm ${hasInheritsIssue ? "is-invalid" : ""}`}
                      list={roleListId}
                      value={(entry.inherits ?? []).join(", ")}
                      onChange={(e) => {
                        const inh = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                        onUpdate(key, { inherits: inh.length > 0 ? inh : undefined });
                      }}
                      onBlur={onCommit}
                      placeholder="customer"
                    />
                  </td>
                  <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
                </tr>
                {rowIssues.length > 0 && (
                  <tr className="conventions-row-issues">
                    <td />
                    <td colSpan={5}>
                      <ul className="conventions-issue-list">
                        {rowIssues.map((iss, i) => (
                          <li key={i} className="conventions-issue">
                            <i className="bi bi-exclamation-triangle-fill" />
                            <span className="conventions-issue-message">{iss.message}</span>
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: customer)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !role[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(role, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

const SCOPE_OPTIONS = ["", "all", "own", "department"] as const;

function PermissionEditor({
  permission, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  permission: Record<string, PermissionEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<PermissionEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(permission);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col style={{ width: "12em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "10em" }} />
          <col />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.permission.xxx)</th>
            <th>resource</th>
            <th>action</th>
            <th>scope</th>
            <th>description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.resource}
                  onChange={(e) => onUpdate(key, { resource: e.target.value })}
                  onBlur={onCommit}
                  placeholder="Order"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.action}
                  onChange={(e) => onUpdate(key, { action: e.target.value })}
                  onBlur={onCommit}
                  placeholder="create"
                />
              </td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.scope ?? ""}
                  onChange={(e) => {
                    onUpdate(key, { scope: (e.target.value || undefined) as PermissionEntry["scope"] });
                    onCommit();
                  }}
                >
                  {SCOPE_OPTIONS.map((o) => <option key={o} value={o}>{o || "(未指定)"}</option>)}
                </select>
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: order.create)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !permission[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(permission, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

function DbEditor({
  db, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  db: Record<string, DbEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<DbEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(db);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "12em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "16em" }} />
          <col style={{ width: "12em" }} />
          <col />
          <col style={{ width: "5em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.db.xxx)</th>
            <th>engine</th>
            <th>namingConvention</th>
            <th>timestampColumns (カンマ区切り)</th>
            <th>logicalDeleteColumn</th>
            <th>description</th>
            <th title="プロジェクト全体の ambient default として扱う">default</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.engine ?? ""}
                  onChange={(e) => onUpdate(key, { engine: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="postgresql@14"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.namingConvention ?? ""}
                  onChange={(e) => onUpdate(key, { namingConvention: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="snake_case"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={(entry.timestampColumns ?? []).join(", ")}
                  onChange={(e) => {
                    const cols = e.target.value.split(",").map((s) => s.trim()).filter(Boolean);
                    onUpdate(key, { timestampColumns: cols.length > 0 ? cols : undefined });
                  }}
                  onBlur={onCommit}
                  placeholder="created_at, updated_at"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.logicalDeleteColumn ?? ""}
                  onChange={(e) => onUpdate(key, { logicalDeleteColumn: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="is_deleted"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <DefaultCell
                entry={entry}
                onUpdate={(patch) => onUpdate(key, patch)}
                onCommit={onCommit}
              />
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: default)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !db[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(db, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

function NumberingEditor({
  numbering, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  numbering: Record<string, NumberingEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<NumberingEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(numbering);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col style={{ width: "14em" }} />
          <col style={{ width: "18em" }} />
          <col />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.numbering.xxx)</th>
            <th>format</th>
            <th>implementation</th>
            <th>description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <input
                  className="form-control form-control-sm conventions-mono"
                  value={entry.format}
                  onChange={(e) => onUpdate(key, { format: e.target.value })}
                  onBlur={onCommit}
                  placeholder="C-NNNN"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.implementation ?? ""}
                  onChange={(e) => onUpdate(key, { implementation: e.target.value || undefined })}
                  onBlur={onCommit}
                  placeholder="PG sequence + DEFAULT"
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: customerCode)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !numbering[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(numbering, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

function TxEditor({
  tx, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  tx: Record<string, TxEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<TxEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(tx);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "14em" }} />
          <col />
          <col style={{ width: "18em" }} />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.tx.xxx)</th>
            <th>policy</th>
            <th>description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <textarea
                  className="form-control form-control-sm conventions-table-textarea"
                  value={entry.policy}
                  onChange={(e) => onUpdate(key, { policy: e.target.value })}
                  onBlur={onCommit}
                  rows={2}
                  placeholder="単一操作は 1 TX..."
                />
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: singleOperation)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !tx[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(tx, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}

const OUTCOME_OPTIONS: ExternalOutcomeEntry["outcome"][] = ["success", "failure", "timeout"];
const ACTION_OPTIONS: ExternalOutcomeEntry["action"][] = ["continue", "abort", "compensate"];
const RETRY_OPTIONS = ["", "none", "fixed", "exponential"] as const;

function ExternalOutcomeDefaultEditor({
  entries: entriesMap, onAdd, onUpdate, onCommit, onRemove, isReadonly,
}: {
  entries: Record<string, ExternalOutcomeEntry>;
  onAdd: (key: string) => void;
  onUpdate: (key: string, patch: Partial<ExternalOutcomeEntry>) => void;
  onCommit: () => void;
  onRemove: (key: string) => void;
  isReadonly?: boolean;
}) {
  const [newKey, setNewKey] = useState("");
  const entries = Object.entries(entriesMap);

  return (
    <EntriesWrapper empty={entries.length === 0}>
      <table className="conventions-table">
        <colgroup>
          <col style={{ width: "12em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "10em" }} />
          <col style={{ width: "12em" }} />
          <col />
          <col style={{ width: 28 }} />
        </colgroup>
        <thead>
          <tr>
            <th>key (@conv.externalOutcomeDefaults.xxx)</th>
            <th>outcome</th>
            <th>action</th>
            <th>retry</th>
            <th>description</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {entries.map(([key, entry]) => (
            <tr key={key}>
              <td><code className="conventions-key-badge">{key}</code></td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.outcome}
                  onChange={(e) => { onUpdate(key, { outcome: e.target.value as ExternalOutcomeEntry["outcome"] }); onCommit(); }}
                >
                  {OUTCOME_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.action}
                  onChange={(e) => { onUpdate(key, { action: e.target.value as ExternalOutcomeEntry["action"] }); onCommit(); }}
                >
                  {ACTION_OPTIONS.map((o) => <option key={o} value={o}>{o}</option>)}
                </select>
              </td>
              <td>
                <select
                  className="form-select form-select-sm"
                  value={entry.retry ?? ""}
                  onChange={(e) => {
                    onUpdate(key, { retry: (e.target.value || undefined) as ExternalOutcomeEntry["retry"] });
                    onCommit();
                  }}
                >
                  {RETRY_OPTIONS.map((o) => <option key={o} value={o}>{o || "(未指定)"}</option>)}
                </select>
              </td>
              <td>
                <input
                  className="form-control form-control-sm"
                  value={entry.description ?? ""}
                  onChange={(e) => onUpdate(key, { description: e.target.value || undefined })}
                  onBlur={onCommit}
                />
              </td>
              <td className="text-center"><DeleteBtn onClick={() => onRemove(key)} isReadonly={isReadonly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      <NewKeyRow
        placeholder="新規 key (例: failure)"
        value={newKey}
        setValue={setNewKey}
        onAdd={() => { const k = newKey.trim(); if (k && !entriesMap[k]) { onAdd(k); setNewKey(""); } }}
        disabled={!newKey.trim() || Object.hasOwn(entriesMap, newKey.trim())}
        isReadonly={isReadonly}
      />
    </EntriesWrapper>
  );
}
