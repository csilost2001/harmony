/**
 * 一覧の「いま何で絞っているか」のチップと、「保存した絞り込み」(UI 改善提案 続編 第 6 弾 #101 #105)。
 * - 検索語・種別などの絞り込みを「語: 顧客」「種別: バッチ」のチップで並べ、× で 1 つずつ外せる
 * - 今の検索語・絞り込み・並びに名前を付けて保存し、チップ 1 回で呼び出す (ブラウザに覚える。設計の原本には書かない)
 * 絞り込んでいなくて、保存した絞り込みも無いときは、何も出さない。
 */
import { useState } from "react";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import type { ListSort } from "../../hooks/useListSort";
import {
  LIST_VIEW_NAME_MAX, addListView, hasFilter, normalizeView, removeListView, sameView, useListViews,
  type ListViewState,
} from "../../utils/listViews";
import { isImeComposing, isPlainEnter } from "../../utils/imeKeys";
import "../../styles/listViewBar.css";

export interface ListFacet {
  key: string;
  /** チップの見出し (例: 種別) */
  label: string;
  /** 絞り込みの値 (空 = 絞っていない) */
  value: string;
  /** チップに出す値の表示 (例: バッチ) */
  text: string;
  set: (value: string) => void;
}

interface Props<T> {
  /** 一覧ごとに別の key (例: table-list)。保存先になる */
  listKey: string;
  query: string;
  onQuery: (q: string) => void;
  facets?: ListFacet[];
  sort?: ListSort<T>;
}

export function ListViewBar<T>({ listKey, query, onQuery, facets = [], sort }: Props<T>) {
  const { wsId } = useWorkspacePath();
  const saved = useListViews(wsId, listKey);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState("");

  const current: ListViewState = normalizeView({
    query,
    facets: Object.fromEntries(facets.map((f) => [f.key, f.value])),
    sort: sort?.sortKeys ?? [],
  });
  const active = hasFilter(current);
  if (!active && saved.length === 0) return null;

  const apply = (s: ListViewState) => {
    onQuery(s.query);
    for (const f of facets) f.set(s.facets[f.key] ?? "");
    sort?.setSortKeys(s.sort);
  };
  const alreadySaved = saved.some((v) => sameView(v.state, current));
  const commit = () => {
    if (addListView(wsId, listKey, name, current)) { setNaming(false); setName(""); }
  };

  return (
    <div className="list-view-bar" data-testid="list-view-bar">
      {active && (
        <div className="list-view-chips" role="group" aria-label="いまの絞り込み">
          {current.query && (
            <span className="list-view-chip" data-testid="list-view-chip">
              語: {current.query}
              <button type="button" aria-label="検索語を外す" onClick={() => onQuery("")}><i className="bi bi-x" /></button>
            </span>
          )}
          {facets.filter((f) => f.value !== "").map((f) => (
            <span key={f.key} className="list-view-chip" data-testid="list-view-chip">
              {f.label}: {f.text}
              <button type="button" aria-label={`${f.label}の絞り込みを外す`} onClick={() => f.set("")}><i className="bi bi-x" /></button>
            </span>
          ))}
          {!alreadySaved && !naming && (
            <button type="button" className="list-view-save" data-testid="list-view-save-open" onClick={() => setNaming(true)} title="いまの検索語・絞り込み・並びに名前を付けて、あとで 1 回で呼び出せるようにします (このブラウザに覚えます)">
              <i className="bi bi-bookmark-plus" /> この条件を保存
            </button>
          )}
          {naming && (
            <span className="list-view-naming">
              <input type="text" value={name} maxLength={LIST_VIEW_NAME_MAX} autoFocus placeholder="例: 未完成だけ" aria-label="保存する絞り込みの名前" data-testid="list-view-name"
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (isImeComposing(e)) return;
                  if (isPlainEnter(e)) { e.preventDefault(); commit(); }
                  else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setNaming(false); setName(""); }
                }} />
              <button type="button" onClick={commit} disabled={!name.trim()} data-testid="list-view-save">保存</button>
              <button type="button" onClick={() => { setNaming(false); setName(""); }}>やめる</button>
            </span>
          )}
        </div>
      )}
      {saved.length > 0 && (
        <div className="list-view-saved" role="group" aria-label="保存した絞り込み">
          <span className="list-view-saved-label"><i className="bi bi-bookmarks" /> 保存した絞り込み</span>
          {saved.map((v) => {
            const on = sameView(v.state, current);
            return (
              <span key={v.id} className={`list-view-saved-item${on ? " is-on" : ""}`}>
                <button type="button" className="list-view-saved-apply" aria-pressed={on} data-testid="list-view-saved" title={describeSaved(v.state)}
                  onClick={() => (on ? apply(normalizeView({})) : apply(v.state))}>{v.name}</button>
                <button type="button" className="list-view-saved-del" aria-label={`保存した絞り込み「${v.name}」を削除`} data-testid="list-view-saved-del" onClick={() => removeListView(wsId, listKey, v.id)}><i className="bi bi-x" /></button>
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

function describeSaved(s: ListViewState): string {
  const parts: string[] = [];
  if (s.query) parts.push(`語: ${s.query}`);
  for (const [k, v] of Object.entries(s.facets)) parts.push(`${k}: ${v}`);
  if (s.sort.length) parts.push(`並び: ${s.sort.map((x) => `${x.columnKey}${x.direction === "asc" ? "↑" : "↓"}`).join(" ")}`);
  return parts.join(" / ") || "(条件なし)";
}
