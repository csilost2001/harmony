import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import {
  GENERIC_DEFINITION_KINDS,
  GENERIC_DEFINITION_KIND_LABELS,
  GENERIC_DEFINITION_TARGETS,
  GENERIC_DEFINITION_TARGET_LABELS,
  GENERIC_DEFINITION_NAME_PATTERN,
  type GenericDefinitionKind,
  type GenericDefinitionTarget,
  type GenericDefinitionSummary,
} from "../../types/v3";
import {
  listGenericDefinitions,
  loadGenericDefinition,
  saveGenericDefinition,
  deleteGenericDefinition,
  createGenericDefinitionTemplate,
} from "../../store/genericDefinitionStore";
import { validateGenericDefinition } from "../../schemas/genericDefinitionValidator";
import { ValidationBadge } from "../common/ValidationBadge";
import { mcpBridge } from "../../mcp/mcpBridge";
import { makeTabId, openTab } from "../../store/tabStore";
import { DataList, type DataListColumn } from "../common/DataList";
import { FilterBar } from "../common/FilterBar";
import { SortBar } from "../common/SortBar";
import { ViewModeToggle, type ViewMode } from "../common/ViewModeToggle";
import { useListSelection } from "../../hooks/useListSelection";
import { useListClipboard } from "../../hooks/useListClipboard";
import { useListKeyboard } from "../../hooks/useListKeyboard";
import { useListFilter } from "../../hooks/useListFilter";
import { useListSort } from "../../hooks/useListSort";
import { usePersistentState } from "../../hooks/usePersistentState";
import "../../styles/table.css";

function isValidKind(k: string): k is GenericDefinitionKind {
  return (GENERIC_DEFINITION_KINDS as string[]).includes(k);
}

function storageKey(kind: string): string {
  return `list-view-mode:generic-definition-list-${kind}`;
}

function getId(item: GenericDefinitionSummary): string {
  return item.name;
}

