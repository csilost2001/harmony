import { useState, useEffect, useCallback, useMemo, useRef, useId } from "react";
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
  getHostInfo,
  type WorkspaceEntry,
  type HostInfo,
  type WorkspaceInspectResult,
} from "../../store/workspaceStore";
import { DataList, type DataListColumn } from "../common/DataList";
import { FilterBar } from "../common/FilterBar";
import { SortBar } from "../common/SortBar";
import { ViewModeToggle, type ViewMode } from "../common/ViewModeToggle";
import { useListSelection } from "../../hooks/useListSelection";
import { useListKeyboard } from "../../hooks/useListKeyboard";
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

type InspectStatus = "idle" | "inspecting" | "ready" | "needsInit" | "notFound" | "invalid" | "error";

/**
 * host info から OS 別の絶対パス例を生成 (#858)。
 * placeholder と説明文の両方で使う。
 *
 * - WSL: `/home/<user>/projects/my-app` (Windows ファイルダイアログから到達不可、テキスト入力必須)
 * - Linux native: `/home/<user>/projects/my-app`
 * - macOS: `/Users/<user>/projects/my-app` (homeDir をそのまま使う)
 * - Windows: `C:\\Users\\<user>\\projects\\my-app`
 *
 * homeDir 末尾の trailing separator を保持しないよう注意。
 */
function buildOsAwareExamplePath(host: HostInfo | null): string {
  // host info 取得前のフォールバック
  if (!host) return "workspaces/my-app";
  const sep = host.platform === "win32" ? "\\" : "/";
  const home = host.homeDir.replace(/[\\/]+$/, "");
  return `${home}${sep}projects${sep}my-app`;
}

/** placeholder 用の短い例 (workspaces/ プレフィクスを必ず含むこと: #755 e2e regression 防止) */
function buildPlaceholder(host: HostInfo | null): string {
  const example = buildOsAwareExamplePath(host);
  return `${example} または workspaces/my-app`;
}

