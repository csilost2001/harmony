/**
 * 対応表。業務フロー → 画面 → 処理 → テーブル → テスト観点のトレーサビリティ表、画面項目 ↔ カラムの対応、役割 × 画面 × 操作の権限。
 * それぞれ、欠け (対応のない行) を上に出し、CSV に書き出せる。
 */
import { useMemo, useState } from "react";
import { columnMapToCsv, deriveColumnMap, deriveOperationMatrix, deriveTraceability, operationMatrixToCsv, traceabilityToCsv, usesPermissionModel, type DesignDocInput } from "@harmony/shared";
import { AnTable, EntityLink, Empty, Section } from "../ui";
import { saveTextFile, withBom } from "../fileIo";

type Sub = "trace" | "columns" | "operations";
const SUBS: Array<{ id: Sub; label: string }> = [{ id: "trace", label: "業務 → 画面 → 処理 → テーブル" }, { id: "columns", label: "画面項目 ↔ カラム" }, { id: "operations", label: "役割 × 画面 × 操作" }];

const csvButton = (name: string, build: () => string) => <button type="button" className="an-btn" onClick={() => saveTextFile(name, withBom(build()), "text/csv")}><i className="bi bi-download" /> CSV で保存</button>;

export function MapsTab({ input }: { input: DesignDocInput }) {
  const [sub, setSub] = useState<Sub>("trace");
  return (
    <div className="an-pane" data-testid="an-maps">
      <nav className="an-subtabs" aria-label="対応表の種類">
        {SUBS.map((s) => <button key={s.id} type="button" className={sub === s.id ? "on" : ""} aria-pressed={sub === s.id} onClick={() => setSub(s.id)}>{s.label}</button>)}
      </nav>
      {sub === "trace" ? <Trace input={input} /> : sub === "columns" ? <Columns input={input} /> : <Operations input={input} />}
    </div>
  );
}

function Trace({ input }: { input: DesignDocInput }) {
  const r = useMemo(() => deriveTraceability(input), [input]);
  const [onlyGaps, setOnlyGaps] = useState(false);
  const rows = onlyGaps ? r.rows.filter((x) => x.gaps.length) : r.rows;
  return (
    <>
      <Section title={`欠け (${r.gaps.length} 件)`} hint="対応が決まっていない工程・画面・処理です。" testId="an-trace-gaps">
        {r.gaps.length === 0 ? <Empty>対応の欠けはありません。</Empty> : (
          <ul className="an-list">{r.gaps.map((g, i) => <li key={i}>{g.ref ? <EntityLink kind={g.ref.kind} id={g.ref.id}>{g.message}</EntityLink> : g.message}</li>)}</ul>
        )}
      </Section>
      <Section title={`トレーサビリティ表 (${rows.length} 行)`} testId="an-trace-table"
        actions={<><label className="an-check"><input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> 欠けのある行だけ</label>{csvButton("traceability.csv", () => traceabilityToCsv(r))}</>}>
        <AnTable headers={["業務フロー", "工程", "画面", "処理フロー", "テーブル (操作)", "テスト観点", "欠け"]} empty="業務フロー・画面・処理がありません。" rows={rows.map((x) => [
          x.businessFlow ? <EntityLink key="b" kind="businessFlow" id={x.businessFlow.id}>{x.businessFlow.name}</EntityLink> : "―",
          x.step ? `${x.step.name} (${x.step.lane})` : "―",
          <span key="s">{x.screens.map((s, i) => <span key={s.id}>{i > 0 && "、"}<EntityLink kind="screen" id={s.id}>{s.name}</EntityLink></span>)}</span>,
          <span key="f">{x.flows.map((f, i) => <span key={f.id}>{i > 0 && "、"}<EntityLink kind="processFlow" id={f.id}>{f.name}</EntityLink></span>)}</span>,
          <span key="t">{x.tables.map((t, i) => <span key={t.id}>{i > 0 && "、"}<EntityLink kind="table" id={t.id}>{t.name}</EntityLink> ({t.ops})</span>)}</span>,
          x.viewpoints,
          x.gaps.length ? <span key="g" className="an-warn">{x.gaps.join(" / ")}</span> : "",
        ])} />
      </Section>
    </>
  );
}

const STATUS_LABEL = { mapped: "列に結び付いている", other: "列以外に結び付いている", unbound: "結び付いていない", broken: "存在しない列を指している" } as const;