export function GenericDefinitionListView() {
  const { kind: kindParam = "" } = useParams<{ kind: string }>();
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();

  const kind = isValidKind(kindParam) ? kindParam : null;
  const label = kind ? GENERIC_DEFINITION_KIND_LABELS[kind] : "";
  const tabId = kind ? makeTabId("generic-definition-list", kind) : "";

  const [items, setItems] = useState<GenericDefinitionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = usePersistentState<ViewMode>(storageKey(kindParam), "table");
  const [validationMap, setValidationMap] = useState<Map<string, { errors: number; warnings: number }>>(new Map());
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addPurpose, setAddPurpose] = useState("");
  const [addTargets, setAddTargets] = useState<GenericDefinitionTarget[]>([]);
  const [addResponsibilities, setAddResponsibilities] = useState("");
  const [addError, setAddError] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; name: string } | null>(null);

  // #1385 / PR #1386 Codex Round 1 Must-fix #2:
  // kind 切替時に「新 kind 見出し + 旧 kind items 表示」「新 kind で旧 item.name を loadGenericDefinition」
  // という旧 effect の即時 reset が失われていた問題を、React 19 公式 prev-key check pattern で復活。
  // /generic-definition/dialog → /generic-definition/options のように同 component の param 変更だけで
  // kind が変わる場合に旧 items が誤クリックで `newKind/oldName` 遷移を引き起こす regression を防ぐ。
  const [prevKindForReset, setPrevKindForReset] = useState(kind);
  if (prevKindForReset !== kind) {
    setPrevKindForReset(kind);
    setItems([]);
    setValidationMap(new Map());
    setLoading(true);
  }

  useEffect(() => {
    if (!kind || !tabId) return;
    const existing = document.querySelector(`[data-tab-id="${tabId}"]`);
    if (!existing) {
      openTab({ id: tabId, type: "generic-definition-list", resourceId: kind, label: `${label}一覧` });
    }
  }, [kind, tabId, label]);

  // loadItems は event handler / broadcast 経由の手動 reload 用 (effect body からは呼ばない)。
  // react-hooks/set-state-in-effect 回避のため、effect body での load は下記 useEffect の
  // async IIFE で実装する。
  const loadItems = useCallback(async () => {
    if (!kind) return;
    setLoading(true);
    try {
      const list = await listGenericDefinitions(kind);
      setItems(list);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [kind]);

  // 初期ロード / kind 変更時のロードは async IIFE で実行 (setState は await 後のため安全)。
  useEffect(() => {
    if (!kind) return;
    let cancelled = false;
    (async () => {
      try {
        const list = await listGenericDefinitions(kind);
        if (cancelled) return;
        setItems(list);
      } catch {
        if (cancelled) return;
        setItems([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [kind]);

  useEffect(() => {
    if (!kind) return;
    return mcpBridge.onBroadcast("genericDefinitionChanged", (data) => {
      const d = data as { kind?: string };
      if (d.kind === kind) {
        // broadcast handler は effect body ではないので loadItems を直接呼んで OK
        void loadItems();
      }
    });
  }, [kind, loadItems]);

  // バックグラウンドで validation map を構築 (ProcessFlowListView のパターンに倣う)。
  // S-1 fix (#1379 統合): kind 切替時の旧 validationMap 破棄もここに統合。
  // 別 useEffect で setValidationMap(new Map()) を呼ぶと react-hooks/set-state-in-effect 違反になるため、
  // この async effect 内で「kind / items が変わったらリセット → 再構築」をまとめて行う。
  useEffect(() => {
    if (!kind) return;
    let cancelled = false;
    (async () => {
      // 入力変化時はゼロから組み直す (空 items でも空 Map で再初期化される)
      const next = new Map<string, { errors: number; warnings: number }>();
      for (const item of items) {
        if (cancelled) break;
        const full = await loadGenericDefinition(kind, item.name);
        if (!full || cancelled) continue;
        const issues = validateGenericDefinition(full);
        next.set(item.name, {
          errors: issues.filter((i) => i.severity === "error").length,
          warnings: issues.filter((i) => i.severity === "warning").length,
        });
        if (cancelled) break;
        // 都度反映: ユーザーには逐次バッジが点灯していく UX を維持
        setValidationMap(new Map(next));
      }
      // items が空 → 旧 kind の残骸を確実にクリアするため、終端でも空 Map を反映
      if (!cancelled && items.length === 0) {
        setValidationMap(new Map());
      }
    })();
    return () => { cancelled = true; };
  }, [items, kind]);

  const [filterQuery, setFilterQuery] = useState("");
  const filter = useListFilter(items);

  useEffect(() => {
    if (!filterQuery.trim()) {
      filter.clearFilter();
    } else {
      const q = filterQuery.toLowerCase();
      filter.applyFilter((item) =>
        item.name.toLowerCase().includes(q) || item.purpose.toLowerCase().includes(q),
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQuery, items]);

  const sortAccessor = useCallback((item: GenericDefinitionSummary, col: string) => {
    if (col === "name") return item.name;
    if (col === "fieldCount") return item.fieldCount;
    return item.name;
  }, []);
  const sort = useListSort(filter.filtered, sortAccessor);
  const selection = useListSelection(sort.sorted, getId);
  const clipboard = useListClipboard<GenericDefinitionSummary>(getId);

  const handleActivate = useCallback((item: GenericDefinitionSummary) => {
    navigate(wsPath(`/generic-definition/${kind}/${encodeURIComponent(item.name)}`));
  }, [navigate, wsPath, kind]);

  const handleDelete = useCallback(async (items: GenericDefinitionSummary[]) => {
    if (!kind) return;
    if (!window.confirm(`${items.map((i) => i.name).join(", ")} を削除しますか？`)) return;
    for (const item of items) {
      await deleteGenericDefinition(kind, item.name);
    }
    loadItems();
  }, [kind, loadItems]);

  const handleDuplicate = useCallback(async (items: GenericDefinitionSummary[]) => {
    if (!kind || items.length === 0) return;
    const src = items[0];
    const full = await loadGenericDefinition(kind, src.name);
    if (!full) return;
    // 衝突しない name を生成 (_copy → _copy2 → _copy3 ...)
    const currentItems = await listGenericDefinitions(kind);
    const existingNames = new Set(currentItems.map((i) => i.name));
    let newName = `${src.name}_copy`;
    if (existingNames.has(newName)) {
      let suffix = 2;
      while (existingNames.has(`${src.name}_copy${suffix}`)) suffix++;
      newName = `${src.name}_copy${suffix}`;
    }
    await saveGenericDefinition({ ...full, name: newName });
    loadItems();
  }, [kind, loadItems]);

  useListKeyboard({
    items: sort.sorted,
    getId,
    selection,
    clipboard,
    sort,
    layout: viewMode === "card" ? "grid" : "list",
    onActivate: handleActivate,
    onDelete: handleDelete,
    onDuplicate: handleDuplicate,
  });

  const handleAddSubmit = useCallback(async () => {
    if (!kind) return;
    setAddError("");
    if (!addName.trim() || !GENERIC_DEFINITION_NAME_PATTERN.test(addName.trim())) {
      setAddError("名前は英数字・アンダースコアで始まる必要があります (例: OrderForm)");
      return;
    }
    if (addName.length > 64) {
      setAddError("名前は 64 文字以内にしてください");
      return;
    }
    if (!addPurpose.trim() || addPurpose.length > 200) {
      setAddError("目的は 1〜200 文字で入力してください");
      return;
    }
    if (addTargets.length === 0) {
      setAddError("適用領域を 1 つ以上選択してください");
      return;
    }
    const resps = addResponsibilities.split("\n").map((s) => s.trim()).filter((s) => s.length > 0);
    if (resps.length === 0) {
      setAddError("責務を 1 件以上入力してください");
      return;
    }
    // 最新リストで name 衝突チェック
    const latestItems = await listGenericDefinitions(kind);
    if (latestItems.some((i) => i.name === addName.trim())) {
      setAddError("同名の定義が既に存在します。別の名前を入力してください");
      return;
    }
    const def = createGenericDefinitionTemplate({
      kind,
      name: addName.trim(),
      purpose: addPurpose.trim(),
      responsibilities: resps,
      targets: addTargets,
    });
    await saveGenericDefinition(def);
    setShowAdd(false);
    setAddName("");
    setAddPurpose("");
    setAddTargets([]);
    setAddResponsibilities("");
    loadItems();
    navigate(wsPath(`/generic-definition/${kind}/${encodeURIComponent(def.name)}`));
  }, [kind, addName, addPurpose, addTargets, addResponsibilities, loadItems, navigate, wsPath]);

  const columns = useMemo<DataListColumn<GenericDefinitionSummary>[]>(() => [
    {
      key: "name",
      header: "名前",
      sortable: true,
      sortAccessor: (item) => item.name,
      // #1088 提案 B (案 A): name 列の single-click ショートカットを削除し、他 3 ListView
      // (Screen / Table / ProcessFlow) と同じ dblclick / Enter で開く挙動に統一。
      // navigation 経路: row dblclick (DataList 共通) または Enter キー (useListKeyboard)。
      render: (item) => (
        <span style={{ fontWeight: 600, fontFamily: "monospace", color: "#0d6efd" }}>
          {item.name}
        </span>
      ),
    },
    {
      key: "purpose",
      header: "目的",
      render: (item) => (
        <span style={{ color: "#444", fontSize: "0.88rem" }}>{item.purpose}</span>
      ),
    },
    {
      key: "targets",
      header: "適用領域",
      render: (item) => (
        <span>
          {item.targets.map((t) => (
            <span key={t} style={{
              background: "#e8f4fd", color: "#0d6efd",
              padding: "2px 6px", borderRadius: "4px",
              fontSize: "0.78rem", marginRight: "4px",
            }}>
              {GENERIC_DEFINITION_TARGET_LABELS[t] ?? t}
            </span>
          ))}
        </span>
      ),
    },
    {
      key: "fieldCount",
      header: "フィールド数",
      sortable: true,
      sortAccessor: (item) => item.fieldCount,
      render: (item) => <span>{item.fieldCount}</span>,
    },
    {
      key: "validation",
      header: "検証",
      render: (item) => {
        const v = validationMap.get(item.name);
        if (!v) return <span style={{ color: "#ccc", fontSize: "0.8rem" }}>...</span>;
        if (v.errors === 0 && v.warnings === 0) {
          return <i className="bi bi-check-lg" style={{ color: "#28a745" }} title="問題なし" />;
        }
        return (
          <span style={{ display: "inline-flex", gap: "4px" }}>
            <ValidationBadge severity="error" count={v.errors} />
            <ValidationBadge severity="warning" count={v.warnings} />
          </span>
        );
      },
    },
  ], [validationMap]);

  const renderCard = useCallback((item: GenericDefinitionSummary) => {
    const v = validationMap.get(item.name);
    const hasError = v && v.errors > 0;
    const hasWarning = v && !hasError && v.warnings > 0;
    return (
      <div
        className={hasError ? "has-error" : hasWarning ? "has-warning" : ""}
        style={{ padding: "12px" }}
      >
        {/* #1088 提案 B (案 A): name の single-click ショートカット削除。card 全体の
            dblclick (DataList 共通) または Enter キーで開く挙動に統一。 */}
        <div style={{ fontWeight: 600, fontFamily: "monospace", color: "#0d6efd", marginBottom: "4px", fontSize: "0.95rem" }}>
          {item.name}
        </div>
        <div style={{ fontSize: "0.82rem", color: "#555", marginBottom: "8px" }}>{item.purpose}</div>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            {item.targets.map((t) => (
              <span key={t} style={{
                background: "#e8f4fd", color: "#0d6efd",
                padding: "2px 6px", borderRadius: "4px",
                fontSize: "0.75rem", marginRight: "4px",
              }}>
                {GENERIC_DEFINITION_TARGET_LABELS[t] ?? t}
              </span>
            ))}
          </div>
          {v && (v.errors > 0 || v.warnings > 0) && (
            <span style={{ display: "inline-flex", gap: "4px" }}>
              <ValidationBadge severity="error" count={v.errors} />
              <ValidationBadge severity="warning" count={v.warnings} />
            </span>
          )}
        </div>
      </div>
    );
  }, [validationMap]);

  if (!kind) {
    return <div style={{ padding: "24px", color: "#c00" }}>不正な kind です</div>;
  }

  const columnLabels: Record<string, string> = { name: "名前", fieldCount: "フィールド数" };

  return (
    <div style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "16px 24px 8px", borderBottom: "1px solid #eee", display: "flex", alignItems: "center", gap: "12px" }}>
        <h2 style={{ margin: 0, fontSize: "1.1rem" }}>{label}一覧</h2>
        <span style={{ fontFamily: "monospace", fontSize: "0.8rem", color: "#888" }}>{kind}</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: "8px", alignItems: "center" }}>
          <ViewModeToggle mode={viewMode} onChange={setViewMode} storageKey={storageKey(kindParam)} />
          <button className="btn btn-primary btn-sm" onClick={() => setShowAdd(true)}>新規作成</button>
        </div>
      </div>

      <div style={{ padding: "8px 24px", display: "flex", gap: "8px", alignItems: "center", borderBottom: "1px solid #f0f0f0" }}>
        <FilterBar
          isActive={filter.isActive}
          totalCount={items.length}
          visibleCount={filter.filtered.length}
          label="件"
          onClear={() => { setFilterQuery(""); filter.clearFilter(); }}
        />
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder={`${label}を検索...`}
          style={{ border: "1px solid #ddd", borderRadius: "4px", padding: "4px 8px", fontSize: "0.88rem", minWidth: "200px" }}
        />
        <SortBar sort={sort} columnLabels={columnLabels} />
      </div>

      <div style={{ flex: 1, overflow: "auto", padding: "8px 24px" }}>
        {loading ? (
          <div style={{ padding: "24px", color: "#888", textAlign: "center" }}>読み込み中...</div>
        ) : (
          <DataList
            items={sort.sorted}
            columns={columns}
            getId={getId}
            selection={selection}
            clipboard={clipboard}
            sort={sort}
            layout={viewMode === "card" ? "grid" : "list"}
            renderCard={renderCard}
            onActivate={(item) => handleActivate(item)}
            onContextMenu={(e, item) => {
              e.preventDefault();
              if (item) setContextMenu({ x: e.clientX, y: e.clientY, name: item.name });
            }}
          />
        )}
      </div>

      {contextMenu && (
        <div
          style={{
            position: "fixed", left: contextMenu.x, top: contextMenu.y,
            background: "#fff", border: "1px solid #ddd", borderRadius: "6px",
            boxShadow: "0 2px 8px rgba(0,0,0,0.15)", zIndex: 9999, minWidth: "140px",
          }}
          onClick={() => setContextMenu(null)}
        >
          <div style={{ padding: "4px 0" }}>
            <div
              style={{ padding: "6px 16px", cursor: "pointer", fontSize: "0.88rem" }}
              onClick={() => navigate(wsPath(`/generic-definition/${kind}/${encodeURIComponent(contextMenu.name)}`))}
            >
              編集
            </div>
            <div
              style={{ padding: "6px 16px", cursor: "pointer", fontSize: "0.88rem", color: "#c00" }}
              onClick={async () => {
                if (!window.confirm(`${contextMenu.name} を削除しますか？`)) return;
                await deleteGenericDefinition(kind, contextMenu.name);
                loadItems();
              }}
            >
              削除
            </div>
          </div>
        </div>
      )}

      {showAdd && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
        }} onClick={() => setShowAdd(false)}>
          <div style={{
            background: "#fff", borderRadius: "8px", padding: "24px",
            minWidth: "480px", maxWidth: "600px",
          }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ marginTop: 0, fontSize: "1.1rem" }}>{label}を新規作成</h3>
            {addError && <div style={{ color: "#c00", marginBottom: "12px", fontSize: "0.88rem" }}>{addError}</div>}
            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "4px", fontSize: "0.88rem" }}>
                名前 (PascalCase、例: OrderForm)
              </label>
              <input
                type="text"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                style={{ width: "100%", border: "1px solid #ddd", borderRadius: "4px", padding: "6px 10px" }}
                placeholder="OrderForm"
              />
            </div>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "4px", fontSize: "0.88rem" }}>
                目的 (1〜200 文字)
              </label>
              <textarea
                value={addPurpose}
                onChange={(e) => setAddPurpose(e.target.value)}
                rows={2}
                style={{ width: "100%", border: "1px solid #ddd", borderRadius: "4px", padding: "6px 10px", resize: "vertical" }}
                placeholder="この定義の目的を 1〜2 行で記述"
              />
            </div>
            <div style={{ marginBottom: "12px" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "4px", fontSize: "0.88rem" }}>
                責務 (1 行 1 件、最低 1 件)
              </label>
              <textarea
                value={addResponsibilities}
                onChange={(e) => setAddResponsibilities(e.target.value)}
                rows={3}
                style={{ width: "100%", border: "1px solid #ddd", borderRadius: "4px", padding: "6px 10px", resize: "vertical" }}
                placeholder={"責務を 1 行に 1 件記述\n例: 顧客入力を保持する"}
              />
            </div>
            <div style={{ marginBottom: "16px" }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: "4px", fontSize: "0.88rem" }}>
                適用領域 (最低 1 つ)
              </label>
              <div style={{ display: "flex", gap: "16px" }}>
                {GENERIC_DEFINITION_TARGETS.map((t) => (
                  <label key={t} style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "0.88rem", cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={addTargets.includes(t)}
                      onChange={(e) => {
                        setAddTargets(e.target.checked
                          ? [...addTargets, t]
                          : addTargets.filter((x) => x !== t));
                      }}
                    />
                    {GENERIC_DEFINITION_TARGET_LABELS[t]}
                  </label>
                ))}
              </div>
            </div>
            <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
              <button className="btn btn-outline-secondary btn-sm" onClick={() => setShowAdd(false)}>キャンセル</button>
              <button className="btn btn-primary btn-sm" onClick={handleAddSubmit}>作成</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
