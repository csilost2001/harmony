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
  listWorkspaceRoots,
  addWorkspaceRoot,
  removeWorkspaceRoot,
  discoverWorkspaceCandidates,
  type WorkspaceEntry,
  type WorkspaceRootEntry,
  type WorkspaceCandidate,
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
import { BackendFolderPicker } from "./BackendFolderPicker";
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
  initialPath?: string;
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
  if (!host) return "/path/to/projects/my-app/harmony-design";
  const sep = host.platform === "win32" ? "\\" : "/";
  const home = host.homeDir.replace(/[\\/]+$/, "");
  return `${home}${sep}projects${sep}my-app${sep}harmony-design`;
}

function buildPlaceholder(host: HostInfo | null): string {
  return buildOsAwareExamplePath(host);
}

function buildWorkspaceRootExamplePath(host: HostInfo | null): string {
  if (!host) return "/path/to/projects";
  const sep = host.platform === "win32" ? "\\" : "/";
  const home = host.homeDir.replace(/[\\/]+$/, "");
  return `${home}${sep}projects`;
}

export function AddWorkspaceDialog({ onClose, onAdded, initialPath = "" }: AddWorkspaceDialogProps) {
  const [path, setPath] = useState(initialPath);
  // status / inspectName / errorMsg は path が空のとき "idle" / null 扱いを render 中 derive で
  // 強制し、effect 内同期 setState を回避する (react-hooks/set-state-in-effect #1385)。
  // runInspect / handler は path 非空のときのみ意味のある値をセットするため、空時の clear は
  // derive (`trimmedPath ? state : "idle"`) で表現できる。
  const [statusState, setStatus] = useState<InspectStatus>("idle");
  const [inspectNameState, setInspectName] = useState<string | null>(null);
  const [errorMsgState, setErrorMsg] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [host, setHost] = useState<HostInfo | null>(null);
  const [showRecent, setShowRecent] = useState(false);
  const [showFolderPicker, setShowFolderPicker] = useState(false);
  const debounceRef = useRef<number | null>(null);
  const inflightSeqRef = useRef(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // 同一画面に複数 dialog が同時表示される将来拡張に備え、global ID 衝突を避けて useId で一意化
  const dropdownId = useId();

  // path 空時は status を強制 idle にする render-derive (effect 内同期 setState 回避)
  const trimmedPath = path.trim();
  const status: InspectStatus = trimmedPath ? statusState : "idle";
  const inspectName: string | null = trimmedPath ? inspectNameState : null;
  const errorMsg: string | null = trimmedPath ? errorMsgState : null;

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
    // path 空時の "idle" 強制表示は render-derive (status / inspectName / errorMsg) で行う
    // ため、effect 内の同期 setState は不要 (react-hooks/set-state-in-effect #1385)。
    if (!path.trim()) {
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

  // 旧 `showDirectoryPicker` 経路 (#858 / #919) は #1056 で廃止。Browser File System Access API
  // は handle のみ返却で絶対パスを取れず、WSL2 / container / リモート開発のいずれでも実用にならない。
  // 代わりに backend filesystem を browseFs MCP tool 経由でブラウズする BackendFolderPicker
  // を採用 (`docs/spec/path-conventions.md §8`)。
  const handlePickedFolder = (absolutePath: string) => {
    setPath(absolutePath);
    setShowFolderPicker(false);
    setErrorMsg(null);
    // 入力欄に値が入った瞬間に既存の debounced auto-inspect が走るので明示再 inspect は不要
  };

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
        <div className="tbl-modal-title">プロジェクトを開く / 作成</div>

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
            <button
              type="button"
              className="tbl-btn tbl-btn-ghost"
              onClick={() => setShowFolderPicker(true)}
              title="backend のフォルダをブラウズして選択 (#1056)"
              data-testid="open-folder-picker"
            >
              <i className="bi bi-folder2-open" /> 参照
            </button>
            {showRecent && filteredRecents.length > 0 && (
              <ul
                id={dropdownId}
                role="listbox"
                aria-label="最近使ったワークスペース"
                style={{
                  position: "absolute",
                  top: "100%",
                  left: 0,
                  right: "80px",
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
          推奨: Harmony 本体 repo の外にある project フォルダを絶対パスで指定
          (例: <code style={{ fontFamily: "monospace" }}>{exampleAbs}</code>)。
          既存互換として相対パスも使用できます。
        </p>

        <p style={{ fontSize: "0.78rem", color: "var(--muted-text, #888)", margin: "0 0 8px" }}>
          ※「参照」は backend (Harmony サーバ) 側のファイルシステムをブラウズします。
          ブラウザ実行マシンの fs ではない点に注意してください。
        </p>

        {showFolderPicker && (
          <BackendFolderPicker
            initialPath={path.trim() || undefined}
            onSelect={handlePickedFolder}
            onClose={() => setShowFolderPicker(false)}
          />
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
              {processing ? "作成中..." : "作成して開く"}
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

type WorkspaceRootPanelProps = {
  lockdown: boolean;
  onOpenProject: (path: string) => void;
};

function WorkspaceRootPanel({ lockdown, onOpenProject }: WorkspaceRootPanelProps) {
  const [roots, setRoots] = useState<WorkspaceRootEntry[]>([]);
  const [rootPath, setRootPath] = useState("");
  const [host, setHost] = useState<HostInfo | null>(null);
  const [candidatesByRoot, setCandidatesByRoot] = useState<Record<string, WorkspaceCandidate[]>>({});
  const [loadingRootId, setLoadingRootId] = useState<string | null>(null);
  const [showRootPicker, setShowRootPicker] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadRoots = useCallback(async () => {
    if (lockdown) {
      setRoots([]);
      return;
    }
    try {
      setRoots(await listWorkspaceRoots());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [lockdown]);

  useEffect(() => {
    if (lockdown) return;
    let cancelled = false;
    void (async () => {
      try {
        const [rootEntries, hostInfo] = await Promise.all([
          listWorkspaceRoots(),
          getHostInfo().catch(() => null),
        ]);
        if (cancelled) return;
        setRoots(rootEntries);
        setHost(hostInfo);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { cancelled = true; };
  }, [lockdown]);

  const handleAddRoot = async () => {
    const trimmed = rootPath.trim();
    if (!trimmed) return;
    setError(null);
    try {
      const root = await addWorkspaceRoot(trimmed);
      setRootPath("");
      await loadRoots();
      await handleDiscover(root.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleRemoveRoot = async (id: string) => {
    setError(null);
    try {
      await removeWorkspaceRoot(id);
      setCandidatesByRoot((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      await loadRoots();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleDiscover = async (rootId: string) => {
    if (lockdown) return;
    setError(null);
    setLoadingRootId(rootId);
    try {
      const result = await discoverWorkspaceCandidates({ rootId, maxDepth: 2, limit: 100 });
      setCandidatesByRoot((prev) => ({ ...prev, [rootId]: result.candidates }));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingRootId(null);
    }
  };

  const rootPlaceholder = buildWorkspaceRootExamplePath(host);

  return (
    <section
      style={{
        border: "1px solid var(--border, #334)",
        borderRadius: "6px",
        padding: "12px",
        marginBottom: "14px",
        background: "var(--panel-bg, rgba(255,255,255,0.02))",
      }}
      aria-label="workspace roots"
    >
      <div style={{ display: "flex", justifyContent: "space-between", gap: "12px", alignItems: "center", marginBottom: "10px" }}>
        <div>
          <div style={{ fontWeight: 700 }}>プロジェクト探索ルート</div>
          <div style={{ fontSize: "0.82rem", color: "var(--muted-text, #888)" }}>
            候補表示の基点です。候補は自動 import されず、明示的に開いたものだけ recent に入ります。
          </div>
        </div>
      </div>

      {error && (
        <div style={{ color: "var(--danger-text, #f88)", fontSize: "0.85rem", marginBottom: "8px" }}>
          <i className="bi bi-exclamation-circle" /> {error}
        </div>
      )}

      {!lockdown && (
        <div style={{ display: "flex", gap: "6px", marginBottom: "10px" }}>
          <input
            type="text"
            value={rootPath}
            onChange={(e) => setRootPath(e.target.value)}
            placeholder={rootPlaceholder}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            style={{ flex: 1, fontFamily: "monospace" }}
            data-testid="workspace-root-path-input"
          />
          <button
            type="button"
            className="tbl-btn tbl-btn-ghost"
            onClick={() => setShowRootPicker(true)}
            title="backend のフォルダをブラウズして探索ルートを選択"
          >
            <i className="bi bi-folder2-open" /> 参照
          </button>
          <button
            type="button"
            className="tbl-btn tbl-btn-primary"
            onClick={handleAddRoot}
            disabled={!rootPath.trim()}
          >
            <i className="bi bi-plus-lg" /> ルート追加
          </button>
        </div>
      )}

      {showRootPicker && (
        <BackendFolderPicker
          initialPath={rootPath.trim() || undefined}
          onSelect={(absolutePath) => {
            setRootPath(absolutePath);
            setShowRootPicker(false);
          }}
          onClose={() => setShowRootPicker(false)}
        />
      )}

      {roots.length === 0 ? (
        <div style={{ fontSize: "0.85rem", color: "var(--muted-text, #888)" }}>
          探索ルートは未登録です。root 外の project も「プロジェクトを開く」から直接開けます。
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {roots.map((root) => {
            const candidates = candidatesByRoot[root.id] ?? [];
            return (
              <div key={root.id} style={{ borderTop: "1px solid var(--border-faint, #2a2d3a)", paddingTop: "8px" }}>
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                  <i className="bi bi-folder2" style={{ color: "var(--accent, #4dabf7)" }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{root.label}</div>
                    <div title={root.path} style={{ fontFamily: "monospace", fontSize: "0.78rem", color: "var(--muted-text, #888)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {root.path}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="tbl-btn tbl-btn-ghost"
                    onClick={() => handleDiscover(root.id)}
                    disabled={loadingRootId === root.id}
                  >
                    <i className="bi bi-search" /> {loadingRootId === root.id ? "探索中..." : "候補を表示"}
                  </button>
                  {!lockdown && (
                    <button
                      type="button"
                      className="tbl-btn tbl-btn-ghost danger"
                      onClick={() => handleRemoveRoot(root.id)}
                      title="探索ルート登録だけを外します。project は削除しません。"
                    >
                      <i className="bi bi-x-lg" />
                    </button>
                  )}
                </div>

                {candidates.length > 0 && (
                  <div style={{ marginTop: "6px", display: "flex", flexDirection: "column", gap: "4px" }}>
                    {candidates.map((candidate) => (
                      <div
                        key={candidate.path}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: "8px",
                          padding: "6px 8px",
                          border: "1px solid var(--border-faint, #2a2d3a)",
                          borderRadius: "4px",
                          background: candidate.status === "ready" ? "transparent" : "var(--danger-bg, rgba(248,113,113,0.12))",
                        }}
                      >
                        <i className={candidate.status === "ready" ? "bi bi-folder-check" : "bi bi-exclamation-triangle"} />
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontSize: "0.85rem", fontWeight: 600 }}>
                            {candidate.name ?? "不正な Harmony project"}
                            {candidate.alreadyRecent && (
                              <span style={{ marginLeft: "6px", fontSize: "0.72rem", color: "var(--muted-text, #888)" }}>
                                recent 登録済み
                              </span>
                            )}
                          </div>
                          <div title={candidate.path} style={{ fontFamily: "monospace", fontSize: "0.76rem", color: "var(--muted-text, #888)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                            {candidate.path}
                          </div>
                          {candidate.reason && (
                            <div style={{ fontSize: "0.75rem", color: "var(--danger-text, #f88)" }}>{candidate.reason}</div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="tbl-btn tbl-btn-ghost"
                          onClick={() => onOpenProject(candidate.path)}
                          disabled={candidate.status !== "ready" || lockdown}
                        >
                          開く
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
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
    // 対策: 初回即時発火 (prevStatus=null) で AppShell の load 完了済 (loading=false) なら skip。
    // 再接続 (disconnected → connected) は常に reload。
    //
    // 注: 以前は `loading=false && workspaces.length > 0` で skip 判定していたが、
    // recent-workspaces.json が存在しない初回起動など workspaces が空の正常完了状態でも
    // skip が外れて loadWorkspaces → loading=true → splash → unmount/remount → 即時発火 …
    // の無限ループに陥る regression があった (#1490aec の取り残し)。loading だけで判定する。
    let prevStatus: string | null = null;
    const unsubStatus = mcpBridge.onStatusChange((s) => {
      const isReconnect = prevStatus !== null && prevStatus !== "connected" && s === "connected";
      prevStatus = s;
      if (s !== "connected") return;
      if (!isReconnect) {
        const { loading } = getState();
        if (!loading) return;
      }
      loadWorkspaces().catch(console.error);
    });
    return () => { unsubStatus(); };
  }, []);

  const { workspaces, active, lockdown } = storeState;
  const visibleError = actionError ?? (storeState.error === "e2e bypass" ? null : storeState.error);

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

  const handleOpenProjectPath = useCallback((projectPath: string) => {
    if (lockdown) return;
    setActionError(null);
    openWorkspace(projectPath, false)
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

        {visibleError && (
          <div style={{
            padding: "6px 12px",
            background: "var(--danger-bg, #f8d7da)",
            color: "var(--danger-text, #721c24)",
            borderRadius: "4px",
            marginBottom: "8px",
            fontSize: "0.85rem",
          }}>
            <i className="bi bi-exclamation-circle" /> {visibleError}
          </div>
        )}

        {!lockdown && <WorkspaceRootPanel lockdown={lockdown} onOpenProject={handleOpenProjectPath} />}

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