function Columns({ input }: { input: DesignDocInput }) {
  const r = useMemo(() => deriveColumnMap(input), [input]);
  const [status, setStatus] = useState<"all" | keyof typeof STATUS_LABEL>("all");
  const rows = status === "all" ? r.rows : r.rows.filter((x) => x.status === status);
  return (
    <>
      <Section title={`保存先の無い入力項目 (${r.unboundInputs.length} 件)`} hint="入力の保存先も受け渡し先も決まっていない項目です。" testId="an-col-unbound">
        <AnTable headers={["画面", "項目"]} empty="保存先の決まっていない入力項目はありません。" rows={r.unboundInputs.map((x) => [<EntityLink key="s" kind="screen" id={x.screen.id}>{x.screen.name}</EntityLink>, `${x.item.label} (${x.item.id})`])} />
      </Section>
      <Section title={`存在しない列を指す項目 (${r.brokenBindings.length} 件)`} testId="an-col-broken">
        <AnTable headers={["画面", "項目", "内容"]} empty="存在しない列を指している項目はありません。" rows={r.brokenBindings.map((x) => [<EntityLink key="s" kind="screen" id={x.screen.id}>{x.screen.name}</EntityLink>, `${x.item.label} (${x.item.id})`, x.note ?? ""])} />
      </Section>
      <Section title={`どこからも使われていない列 (${r.unusedColumns.length} 件)`} hint="画面項目・処理の SQL・帳票のどれにも出てこない列です (主キー・外部キー・更新日時などは除く)。" testId="an-col-unused">
        <AnTable headers={["テーブル", "列"]} empty="使われていない列はありません。" rows={r.unusedColumns.map((u) => [<EntityLink key="t" kind="table" id={u.table.id}>{u.table.name}</EntityLink>, `${u.column.name ?? ""} (${u.column.physicalName})`])} />
      </Section>
      <Section title={`対応表 (${rows.length} 行)`} testId="an-col-map"
        actions={<><select className="an-input" value={status} onChange={(e) => setStatus(e.target.value as typeof status)} aria-label="状態で絞る"><option value="all">すべて</option>{Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>{csvButton("column-map.csv", () => columnMapToCsv(r))}</>}>
        <AnTable headers={["画面", "画面項目", "方向", "状態", "テーブル", "列"]} empty="画面項目がありません。" rows={rows.map((x) => [
          <EntityLink key="s" kind="screen" id={x.screen.id}>{x.screen.name}</EntityLink>, `${x.item.label} (${x.item.id})`, { in: "入力", out: "表示", both: "入出力" }[x.item.direction ?? ""] ?? "",
          STATUS_LABEL[x.status], x.table ? <EntityLink key="t" kind="table" id={x.table.id}>{x.table.name}</EntityLink> : "", x.column ? `${x.column.name ?? ""} (${x.column.physicalName})` : "",
        ])} />
      </Section>
    </>
  );
}

function Operations({ input }: { input: DesignDocInput }) {
  const m = useMemo(() => deriveOperationMatrix(input), [input]);
  const model = usesPermissionModel(input);
  const roleName = (id: string) => input.roles?.[id]?.name ?? id;
  return (
    <>
      {!model && <p className="an-hint" data-testid="an-ops-nomodel">このプロジェクトは、役割・権限を使っていません (規約カタログの役割・権限、画面の「必要な権限」、アクションの「必要な権限」が無い)。権限の指摘は出しません。</p>}
      <Section title={`権限が決まっていない更新操作 (${m.issues.length} 件)`} hint="更新を伴うのに、画面の権限にも操作の権限にも守られていない操作です。" testId="an-ops-issues">
        {!model ? <Empty>対象外です (権限を使っていないため)。</Empty> : m.issues.length === 0 ? <Empty>該当する操作はありません。</Empty> : <ul className="an-list">{m.issues.map((i, k) => <li key={k}>{i.ref ? <EntityLink kind={i.ref.kind} id={i.ref.id}>{i.message}</EntityLink> : i.message}</li>)}</ul>}
      </Section>
      <Section title={`役割 × 画面 × 操作 (${m.rows.length} 行)`} testId="an-ops-matrix" actions={csvButton("operations.csv", () => operationMatrixToCsv(m, roleName))}>
        <AnTable headers={["画面", "処理フロー / 操作", "更新", "必要な権限 (画面 + 操作)", ...m.roleIds.map(roleName)]} empty="処理フローがありません。" rows={m.rows.map((r) => [
          r.screen ? <EntityLink key="s" kind="screen" id={r.screen.id}>{r.screen.name}</EntityLink> : "―",
          <span key="f"><EntityLink kind="processFlow" id={r.flow.id}>{r.flow.name}</EntityLink> / {r.action.name}{r.http ? ` (${r.http.method} ${r.http.path})` : ""}</span>,
          r.writes ? "○" : "",
          r.open ? <span key="p" className={r.writes ? "an-warn" : ""}>なし (誰でも)</span> : [...new Set([...r.screenPermissions, ...r.actionPermissions])].map((p) => <code key={p}>{p} </code>),
          ...m.roleIds.map((id) => (r.roles.includes(id) ? "○" : "")),
        ])} />
      </Section>
    </>
  );
}
