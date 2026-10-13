/**
 * 影響分析。ある設計 (テーブルは列でも) を変える・消すと、何が連鎖して影響を受けるかを、段ごとに示す。
 * 画面 → 処理 → テーブル を、直接の参照だけでなく最後までたどる。
 */
import { useMemo, useState } from "react";
import { analyzeImpact, buildDesignGraph, NODE_KIND_LABELS, type DesignDocInput, type NodeKind } from "@harmony/shared";
import { AnTable, EntityLink, Empty, Section } from "../ui";

const KIND_ORDER: NodeKind[] = ["table", "screen", "processFlow", "businessFlow", "report", "component", "message", "regex", "limit", "genericDefinition"];
const MAX_OPTIONS = 300;

export function ImpactTab({ input }: { input: DesignDocInput }) {
  const graph = useMemo(() => buildDesignGraph(input), [input]);
  const kinds = useMemo(() => KIND_ORDER.filter((k) => [...graph.nodes.values()].some((n) => n.kind === k)), [graph]);
  const [kind, setKind] = useState<NodeKind>(kinds[0] ?? "table");
  const [filter, setFilter] = useState("");
  const [id, setId] = useState("");
  const [column, setColumn] = useState("");

  const options = useMemo(() => [...graph.nodes.values()].filter((n) => n.kind === kind && (!filter || `${n.name} ${n.id}`.toLowerCase().includes(filter.toLowerCase()))), [graph, kind, filter]);
  const target = id && graph.nodes.has(`${kind}:${id}`) ? id : "";
  const columns = useMemo(() => (kind === "table" && target ? input.tables.find((t) => t.id === target)?.columns ?? [] : []), [input, kind, target]);
  const result = useMemo(() => (target ? analyzeImpact(input, kind, target, column ? { column } : {}, graph) : null), [input, kind, target, column, graph]);

  return (
    <div className="an-pane" data-testid="an-impact">
      <Section title="何を変えますか" hint="変える・消す設計を選ぶと、連鎖して影響を受ける設計が出ます。">
        <div className="an-form-row">
          <label>種類
            <select className="an-input" value={kind} onChange={(e) => { setKind(e.target.value as NodeKind); setId(""); setColumn(""); }} data-testid="an-impact-kind">
              {kinds.map((k) => <option key={k} value={k}>{NODE_KIND_LABELS[k]}</option>)}
            </select>
          </label>
          <label>絞り込み
            <input className="an-input" type="search" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="例: 顧客" />
          </label>
          <label>対象 ({options.length} 件)
            <select className="an-input" value={target} onChange={(e) => { setId(e.target.value); setColumn(""); }} data-testid="an-impact-target">
              <option value="">選んでください</option>
              {options.slice(0, MAX_OPTIONS).map((n) => <option key={n.id} value={n.id}>{n.name}{n.name !== n.id ? ` (${n.id})` : ""}</option>)}
            </select>
          </label>
          {kind === "table" && (
            <label>列で絞る (任意)
              <select className="an-input" value={column} onChange={(e) => setColumn(e.target.value)} disabled={!columns.length} data-testid="an-impact-column">
                <option value="">テーブル全体</option>
                {columns.map((c) => <option key={c.id ?? c.physicalName} value={c.id ?? c.physicalName}>{c.name ?? c.physicalName} ({c.physicalName})</option>)}
              </select>
            </label>
          )}
        </div>
        {options.length > MAX_OPTIONS && <p className="an-hint">先頭の {MAX_OPTIONS} 件だけ出しています。絞り込みを使ってください。</p>}
      </Section>

      {result && (
        <Section title={`影響を受ける設計 (${result.total} 件)`} testId="an-impact-result"
          hint={result.total ? Object.entries(result.byKind).map(([k, n]) => `${NODE_KIND_LABELS[k as NodeKind]} ${n}`).join(" / ") : undefined}>
          {result.total === 0 ? <Empty>この設計に頼っている設計はありません (変えても、ほかの設計には影響しません)。</Empty> : result.levels.map((lv) => (
            <div key={lv.depth} className="an-level">
              <h3>{lv.depth === 1 ? "直接影響する" : `${lv.depth} 段先に影響する`} ({lv.hits.length} 件)</h3>
              <AnTable testId={`an-impact-level-${lv.depth}`} headers={["種類", "設計", "どう影響するか"]} rows={lv.hits.map((h) => [
                NODE_KIND_LABELS[h.node.kind],
                <EntityLink key="l" kind={h.node.kind} id={h.node.id}>{h.node.name}</EntityLink>,
                lv.depth === 1 ? h.via.label : `「${h.via.name}」を通って影響する (${h.via.label})`,
              ])} />
            </div>
          ))}
        </Section>
      )}
    </div>
  );
}