export function AddWorkspaceDialog({ onClose, onAdded }: AddWorkspaceDialogProps) {
  const [path, setPath] = useState("");
  const [status, setStatus] = useState<InspectStatus>("idle");
  const [inspectName, setInspectName] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [pickedFolderHint, setPickedFolderHint] = useState<string | null>(null);
  const [host, setHost] = useState<HostInfo | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const inflightSeqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 同一画面に複数 dialog が同時表示される将来拡張に備え、global ID 衝突を避けて useId で一意化
  const dropdownId = useId();

  // recent workspace 一覧 (store から取得、substring-match で suggest)
  const recentWorkspaces = getState().workspaces;

  // host info を取得 (失敗は黙って null のまま、placeholder はフォールバックを使う)
  useEffect(() => {
    let cancelled = false;
    getHostInfo()
      .then((info) => { if (!cancelled) setHost(info); })
      .catch(() => { /* 取得失敗 → null のまま */ });
    return () => { cancelled = true; };
  }, []);

  // debounced auto-inspect: 入力が落ち着いてから 400ms で自動 inspect
  // 競合した古い request の結果で UI を上書きしないよう seq でガード
  const runInspect = useCallback(async (target: string) => {
    const trimmed = target.trim();
    if (!trimmed) {
      setStatus("idle");
      setInspectName(null);
      setErrorMsg(null);
      return;
    }
    const seq = ++inflightSeqRef.current;
    setStatus("inspecting");
    setErrorMsg(null);
    setInspectName(null);
    try {
      const result: WorkspaceInspectResult = await inspectWorkspace(trimmed);
      if (seq !== inflightSeqRef.current) return; // 古い結果は破棄
      setStatus(result.status);
      setInspectName(result.name ?? null);
      if (result.status === "invalid" && result.reason) {
        setErrorMsg(result.reason);
      }
    } catch (e) {
      if (seq !== inflightSeqRef.current) return;
      setStatus("error");
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current !== null) {
      window.clearTimeout(debounceRef.current);
    }
    // path が変わった瞬間、進行中 inspect (旧 path 用) の遅延 response が
    // 新 path の UI を上書きしないよう seq を bump して旧結果を破棄する。
    // 空入力 / 非空入力切替 / 非空 → 非空切替 すべての race window をカバー。
    inflightSeqRef.current++;
    if (!path.trim()) {
      setStatus("idle");
      setInspectName(null);
      setErrorMsg(null);
      return;
    }
    debounceRef.current = window.setTimeout(() => {
      runInspect(path);
    }, 400);
    return () => {
      if (debounceRef.current !== null) {
        window.clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    };
  }, [path, runInspect]);

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

  // WSL2 + Windows ブラウザ環境では showDirectoryPicker が Linux パスに到達できず実質使えないので、
  // ヒント文と整合させてフォルダ参照ボタンを非表示にする (#858 / #919 Opus review nit)
  const hasPickerSupport = typeof window !== "undefined"
    && "showDirectoryPicker" in window
    && !host?.isWSL;
  const placeholder = buildPlaceholder(host);
  const exampleAbs = buildOsAwareExamplePath(host);

  // recent dropdown: 入力中の文字列で path / name を絞り込み
  const filteredRecents = useMemo(() => {
    const q = path.trim().toLowerCase();
    if (!q) return recentWorkspaces.slice(0, 5);
    return recentWorkspaces
      .filter((w) => w.path.toLowerCase().includes(q) || w.name.toLowerCase().includes(q))
      .slice(0, 5);
  }, [path, recentWorkspaces]);

  // dropdown 外クリックで閉じる
  useEffect(() => {
    if (!showRecent) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (inputRef.current && !inputRef.current.contains(target)) {
        // dropdown 内クリックは別途閉じる (handleSelectRecent)
        const dropdown = document.getElementById(dropdownId);
        if (!dropdown || !dropdown.contains(target)) {
          setShowRecent(false);
        }
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showRecent, dropdownId]);

  const handleSelectRecent = (entry: WorkspaceEntry) => {
    setPath(entry.path);
    setShowRecent(false);
    inputRef.current?.focus();
  };

  return (
    <div className="tbl-modal-overlay" onClick={onClose}>
      <div className="tbl-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: "520px" }}>
        <div className="tbl-modal-title">ワークスペースを追加</div>

        <label className="tbl-field">
          <span>フォルダの絶対パス</span>
          <div style={{ display: "flex", gap: "6px", position: "relative" }}>
            <input
              ref={inputRef}
              type="text"
              value={path}
              onChange={(e) => { setPath(e.target.value); setShowRecent(true); }}
              onFocus={() => setShowRecent(true)}
              onKeyDown={(e) => {
                // Escape: dropdown を閉じる (input は focus に残す)
                // Tab: dropdown を閉じてから次要素へ移動 (default 動作)
                if (e.key === "Escape") {
                  if (showRecent) {
                    e.stopPropagation();
                    setShowRecent(false);
                  }
                } else if (e.key === "Tab") {
                  setShowRecent(false);
                }
              }}
              placeholder={placeholder}
              autoFocus
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              style={{ flex: 1, fontFamily: "monospace" }}
              data-testid="workspace-path-input"
            />
            {hasPickerSupport && (
              <button
                type="button"
                className="tbl-btn tbl-btn-ghost"
                onClick={handlePickFolder}
                title="フォルダ名を確認 (絶対パスは別途入力)"
                tabIndex={-1}
              >
                <i className="bi bi-folder2-open" />
              </button>
            )}
            {showRecent && filteredRecents.length > 0 && (
              <ul
                id={dropdownId}
                role="listbox"
                aria-label="最近使ったワークスペース"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: hasPickerSupport ? "44px" : 0,
                  marginTop: "2px",
                  padding: 0,
                  listStyle: "none",
                  background: "var(--card-bg, #fff)",
                  border: "1px solid var(--border, #ccc)",
                  borderRadius: "4px",
                  boxShadow: "0 4px 12px rgba(0,0,0,0.15)",
                  maxHeight: "200px",
                  overflowY: "auto",
                  zIndex: 10,
                }}
              >
                {filteredRecents.map((w) => (
                  <li key={w.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onClick={() => handleSelectRecent(w)}
                      style={{
                        display: "block",
                        width: "100%",
                        textAlign: "left",
                        padding: "6px 10px",
                        background: "transparent",
                        border: "none",
                        cursor: "pointer",
                        fontFamily: "inherit",
                      }}
                    >
                      <div style={{ fontWeight: 500, fontSize: "0.85rem" }}>{w.name}</div>
                      <div style={{ fontFamily: "monospace", fontSize: "0.75rem", color: "var(--muted-text, #888)" }}>
                        {w.path}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </label>

        <p style={{ fontSize: "0.78rem", color: "var(--muted-text, #888)", margin: "0 0 6px" }}>
          推奨: 絶対パスで指定 (例: <code style={{ fontFamily: "monospace" }}>{exampleAbs}</code>)。
          リポジトリ直下の <code>workspaces/my-app</code> 形式の相対パスも使用できます。
        </p>

        {host?.isWSL && (
          <p style={{ fontSize: "0.78rem", color: "var(--muted-text, #888)", margin: "0 0 6px" }}>
            <i className="bi bi-info-circle" /> WSL2 環境を検出しました。Windows ブラウザの「フォルダ参照」では Linux パス
            (<code>/home/...</code>) に到達できないため、上の入力欄に手動で絶対パスを入力してください。
          </p>
        )}

        {hasPickerSupport && (
          <p style={{ fontSize: "0.78rem", color: "var(--muted-text, #888)", margin: "0 0 8px" }}>
            ※「フォルダ選択」ボタンはフォルダ名の確認のみ可能です (ブラウザ仕様で絶対パス取得不可)。
          </p>
        )}

        {pickedFolderHint && (
          <p style={{ fontSize: "0.82rem", color: "var(--muted-text, #888)", margin: "0 0 8px" }}>
            選択したフォルダ名: <strong>{pickedFolderHint}</strong> — このフォルダの<em>絶対パス</em>を上の入力欄に入力してください。
          </p>
        )}

        {/* インライン状態表示 (debounced auto-inspect の結果) */}
        {status === "inspecting" && (
          <div
            data-testid="workspace-status"
            data-status="inspecting"
            style={{ padding: "6px 10px", color: "var(--muted-text, #888)", fontSize: "0.85rem" }}
          >
            <i className="bi bi-hourglass-split" /> 確認中...
          </div>
        )}

        {status === "ready" && (
          <div
            data-testid="workspace-status"
            data-status="ready"
            style={{ padding: "8px 12px", background: "var(--success-bg, #d4edda)", borderRadius: "4px", marginBottom: "12px", color: "var(--success-text, #155724)" }}
          >
            <i className="bi bi-check-circle" /> ワークスペースが見つかりました
            {inspectName && <> — <strong>{inspectName}</strong></>}
          </div>
        )}

        {status === "needsInit" && (
          <div
            data-testid="workspace-status"
            data-status="needsInit"
            style={{ padding: "8px 12px", background: "var(--warning-bg, #fff3cd)", borderRadius: "4px", marginBottom: "12px", color: "var(--warning-text, #856404)" }}
          >
            <i className="bi bi-exclamation-triangle" /> フォルダは空です。初期化してワークスペースを作成しますか？
          </div>
        )}

        {status === "notFound" && (
          <div
            data-testid="workspace-status"
            data-status="notFound"
            style={{ padding: "8px 12px", background: "var(--danger-bg, #f8d7da)", borderRadius: "4px", marginBottom: "12px", color: "var(--danger-text, #721c24)" }}
          >
            <i className="bi bi-x-circle" /> フォルダが見つかりません。パスを確認するか、このパスに新規作成できます。
          </div>
        )}

        {status === "invalid" && (
          <div
            data-testid="workspace-status"
            data-status="invalid"
            style={{ padding: "8px 12px", background: "var(--danger-bg, #f8d7da)", borderRadius: "4px", marginBottom: "12px", color: "var(--danger-text, #721c24)" }}
          >
            <i className="bi bi-exclamation-circle" /> harmony.json が不正です。ファイルを修正するか、初期化し直してください。
            {errorMsg && <div style={{ fontSize: "0.8rem", marginTop: "4px", opacity: 0.8 }}>{errorMsg}</div>}
          </div>
        )}

        {status === "error" && (
          <div
            data-testid="workspace-status"
            data-status="error"
            style={{ padding: "8px 12px", background: "var(--danger-bg, #f8d7da)", borderRadius: "4px", marginBottom: "12px", color: "var(--danger-text, #721c24)" }}
          >
            <i className="bi bi-x-circle" /> エラー: {errorMsg}
          </div>
        )}

        {/* アクションボタン:
            - debounced auto-inspect が走るため通常は「確認」を押す必要はないが、
              即時再検証したい場合のために secondary 「確認」ボタンを常設する (#858 + #755 e2e regression 防止)
            - status に応じて primary アクション (開く / 初期化 / 作成) を出す */}
        <div className="tbl-modal-btns">
          <button className="tbl-btn tbl-btn-ghost" onClick={onClose}>キャンセル</button>

          <button
            className="tbl-btn tbl-btn-ghost"
            onClick={() => runInspect(path)}
            disabled={!path.trim() || status === "inspecting"}
            title="入力したパスの状態を即時確認します (通常は自動で実行)"
          >
            <i className="bi bi-search" /> 確認
          </button>

          {status === "ready" && (
            <button className="tbl-btn tbl-btn-primary" onClick={handleOpen} disabled={processing}>
              {processing ? "開いています..." : "開く"}
            </button>
          )}

          {status === "needsInit" && (
            <button className="tbl-btn tbl-btn-primary" onClick={handleInit} disabled={processing}>
              {processing ? "初期化中..." : "初期化して開く"}
            </button>
          )}

          {status === "notFound" && (
            <button
              className="tbl-btn tbl-btn-primary"
              onClick={handleInit}
              disabled={processing || !path.trim()}
              title="このパスにフォルダを作成し、harmony.json を初期化します"
            >
              {processing ? "作成中..." : "フォルダを作成して初期化"}
            </button>
          )}
        </div>

        {errorMsg && status !== "error" && status !== "notFound" && status !== "invalid" && (
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

  useListKeyboard({
    items: sort.sorted,
    getId: (w) => w.id,
    selection,
    sort,
    layout: viewMode === "card" ? "grid" : "list",
    onActivate: handleActivate,
    enabled: !lockdown,
  });

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
