/**
 * BackendFolderPicker (#1056)
 *
 * backend の filesystem をブラウズして 1 つのディレクトリを選択する modal。
 *
 * 用途:
 *   container / remote 開発で「ブラウザ側 file picker が使えない」場合の workspace 選択 UX。
 *   `showDirectoryPicker` (Web 仕様) は handle のみ返却で絶対 path を取れず、Harmony とは
 *   相性が悪いため、backend の `workspace.browseFs` 経由で fs を navigate する。
 *
 * 操作:
 *   - フォルダクリック: cd
 *   - 「上の階層」ボタン: parent に移動 (root では disabled)
 *   - 「このフォルダを選択」ボタン: 現在の path を onSelect で返して close
 *   - 「キャンセル」: close のみ
 *
 * 関連: docs/spec/path-conventions.md §8
 */
import { useEffect, useState, useCallback } from "react";
import { browseFs, type FsEntry, type BrowseFsResult } from "../../store/workspaceStore";

export interface BackendFolderPickerProps {
  /** 初期表示 path。省略時は backend の default (HARMONY_WORKSPACES_DIR / homedir 等) */
  initialPath?: string;
  /** フォルダ確定時に絶対 path を返す */
  onSelect: (absolutePath: string) => void;
  /** modal close 要求 (キャンセル / 外側クリック) */
  onClose: () => void;
}

