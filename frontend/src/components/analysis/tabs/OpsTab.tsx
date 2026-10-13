/**
 * 運用。性能の目標 (SLA) の宣言の一覧と宣言漏れ、ジョブ (バッチ・定期処理) の一覧と依存、外部システムの呼び出しと相手の OpenAPI の突き合わせ。
 */
import { useMemo, useState } from "react";
import { checkExternalContracts, deriveJobs, deriveSla, SLA_KIND_LABELS, slaGaps, slaToCsv, type DesignDocInput, type ExternalCall } from "@harmony/shared";
import { AnTable, EntityLink, Empty, Section } from "../ui";
import { saveTextFile, withBom } from "../fileIo";

type Sub = "sla" | "jobs" | "external";
const SUBS: Array<{ id: Sub; label: string }> = [{ id: "sla", label: "性能の目標 (SLA)" }, { id: "jobs", label: "ジョブ" }, { id: "external", label: "外部システムの契約" }];
const fmtMs = (n?: number) => (n === undefined ? "" : `${n.toLocaleString("ja-JP")} ms`);

export function OpsTab({ input }: { input: DesignDocInput }) {
  const [sub, setSub] = useState<Sub>("sla");
  return (
    <div className="an-pane" data-testid="an-ops">
      <nav className="an-subtabs" aria-label="運用の種類">
        {SUBS.map((s) => <button key={s.id} type="button" className={sub === s.id ? "on" : ""} aria-pressed={sub === s.id} onClick={() => setSub(s.id)}>{s.label}</button>)}
      </nav>
      {sub === "sla" ? <Sla input={input} /> : sub === "jobs" ? <Jobs input={input} /> : <External input={input} />}
    </div>
  );
}

function Sla({ input }: { input: DesignDocInput }) {
  const rows = useMemo(() => deriveSla(input), [input]);
  const gaps = useMemo(() => slaGaps(rows), [rows]);
  return (
    <>
      <Section title={`宣言が無い (${gaps.length} 件)`} hint="外部から呼ぶ API・ジョブには、性能の目標 (SLA) を宣言してください。" testId="an-sla-gaps">
        {gaps.length === 0 ? <Empty>宣言漏れはありません。</Empty> : <ul className="an-list">{gaps.map((g, i) => <li key={i}><EntityLink kind="processFlow" id={g.row.flow.id}>{g.message}</EntityLink></li>)}</ul>}
      </Section>
      <Section title={`SLA の一覧 (${rows.length} 件)`} testId="an-sla-table" actions={<button type="button" className="an-btn" onClick={() => saveTextFile("sla.csv", withBom(slaToCsv(rows)), "text/csv")}><i className="bi bi-download" /> CSV で保存</button>}
        hint="要件の一覧 (どの性能を満たすべきか) は、設計データに持つ場所が無いため、宣言の有無だけを見ます。">
        <AnTable headers={["処理フロー / アクション", "種類", "宣言の場所", "タイムアウト", "p95", "警告しきい値", "外部呼び出し (タイムアウトの宣言)"]} empty="処理フローがありません。" rows={rows.map((r) => [
          <span key="f"><EntityLink kind="processFlow" id={r.flow.id}>{r.flow.name}</EntityLink> / {r.action.name}</span>,
          SLA_KIND_LABELS[r.kind] + (r.http ? ` (${r.http.method} ${r.http.path})` : ""), { action: "アクション", flow: "処理フロー全体", none: "なし" }[r.declaredAt],
          fmtMs(r.sla.timeoutMs), fmtMs(r.sla.p95LatencyMs), fmtMs(r.sla.warningThresholdMs), r.externalCalls.total ? `${r.externalCalls.withSla} / ${r.externalCalls.total}` : "",
        ])} />
      </Section>
    </>
  );
}

