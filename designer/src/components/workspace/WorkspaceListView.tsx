import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { mcpBridge } from "../../mcp/mcpBridge";
import {
  getState,
  subscribe as subscribeStore,
  loadWorkspaces,
  openWorkspace,
  inspectWorkspace,
  initAndOpen,
  removeWorkspace,
  type WorkspaceEntry,
} from "../../store/workspaceStore";
import { DataList, type DataListColumn } from "../common/DataList";
import { FilterBar } from "../common/FilterBar";
import { SortBar } from "../common/SortBar";
import { ViewModeToggle, type ViewMode } from "../common/ViewModeToggle";
import { useListSelection } from "../../hooks/useListSelection";
import { useListFilter } from "../../hooks/useListFilter";
import { useListSort } from "../../hooks/useListSort";
import { usePersistentState } from "../../hooks/usePersistentState";
import "../../styles/table.css";

const STORAGE_KEY = "list-view-mode:workspace-list";

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

// ─── 追加ダイアログ ───────────────────────────────────────────────────────────

interface AddWorkspaceDialogProps {
  onClose: () => void;
  onAdded: () => void;
}

export function AddWorkspaceDialog({ onClose, onAdded }: AddWorkspaceDialogProps) {
  const [path, setPath] = useState("");
  const [status, setStatus] = useState<"idle" | "inspecting" | "ready" | "needsInit" | "notFound" | "error">("idle");
  const [inspectName, setInspectName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [pickedFolderHint, setPickedFolderHint] = useState<string | null>(null);

  // デフォルトの新規作成推奨パス (サーバ側 workspaces/ ディレクトリ) をヒントとして表示するだけ。
  // ブラウザの file picker では絶対パスを取得できないため、ここではプレースホルダ文字列のみ使用。
  // 推奨パスは workspaces/<新規 wsId>/ (例: workspaces/my-project)
  const defaultPathHint = "workspaces/my-project";

  const handleInspect = async () => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setStatus("inspecting");
    setErrorMsg(null);
    setInspectName(null);
    try {
      const result = await inspectWorkspace(trimmed);
      setStatus(result.status);
      setInspectName(result.name ?? null);
    } catch (e) {
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  };

  const handleOpen = async () => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setProcessing(true);
    setErrorMsg(null);
    try {
      await openWorkspace(trimmed, false);
      onAdded();
      onClose();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  };

  const handleInit = async () => {
    const trimmed = path.trim();
    if (!trimmed) return;
    setProcessing(true);
    setErrorMsg(null);
    try {
      await initAndOpen(trimmed);
      onAdded();
      onClose();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setProcessing(false);
    }
  };

  const handlePickFolder = async () => {
    if (!("showDirectoryPicker" in window)) return;
    try {
      const handle = await (window as Window & { showDirectoryPicker: () => Promise<{ name: string }> }).showDirectoryPicker();
      // showDirectoryPicker は絶対パスを返さない (フォルダ名 .name のみ)。
      // 入力欄に書き込むと相対パスとして MCP server cwd 配下と誤解釈されるため、
      // 入力欄には触れず、フォルダ名だけを「選択ヒント」として表示する。
      setPickedFolderHint(handle.name);
      setErrorMsg(null);
    } catch (e) {
      if ((e as { name?: string }).name !== "AbortError") {
        setErrorMsg("フォルダ選択に失敗しました");
      }
    }
  };

  const hasPickerSupport = "showDirectoryPicker" in window;

  return (
    <div className="tbl-modal-overlay" onClick={onClose}>
      <div className="tbl-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "480px" }}>
        <div className="tbl-modal-title">ワークスペースを追加</div>

        <label className="tbl-field">
          <span>フォルダのパス</span>
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              type="text"
              value={path}
              onChange={(e) => { setPath(e.target.value); setStatus("idle"); setInspectName(null); setErrorMsg(null); }}
              placeholder={`workspaces/my-project (例: C:\\repos\\my-app\\${defaultPathHint})`}
              autoFocus
              style={{ flex: 1 }}
              onKeyDown={(e) => { if (e.key === "Enter") handleInspect(); }}
            />
            {hasPickerSupport && (
              <button className="tbl-btn tbl-btn-ghost" onClick={handlePickFolder} title="フォルダ名を確認 (絶対パスは別途入力)">
                <i className="bi bi-folder2-open" />
              </button>
            )}
          </div>
        </label>

        <p style={{ fontSize: "0.78rem", color: "var(--muted-text, #888)", margin: "0 0 8px" }}>
          推奨: リポジトリ直下の <code>workspaces/</code> フォルダに新規作成してください (例: <code>workspaces/{defaultPathHint.split("/")[1]}</code>)。
          任意の絶対パスも使用できます。
        </p>

        {hasPickerSupport && (
          <p style={{ fontSize: "0.78rem", color: "var(--muted-text, #888)", margin: "0 0 8px" }}>
            ※「フォルダ選択」はフォルダ名の確認のみ可能です (ブラウザ仕様で絶対パス取得不可)。上の入力欄には絶対パスを必ず手動入力してください。
          </p>
        )}

        {pickedFolderHint && (
          <p style={{ fontSize: "0.82rem", color: "var(--muted-text, #888)", margin: "0 0 8px" }}>
            選択したフォルダ名: <strong>{pickedFolderHint}</strong> — このフォルダの<em>絶対パス</em>を上の入力欄に入力してください。
          </p>
        )}

        {status === "idle" && (
          <div className="tbl-modal-btns">
            <button className="tbl-btn tbl-btn-ghost" onClick={onClose}>キャンセル</button>
            <button
              className="tbl-btn tbl-btn-primary"
              onClick={handleInspect}
              disabled={!path.trim()}
            >
              <i className="bi bi-search" /> 確認
            </button>
          </div>
        )}

        {status === "inspecting" && (
          <p style={{ color: "var(--muted-text, #888)" }}>確認中...</p>
        )}

        {status === "ready" && (
          <>
            <div style={{ padding: "8px 12px", background: "var(--success-bg, #d4edda)", borderRadius: "4px", marginBottom: "12px", color: "var(--success-text, #155724)" }}>
              <i className="bi bi-check-circle" /> ワークスペースが見つかりました
              {inspectName && <> — <strong>{inspectName}</strong></>}
            </div>
            <div className="tbl-modal-btns">
              <button className="tbl-btn tbl-btn-ghost" onClick={onClose}>キャンセル</button>
              <button className="tbl-btn tbl-btn-primary" onClick={handleOpen} disabled={processing}>
                {processing ? "開いています..." : "開く"}
              </button>
            </div>
          </>
        )}

        {status === "needsInit" && (
          <>
            <div style={{ padding: "8px 12px", background: "var(--warning-bg, #fff3cd)", borderRadius: "4px", marginBottom: "12px", color: "var(--warning-text, #856404)" }}>
              <i className="bi bi-exclamation-triangle" /> フォルダは空です。初期化してワークスペースを作成しますか？
            </div>
            <div className="tbl-modal-btns">
              <button className="tbl-btn tbl-btn-ghost" onClick={onClose}>キャンセル</button>
              <button className="tbl-btn tbl-btn-primary" onClick={handleInit} disabled={processing}>
                {processing ? "初期化中..." : "初期化して開く"}
              </button>
            </div>
          </>
        )}

        {status === "notFound" && (
          <>
            <div style={{ padding: "8px 12px", background: "var(--danger-bg, #f8d7da)", borderRadius: "4px", marginBottom: "12px", color: "var(--danger-text, #721c24)" }}>
              <i className="bi bi-x-circle" /> フォルダが見つかりません。パスを確認するか、このパスに新規作成できます。
            </div>
            <div className="tbl-modal-btns">
              <button className="tbl-btn tbl-btn-ghost" onClick={onClose}>キャンセル</button>
              <button
                className="tbl-btn tbl-btn-ghost"
                onClick={handleInspect}
                disabled={!path.trim()}
              >
                <i className="bi bi-arrow-clockwise" /> 再確認
              </button>
              <button
                className="tbl-btn tbl-btn-primary"
                onClick={handleInit}
                disabled={processing || !path.trim()}
                title="このパスにフォルダを作成し、project.json を初期化します"
              >
                {processing ? "作成中..." : "フォルダを作成して初期化"}
              </button>
            </div>
          </>
        )}

        {status === "error" && (
          <>
            <div style={{ padding: "8px 12px", background: "var(--danger-bg, #f8d7da)", borderRadius: "4px", marginBottom: "12px", color: "var(--danger-text, #721c24)" }}>
              <i className="bi bi-x-circle" /> エラー: {errorMsg}
            </div>
            <div className="tbl-modal-btns">
              <button className="tbl-btn tbl-btn-ghost" onClick={onClose}>閉じる</button>
              <button
                className="tbl-btn tbl-btn-primary"
                onClick={handleInspect}
                disabled={!path.trim()}
              >
                <i className="bi bi-arrow-clockwise" /> 再試行
              </button>
            </div>
          </>
        )}

        {errorMsg && status !== "error" && status !== "notFound" && (
          <div style={{ color: "var(--danger-text, #721c24)", fontSize: "0.85rem", marginTop: "8px" }}>
            {errorMsg}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── WorkspaceListView ────────────────────────────────────────────────────────

export function WorkspaceListView() {
  const navigate = useNavigate();
  const [storeState, setStoreState] = useState(getState());
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(STORAGE_KEY, "card");
  const [query, setQuery] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [removeConfirmId, setRemoveConfirmId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    return subscribeStore(() => setStoreState(getState()));
  }, []);

  useEffect(() => {
    // onStatusChange は登録時に現在ステータスで即時発火する (mcpBridge.ts の仕様)。
    // 「既接続」状態での即時発火時に loadWorkspaces() を呼ぶと、AppShell が既に実施した
    // load と 2 重になり loading=true → AppShell スプラッシュ → アンマウント → 再マウント
    // → 再び即時発火 という無限ループを引き起こす (WorkspaceSelectView と同パターン、PR #813 ホットフィックス)。
    //
    // 対策: 初回即時発火 (prevStatus=null) で AppShell の load 完了済 (workspaces 取得済) の場合は skip。
    // 再接続 (disconnected → connected) は常に reload。
    let prevStatus: string | null = null;
    const unsubStatus = mcpBridge.onStatusChange((s) => {
      const isReconnect = prevStatus !== null && prevStatus !== "connected" && s === "connected";
      prevStatus = s;
      if (s !== "connected") return;
      if (!isReconnect) {
        const { loading, workspaces } = getState();
        // AppShell が load 完了済 (loading=false かつ workspaces 取得済) なら skip して 2 重 load を防ぐ
        if (!loading && workspaces.length > 0) return;
      }
      loadWorkspaces().catch(console.error);
    });
    return () => { unsubStatus(); };
  }, []);

  const { workspaces, active, lockdown } = storeState;

  const sortAccessor = useCallback((w: WorkspaceEntry, key: string): string | number => {
    switch (key) {
      case "name": return w.name;
      case "lastOpenedAt": return w.lastOpenedAt ?? "";
      default: return "";
    }
  }, []);

  const filter = useListFilter(workspaces);
  useEffect(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      filter.applyFilter(null);
      return;
    }
    filter.applyFilter((w) =>
      w.name.toLowerCase().includes(q) ||
      w.path.toLowerCase().includes(q),
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const sort = useListSort(filter.filtered, sortAccessor);
  const selection = useListSelection(sort.sorted, (w) => w.id);

  const columnLabels = useMemo<Record<string, string>>(() => ({
    name: "名前",
    lastOpenedAt: "最終オープン",
  }), []);

  const columns = useMemo<DataListColumn<WorkspaceEntry>[]>(() => [
    {
      key: "name",
      header: "名前",
      sortable: true,
      sortAccessor: (w) => w.name,
      render: (w) => (
        <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
          <i className="bi bi-folder2" style={{ color: "var(--accent, #4dabf7)" }} />
          <span style={{ fontWeight: active?.path === w.path ? 600 : undefined }}>{w.name}</span>
          {active?.path === w.path && (
            <span style={{
              fontSize: "0.7rem",
              background: "var(--accent, #4dabf7)",
              color: "#fff",
              borderRadius: "3px",
              padding: "1px 5px",
            }}>
              アクティブ
            </span>
          )}
        </div>
      ),
    },
    {
      key: "path",
      header: "パス",
      render: (w) => (
        <span
          title={w.path}
          style={{
            fontFamily: "monospace",
            fontSize: "0.82rem",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            display: "block",
            maxWidth: "300px",
            color: "var(--muted-text, #888)",
          }}
        >
          {w.path}
        </span>
      ),
    },
    {
      key: "lastOpenedAt",
      header: "最終オープン",
      width: "160px",
      sortable: true,
      sortAccessor: (w) => w.lastOpenedAt ?? "",
      render: (w) => (
        <span style={{ fontSize: "0.82rem", color: "var(--muted-text, #888)" }}>
          {formatDate(w.lastOpenedAt)}
        </span>
      ),
    },
  ], [active]);

  const renderCard = (w: WorkspaceEntry) => (
    <div className="seq-card-content">
      <div className="seq-card-header">
        <i className="bi bi-folder2" style={{ color: "var(--accent, #4dabf7)", marginRight: "6px" }} />
        <span className="seq-card-name">{w.name}</span>
        {active?.path === w.path && (
          <span style={{
            fontSize: "0.7rem",
            background: "var(--accent, #4dabf7)",
            color: "#fff",
            borderRadius: "3px",
            padding: "1px 5px",
            marginLeft: "6px",
          }}>
            アクティブ
          </span>
        )}
      </div>
      <div className="seq-card-description" title={w.path} style={{ fontFamily: "monospace", fontSize: "0.8rem", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {w.path}
      </div>
      <div className="seq-card-meta">
        <span className="seq-card-date">{formatDate(w.lastOpenedAt)}</span>
      </div>
    </div>
  );

  const handleOpen = async () => {
    const sel = selection.selectedItems;
    if (sel.length !== 1) return;
    setActionError(null);
    try {
      await openWorkspace(sel[0].id, true);
      navigate("/", { replace: true });
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRemoveConfirmed = async () => {
    if (!removeConfirmId) return;
    setActionError(null);
    try {
      await removeWorkspace(removeConfirmId);
      setRemoveConfirmId(null);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
      setRemoveConfirmId(null);
    }
  };

  const handleActivate = useCallback((w: WorkspaceEntry) => {
    if (lockdown) return;
    setActionError(null);
    openWorkspace(w.id, true)
      .then(() => navigate("/", { replace: true }))
      .catch((e) => {
        setActionError(e instanceof Error ? e.message : String(e));
      });
  }, [lockdown, navigate]);

  const selectedCount = selection.selectedIds.size;
  const selectedItem = selection.selectedItems[0] ?? null;

  return (
    <div className="table-list-page">
      <div className="table-list-content">
        {/* Lockdown banner */}
        {lockdown && (
          <div style={{
            padding: "8px 16px",
            background: "var(--warning-bg, #fff3cd)",
            color: "var(--warning-text, #856404)",
            borderRadius: "4px",
            marginBottom: "12px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
          }}>
            <i className="bi bi-lock-fill" />
            環境変数 DESIGNER_DATA_DIR で固定中のため、ワークスペース切替はできません
          </div>
        )}

        <div className="table-list-header">
          <h2 className="table-list-title">
            <i className="bi bi-folder2-open" /> ワークスペース
            <span className="table-list-count">{workspaces.length} 件</span>
          </h2>
          <div className="table-list-actions">
            <div className="table-list-search">
              <i className="bi bi-search" />
              <input
                type="text"
                placeholder="名前・パスで絞り込み..."
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button className="clear-btn" onClick={() => setQuery("")} title="クリア">
                  <i className="bi bi-x-circle-fill" />
                </button>
              )}
            </div>
            <ViewModeToggle mode={viewMode} onChange={setViewMode} storageKey={STORAGE_KEY} />
            <button
              className="tbl-btn tbl-btn-primary"
              onClick={() => setShowAdd(true)}
              disabled={lockdown}
              title={lockdown ? "lockdown 中は無効" : undefined}
            >
              <i className="bi bi-plus-lg" /> 追加
            </button>
            <button
              className="tbl-btn tbl-btn-ghost"
              onClick={handleOpen}
              disabled={lockdown || selectedCount !== 1}
              title={lockdown ? "lockdown 中は無効" : selectedCount !== 1 ? "1件選択してください" : "開く"}
            >
              <i className="bi bi-folder2-open" /> 開く
            </button>
            <button
              className="tbl-btn tbl-btn-ghost danger"
              onClick={() => { if (selectedItem) setRemoveConfirmId(selectedItem.id); }}
              disabled={lockdown || selectedCount !== 1}
              title={lockdown ? "lockdown 中は無効" : selectedCount !== 1 ? "1件選択してください" : "リストから外す"}
            >
              <i className="bi bi-x-lg" /> リストから外す
            </button>
          </div>
        </div>

        {actionError && (
          <div style={{
            padding: "6px 12px",
            background: "var(--danger-bg, #f8d7da)",
            color: "var(--danger-text, #721c24)",
            borderRadius: "4px",
            marginBottom: "8px",
            fontSize: "0.85rem",
          }}>
            <i className="bi bi-exclamation-circle" /> {actionError}
          </div>
        )}

        <FilterBar
          isActive={filter.isActive}
          totalCount={filter.totalCount}
          visibleCount={filter.visibleCount}
          label={query ? `検索: "${query}"` : undefined}
          onClear={() => { setQuery(""); filter.clearFilter(); }}
        />

        <SortBar sort={sort} columnLabels={columnLabels} />

        {workspaces.length === 0 && !storeState.loading ? (
          <div style={{ textAlign: "center", padding: "60px 20px", color: "var(--muted-text, #888)" }}>
            <i className="bi bi-folder2-open" style={{ fontSize: "3rem", display: "block", marginBottom: "16px" }} />
            <p style={{ marginBottom: "16px" }}>ワークスペースがまだありません。</p>
            {!lockdown && (
              <button className="tbl-btn tbl-btn-primary" onClick={() => setShowAdd(true)}>
                <i className="bi bi-plus-lg" /> ワークスペースを追加
              </button>
            )}
          </div>
        ) : (
          <DataList
            items={sort.sorted}
            columns={columns}
            getId={(w) => w.id}
            selection={selection}
            onActivate={handleActivate}
            layout={viewMode === "card" ? "grid" : "list"}
            renderCard={renderCard}
            showNumColumn={viewMode === "table"}
            variant="dark"
            className="sequences-data-list"
            emptyMessage={
              query
                ? <p>該当するワークスペースがありません</p>
                : <p>ワークスペースがまだありません</p>
            }
          />
        )}

        {/* 追加ダイアログ */}
        {showAdd && (
          <AddWorkspaceDialog
            onClose={() => setShowAdd(false)}
            onAdded={() => { loadWorkspaces().catch(console.error); }}
          />
        )}

        {/* リストから外す確認ダイアログ */}
        {removeConfirmId && (
          <div className="tbl-modal-overlay" onClick={() => setRemoveConfirmId(null)}>
            <div className="tbl-modal" onClick={(e) => e.stopPropagation()}>
              <div className="tbl-modal-title">ワークスペースをリストから外す</div>
              <p>
                「{workspaces.find((w) => w.id === removeConfirmId)?.name}」をリストから外しますか？
                <br />
                <small style={{ color: "var(--muted-text, #888)" }}>フォルダは削除されません。後から追加し直せます。</small>
              </p>
              <div className="tbl-modal-btns">
                <button className="tbl-btn tbl-btn-ghost" onClick={() => setRemoveConfirmId(null)}>
                  キャンセル
                </button>
                <button className="tbl-btn tbl-btn-ghost danger" onClick={handleRemoveConfirmed}>
                  リストから外す
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