export function BackendFolderPicker({ initialPath, onSelect, onClose }: BackendFolderPickerProps) {
  const [data, setData] = useState<BrowseFsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentPath, setCurrentPath] = useState<string | null>(initialPath ?? null);

  const navigate = useCallback(async (target?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await browseFs(target);
      setData(result);
      setCurrentPath(result.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // async IIFE で await を挟んで effect body 内同期 setState を回避する
    // (react-hooks/set-state-in-effect #1385)。
    let cancelled = false;
    void (async () => {
      await navigate(initialPath);
      if (cancelled) return;
    })();
    return () => { cancelled = true; };
  }, [initialPath, navigate]);

  const handleEntryClick = (entry: FsEntry) => {
    if (!entry.isDir || !data) return;
    const next = joinPath(data.path, entry.name);
    navigate(next);
  };

  const handleParentClick = () => {
    if (!data?.parent) return;
    navigate(data.parent);
  };

  const handleSelectClick = () => {
    if (currentPath) onSelect(currentPath);
  };

  return (
    <div
      className="tbl-modal-overlay"
      onClick={onClose}
      data-testid="backend-folder-picker-overlay"
    >
      <div
        className="tbl-modal"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: "640px", width: "90vw" }}
      >
        <div className="tbl-modal-title">フォルダを選択</div>

        {/* 現在 path (パンくず代わり) */}
        <div
          style={{
            fontFamily: "monospace",
            fontSize: "0.85rem",
            padding: "6px 10px",
            background: "var(--card-bg, #1f2230)",
            borderRadius: "4px",
            marginBottom: "8px",
            overflowWrap: "anywhere",
            color: "var(--muted-text, #aaa)",
          }}
          data-testid="folder-picker-current-path"
        >
          {currentPath ?? "—"}
        </div>

        <div style={{ display: "flex", gap: "6px", marginBottom: "8px" }}>
          <button
            type="button"
            className="tbl-btn tbl-btn-ghost"
            onClick={handleParentClick}
            disabled={!data?.parent || loading}
            title={data?.parent ? `${data.parent} へ移動` : "ルートのためこれ以上上には移動できません"}
            data-testid="folder-picker-up"
          >
            <i className="bi bi-arrow-up" /> 上の階層
          </button>
        </div>

        {/* エントリ一覧 */}
        <div
          style={{
            border: "1px solid var(--border, #334)",
            borderRadius: "4px",
            maxHeight: "360px",
            overflowY: "auto",
            background: "var(--card-bg, #1f2230)",
          }}
          data-testid="folder-picker-entries"
        >
          {loading && (
            <div style={{ padding: "12px", color: "var(--muted-text, #888)", fontSize: "0.85rem" }}>
              <i className="bi bi-hourglass-split" /> 読み込み中...
            </div>
          )}
          {!loading && error && (
            <div
              style={{
                padding: "12px",
                color: "var(--danger-text, #f88)",
                fontSize: "0.85rem",
              }}
              data-testid="folder-picker-error"
            >
              <i className="bi bi-exclamation-circle" /> {error}
            </div>
          )}
          {!loading && !error && data && data.entries.length === 0 && (
            <div style={{ padding: "12px", color: "var(--muted-text, #888)", fontSize: "0.85rem" }}>
              このフォルダは空です。
            </div>
          )}
          {!loading && !error && data && data.entries.length > 0 && (
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {data.entries.map((entry) => {
                const clickable = entry.isDir;
                const baseStyle: React.CSSProperties = {
                  display: "flex",
                  alignItems: "center",
                  gap: "8px",
                  padding: "6px 10px",
                  borderBottom: "1px solid var(--border-faint, #2a2d3a)",
                  fontSize: "0.85rem",
                  cursor: clickable ? "pointer" : "default",
                  color: clickable ? "inherit" : "var(--muted-text, #888)",
                  background: entry.isWorkspace ? "rgba(77,171,247,0.08)" : undefined,
                };
                return (
                  <li
                    key={entry.name}
                    onClick={() => handleEntryClick(entry)}
                    onDoubleClick={() => clickable && handleEntryClick(entry)}
                    style={baseStyle}
                    data-testid="folder-picker-entry"
                    data-name={entry.name}
                    data-is-dir={entry.isDir}
                    data-is-workspace={entry.isWorkspace}
                  >
                    <i
                      className={
                        entry.isWorkspace
                          ? "bi bi-folder-fill"
                          : entry.isDir
                            ? "bi bi-folder2"
                            : "bi bi-file-earmark"
                      }
                      style={{
                        color: entry.isWorkspace ? "var(--accent, #4dabf7)" : undefined,
                      }}
                    />
                    <span style={{ flex: 1, fontFamily: "monospace" }}>{entry.name}</span>
                    {entry.isWorkspace && (
                      <span
                        style={{
                          fontSize: "0.7rem",
                          background: "var(--accent, #4dabf7)",
                          color: "#fff",
                          borderRadius: "3px",
                          padding: "1px 5px",
                        }}
                      >
                        ワークスペース
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="tbl-modal-btns" style={{ marginTop: "10px" }}>
          <button type="button" className="tbl-btn tbl-btn-ghost" onClick={onClose}>
            キャンセル
          </button>
          <button
            type="button"
            className="tbl-btn tbl-btn-primary"
            onClick={handleSelectClick}
            disabled={!currentPath || loading}
            data-testid="folder-picker-select"
          >
            このフォルダを選択
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * シンプルな path join。
 *
 * BackendFolderPicker は backend (= server) の path 形式を扱う。本来は
 * `path.join` 相当を分離レイヤーで対応すべきだが、本コンポーネントは Linux/macOS
 * の `/` 区切り + Windows `\` 区切りの両 default だけサポートできれば良いので
 * 簡易実装する。`base` の末尾区切りを除去してから区切り文字で連結する。
 */
function joinPath(base: string, name: string): string {
  const sep = base.includes("\\") && !base.includes("/") ? "\\" : "/";
  // 末尾の区切り文字を 1 個だけ残す形に正規化してから連結:
  //   - "/"         → "" + "/" + name = "/<name>"
  //   - "/foo/"     → "/foo" + "/" + name = "/foo/<name>"
  //   - "C:\\"      → "C:" + "\\" + name = "C:\\<name>"
  //   - "C:\\foo\\" → "C:\\foo" + "\\" + name = "C:\\foo\\<name>"
  // root の場合と通常 path の場合で結果式が同じになるため if 分岐は不要。
  const trimmed = base.replace(/[/\\]+$/, "");
  return `${trimmed}${sep}${name}`;
}

/** @internal テスト用 */
// eslint-disable-next-line react-refresh/only-export-components
export const _internals = { joinPath };