function Jobs({ input }: { input: DesignDocInput }) {
  const jobs = useMemo(() => deriveJobs(input), [input]);
  const name = (id: string) => input.tables.find((t) => t.id === id)?.name ?? id;
  return (
    <Section title={`ジョブ (${jobs.length} 件)`} hint="処理フローの種類が「バッチ」「定期」のものです。実行の時刻・再実行の定義は、設計データに持つ場所が無いため、ここには出ません。" testId="an-jobs">
      <AnTable headers={["ジョブ", "種類", "起動 / 説明", "更新するテーブル", "発行 / 購読するイベント", "先に動くべきもの", "タイムアウト"]} empty="バッチ・定期処理はありません。" rows={jobs.map((j) => [
        <EntityLink key="f" kind="processFlow" id={j.flow.id}>{j.flow.name}</EntityLink>, j.flowType === "scheduled" ? "定期" : "バッチ",
        <ul key="a" className="an-list">{j.actions.map((a) => <li key={a.id}>{a.name}{a.trigger ? ` [${a.trigger}]` : ""}{a.description ? `: ${a.description.slice(0, 80)}` : ""}</li>)}{j.closing && <li>締め処理: {j.closing.period ?? ""} {j.closing.customCron ?? ""}</li>}</ul>,
        j.writtenTables.map((t) => <span key={t}><EntityLink kind="table" id={t}>{name(t)}</EntityLink> </span>),
        <span key="e">{j.publishes.length > 0 && <>発行: {j.publishes.join("、")} </>}{j.subscribes.length > 0 && <>購読: {j.subscribes.join("、")}</>}</span>,
        j.dependsOn.map((d, i) => <div key={i}><EntityLink kind="processFlow" id={d.flow.id}>{d.flow.name}</EntityLink> ({d.label})</div>),
        fmtMs(j.timeoutMs),
      ])} />
    </Section>
  );
}

const RESULT: Record<ExternalCall["result"], string> = { ok: "一致", "missing-path": "相手の定義に無いパス", "missing-method": "相手の定義に無いメソッド", "unknown-operation": "相手の定義に無い operationId", "not-checked": "照合していない" };

function External({ input }: { input: DesignDocInput }) {
  const systems = useMemo(() => checkExternalContracts(input), [input]);
  return (
    <Section title={`外部システム (${systems.length} 件)`} hint="処理フローの外部システム呼び出し (呼び出し側) と、相手の OpenAPI (提供側) の突き合わせです。ワークスペース内の JSON の定義だけ照合します (URL・YAML は照合しません)。" testId="an-external">
      {systems.length === 0 ? <Empty>外部システムの呼び出しはありません。</Empty> : systems.map((s) => (
        <div key={s.source ?? "(none)"} className="an-level" data-testid="an-external-system">
          <h3>{s.systemNames.join("、")} <small>{s.source ?? "OpenAPI の定義の指定なし"}</small></h3>
          {s.status === "no-spec" && <p className="an-hint">相手の定義 (openApiSpec) が指定されていないため、照合できません。</p>}
          {s.status === "url-skipped" && <p className="an-hint">URL で指す定義は取りに行かないため、照合していません。ワークスペース内に JSON を置くと照合できます。</p>}
          {s.status === "error" && <p className="an-alert" role="alert">定義を読めません: {s.error}</p>}
          <AnTable headers={["処理フロー", "呼び出し", "結果"]} rows={s.calls.map((c) => [
            <EntityLink key="f" kind="processFlow" id={c.flow.id}>{c.flow.name}</EntityLink>,
            c.method || c.path ? `${c.method ?? ""} ${c.path ?? ""}` : c.operationId ?? c.systemRef,
            <span key="r" className={c.result === "ok" || c.result === "not-checked" ? "" : "an-warn"}>{RESULT[c.result]}{c.note ? ` (${c.note})` : ""}</span>,
          ])} />
          {s.status === "checked" && <><h4>相手の定義にあるのに、呼んでいない操作 ({s.uncalled.length} 件)</h4>{s.uncalled.length ? <ul className="an-list">{s.uncalled.map((u) => <li key={u}><code>{u}</code></li>)}</ul> : <Empty>すべて呼ばれています。</Empty>}</>}
        </div>
      ))}
    </Section>
  );
}
