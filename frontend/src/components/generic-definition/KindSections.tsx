/**
 * 汎用定義の、種類ごとの入力欄 (#1499): 状態遷移 (状態・遷移)・初期データ (テーブル・行)・非機能要件 (目標値・処理フロー)・ジョブ (時刻・再実行・処理フロー)。
 * 共通の欄 (目的・責務・フィールド ほか) は GenericDefinitionEditor が持つ。仕様: docs/spec/generic-definition-layer.md §4.2.1
 */
import { useState, type CSSProperties, type ReactNode } from "react";
import type { GenericDefinition, GenericMeasure, GenericRetry, GenericSchedule, GenericState, GenericTransition } from "../../types/v3/generic-definition";
import { useWorkspaceReferences } from "../../hooks/useWorkspaceReferences";

const input: CSSProperties = { width: "100%", border: "1px solid var(--hm-border-strong)", borderRadius: "4px", padding: "6px 10px", fontSize: "0.88rem" };
const th: CSSProperties = { textAlign: "left", fontSize: "0.8rem", color: "var(--hm-fg-muted)", padding: "4px 6px", fontWeight: 600 };
const td: CSSProperties = { padding: "3px 4px", verticalAlign: "top" };
const h3: CSSProperties = { fontSize: "1rem", marginBottom: "4px" };
const hint: CSSProperties = { fontSize: "0.8rem", color: "var(--hm-fg-muted)", fontWeight: "normal", marginLeft: "8px" };

type Update = (fn: (d: GenericDefinition) => GenericDefinition) => void;
interface Props { def: GenericDefinition; updateDef: Update; renderIssues: (paths: string[]) => ReactNode }

function Section({ title, hintText, children }: { title: string; hintText?: string; children: ReactNode }) {
  return <section style={{ marginBottom: "24px" }}><h3 style={h3}>{title}{hintText && <span style={hint}>{hintText}</span>}</h3>{children}</section>;
}

/** 状態の名前の選び (遷移の from / to) */
function StateSelect({ value, states, label, onChange }: { value: string; states: GenericState[]; label: string; onChange: (v: string) => void }) {
  return (
    <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)} style={input}>
      <option value="">（選ぶ）</option>
      {states.map((s) => <option key={s.name} value={s.name}>{s.label ? `${s.label} (${s.name})` : s.name}</option>)}
      {value && !states.some((s) => s.name === value) && <option value={value}>{value} (定義にない状態)</option>}
    </select>
  );
}

function StateMachineSection({ def, updateDef, renderIssues }: Props) {
  const refs = useWorkspaceReferences();
  const states = def.states ?? [];
  const transitions = def.transitions ?? [];
  const setStates = (next: GenericState[]) => updateDef((p) => ({ ...p, states: next }));
  const setTransitions = (next: GenericTransition[]) => updateDef((p) => ({ ...p, transitions: next }));
  const patchState = (i: number, patch: Partial<GenericState>) => {
    const old = states[i]?.name;
    const next = states.map((s, j) => (j === i ? { ...s, ...patch } : s));
    // 状態の名前を変えたら、その状態を指す遷移も追わせる (空の名前だったときは、まだ指されていない)
    if (patch.name !== undefined && old && patch.name !== old) {
      updateDef((p) => ({ ...p, states: next, transitions: (p.transitions ?? []).map((t) => ({ ...t, from: t.from === old ? patch.name! : t.from, to: t.to === old ? patch.name! : t.to })) }));
    } else setStates(next);
  };
  const patchTr = (i: number, patch: Partial<GenericTransition>) => setTransitions(transitions.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  const stripEmpty = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== false)) as T;
  return (
    <>
      <Section title="状態 (states)" hintText="最初の状態は 1 つ。終わりの状態からは遷移しない">
        {renderIssues(["states"])}
        {states.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="gd-states">
            <thead><tr><th style={th}>名前 (コードの値)</th><th style={th}>呼び名</th><th style={th}>最初</th><th style={th}>終わり</th><th style={th}>説明</th><th style={th} /></tr></thead>
            <tbody>
              {states.map((s, i) => (
                <tr key={i}>
                  <td style={td}><input aria-label={`状態 ${i + 1} の名前`} value={s.name} onChange={(e) => patchState(i, { name: e.target.value })} style={input} placeholder="例: Ordered" /></td>
                  <td style={td}><input aria-label={`状態 ${i + 1} の呼び名`} value={s.label ?? ""} onChange={(e) => patchState(i, { label: e.target.value || undefined })} style={input} placeholder="例: 注文済み" /></td>
                  <td style={td}><input type="checkbox" aria-label={`状態 ${i + 1} は最初の状態`} checked={s.initial === true} onChange={(e) => setStates(states.map((x, j) => (j === i ? stripEmpty({ ...x, initial: e.target.checked }) : e.target.checked ? stripEmpty({ ...x, initial: false }) : x)))} /></td>
                  <td style={td}><input type="checkbox" aria-label={`状態 ${i + 1} は終わりの状態`} checked={s.final === true} onChange={(e) => patchState(i, { final: e.target.checked || undefined })} /></td>
                  <td style={td}><input aria-label={`状態 ${i + 1} の説明`} value={s.description ?? ""} onChange={(e) => patchState(i, { description: e.target.value || undefined })} style={input} /></td>
                  <td style={td}><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setStates(states.filter((_, j) => j !== i))}>削除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="btn btn-outline-primary btn-sm" data-testid="gd-add-state" onClick={() => setStates([...states, { name: "" }])}>+ 状態を足す</button>
      </Section>
      <Section title="遷移 (transitions)" hintText="どの契機で、どの状態からどの状態へ。遷移を起こす処理フローを結びつける">
        {renderIssues(["transitions"])}
        {transitions.length > 0 && (
          <table style={{ width: "100%", borderCollapse: "collapse" }} data-testid="gd-transitions">
            <thead><tr><th style={th}>元の状態</th><th style={th}>先の状態</th><th style={th}>契機</th><th style={th}>条件</th><th style={th}>処理フロー</th><th style={th} /></tr></thead>
            <tbody>
              {transitions.map((t, i) => (
                <tr key={i}>
                  <td style={td}><StateSelect label={`遷移 ${i + 1} の元の状態`} value={t.from} states={states} onChange={(v) => patchTr(i, { from: v })} /></td>
                  <td style={td}><StateSelect label={`遷移 ${i + 1} の先の状態`} value={t.to} states={states} onChange={(v) => patchTr(i, { to: v })} /></td>
                  <td style={td}><input aria-label={`遷移 ${i + 1} の契機`} value={t.trigger} onChange={(e) => patchTr(i, { trigger: e.target.value })} style={input} placeholder="例: 出荷を確定する" /></td>
                  <td style={td}><input aria-label={`遷移 ${i + 1} の条件`} value={t.guard ?? ""} onChange={(e) => patchTr(i, { guard: e.target.value || undefined })} style={input} placeholder="例: 在庫が引き当て済み" /></td>
                  <td style={td}>
                    <select aria-label={`遷移 ${i + 1} の処理フロー`} value={t.processFlowId ?? ""} onChange={(e) => patchTr(i, { processFlowId: e.target.value || undefined, actionId: undefined })} style={input}>
                      <option value="">（なし）</option>
                      {refs.processFlows.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
                      {t.processFlowId && !refs.processFlows.some((f) => f.id === t.processFlowId) && <option value={t.processFlowId}>{t.processFlowId} (見つからない)</option>}
                    </select>
                  </td>
                  <td style={td}><button type="button" className="btn btn-outline-secondary btn-sm" onClick={() => setTransitions(transitions.filter((_, j) => j !== i))}>削除</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <button type="button" className="btn btn-outline-primary btn-sm" data-testid="gd-add-transition" onClick={() => setTransitions([...transitions, { from: "", to: "", trigger: "" }])}>+ 遷移を足す</button>
      </Section>
    </>
  );
}

function SeedDataSection({ def, updateDef, renderIssues }: Props) {
  const refs = useWorkspaceReferences();
  const table = refs.tables.find((t) => t.id === def.tableId);
  const rows = def.rows ?? [];
  // 行は JSON の配列で直す (列がテーブルごとに違うため)。不正な JSON は、直るまで画面の中に置く
  const text = JSON.stringify(rows, null, 2);
  return (
    <Section title="初期データ" hintText="テーブルに最初から入れておく行。キーはカラムの id か物理名">
      {renderIssues(["tableId", "rows"])}
      <label style={{ display: "block", marginBottom: "8px" }}>
        <span style={{ display: "block", fontSize: "0.85rem", marginBottom: "2px" }}>対象のテーブル</span>
        <select aria-label="対象のテーブル" value={def.tableId ?? ""} onChange={(e) => updateDef((p) => ({ ...p, tableId: e.target.value || undefined }))} style={{ ...input, maxWidth: "420px" }}>
          <option value="">（選ぶ）</option>
          {refs.tables.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.physicalName})</option>)}
          {def.tableId && !table && <option value={def.tableId}>{def.tableId} (見つからない)</option>}
        </select>
      </label>
      {table?.columns && <p style={{ fontSize: "0.8rem", color: "var(--hm-fg-muted)" }}>カラム: {table.columns.map((c) => `${c.physicalName}${c.primaryKey ? " (PK)" : ""}${c.notNull ? " *" : ""}`).join("、")} (* は必須)</p>}
      <RowsEditor key={text} text={text} onApply={(parsed) => updateDef((p) => ({ ...p, rows: parsed }))} />
    </Section>
  );
}

/** 行の JSON の入力。反映するのは、欄を出るとき。直るまでは、書いた文字を残して、理由を出す。行が外から変わったら (取り消しなど)、作り直して追わせる (呼ぶ側の key) */
function RowsEditor({ text, onApply }: { text: string; onApply: (rows: Array<Record<string, unknown>>) => void }) {
  const [error, setError] = useState("");
  return (
    <>
      <textarea
        aria-label="初期データの行 (JSON)"
        data-testid="gd-seed-rows"
        defaultValue={text}
        onBlur={(e) => {
          let parsed: unknown;
          try { parsed = JSON.parse(e.target.value.trim() || "[]"); } catch (err) { setError(`JSON として読めません: ${err instanceof Error ? err.message : String(err)}`); return; }
          if (!Array.isArray(parsed) || !parsed.every((r) => r && typeof r === "object" && !Array.isArray(r))) { setError("行は、{ カラム: 値 } の形の配列にしてください (反映していません)"); return; }
          setError("");
          onApply(parsed as Array<Record<string, unknown>>);
        }}
        rows={10}
        style={{ ...input, resize: "vertical", fontFamily: "monospace", fontSize: "0.82rem" }}
        placeholder={'例:\n[\n  { "code": "TOKYO", "name": "東京倉庫" },\n  { "code": "OSAKA", "name": "大阪倉庫" }\n]'}
      />
      {error && <p role="alert" data-testid="gd-seed-error" style={{ color: "color-mix(in srgb, var(--hm-hue-red) 80%, var(--hm-fg))", fontSize: "0.85rem", margin: "4px 0 0" }}>{error}</p>}
    </>
  );
}

function RequirementSection({ def, updateDef, renderIssues }: Props) {
  const refs = useWorkspaceReferences();
  const m: Partial<GenericMeasure> = def.measure ?? {};
  const set = (patch: Partial<GenericMeasure>) => updateDef((p) => ({ ...p, measure: { metric: "", operator: "<=", value: 0, ...p.measure, ...patch } }));
  const unset = def.measure === undefined; // 未設定のうちは、空で見せる (入れた値だけが定義になる)
  return (
    <Section title="目標値 (measure)" hintText="何を・どの水準で。対象の処理フローを結びつけると、SLA の宣言の有無を点検する">
      {renderIssues(["measure", "processFlowId"])}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", maxWidth: "820px" }}>
        <label>測るもの<input aria-label="測るもの" value={m.metric ?? ""} onChange={(e) => set({ metric: e.target.value })} style={input} placeholder="例: 応答時間" /></label>
        <label>比べ方
          <select aria-label="比べ方" value={m.operator ?? ""} onChange={(e) => set({ operator: e.target.value as GenericMeasure["operator"] })} style={input}>
            {unset && <option value="">（選ぶ）</option>}
            {["<=", "<", ">=", ">", "=="].map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>
        <label>目標値<input aria-label="目標値" type="number" value={unset ? "" : m.value ?? ""} onChange={(e) => set({ value: Number(e.target.value) })} style={input} /></label>
        <label>単位<input aria-label="単位" value={m.unit ?? ""} onChange={(e) => set({ unit: e.target.value || undefined })} style={input} placeholder="例: ms" /></label>
        <label>パーセンタイル<input aria-label="パーセンタイル" value={m.percentile ?? ""} onChange={(e) => set({ percentile: e.target.value || undefined })} style={input} placeholder="例: p95" /></label>
      </div>
      <label style={{ display: "block", marginTop: "10px", maxWidth: "420px" }}>対象の処理フロー
        <select aria-label="対象の処理フロー" value={def.processFlowId ?? ""} onChange={(e) => updateDef((p) => ({ ...p, processFlowId: e.target.value || undefined }))} style={input}>
          <option value="">（なし）</option>
          {refs.processFlows.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
          {def.processFlowId && !refs.processFlows.some((f) => f.id === def.processFlowId) && <option value={def.processFlowId}>{def.processFlowId} (見つからない)</option>}
        </select>
      </label>
    </Section>
  );
}

function JobSection({ def, updateDef, renderIssues }: Props) {
  const refs = useWorkspaceReferences();
  const s: Partial<GenericSchedule> = def.schedule ?? {};
  const r: Partial<GenericRetry> = def.retry ?? {};
  const setS = (patch: Partial<GenericSchedule>) => updateDef((p) => ({ ...p, schedule: { kind: "cron", ...p.schedule, ...patch } }));
  const setR = (patch: Partial<GenericRetry>) => updateDef((p) => ({ ...p, retry: { maxAttempts: 3, ...p.retry, ...patch } }));
  return (
    <>
      <Section title="実行の時刻 (schedule)" hintText="cron は 5 つの欄 (分 時 日 月 曜日)。例: 0 2 * * *">
        {renderIssues(["schedule", "processFlowId"])}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: "8px", maxWidth: "820px" }}>
          <label>種類
            <select aria-label="実行の種類" value={s.kind ?? ""} onChange={(e) => setS({ kind: e.target.value as GenericSchedule["kind"], expression: undefined })} style={input}>
              {!s.kind && <option value="">（選ぶ）</option>}
              <option value="cron">cron (時刻の式)</option><option value="interval">interval (一定の間隔)</option><option value="event">event (出来事を契機に)</option><option value="manual">manual (手で起動)</option>
            </select>
          </label>
          <label>式・間隔・出来事<input aria-label="実行の式" value={s.expression ?? ""} onChange={(e) => setS({ expression: e.target.value || undefined })} style={input} placeholder="例: 0 2 * * *" /></label>
          <label>タイムゾーン<input aria-label="タイムゾーン" value={s.timezone ?? ""} onChange={(e) => setS({ timezone: e.target.value || undefined })} style={input} placeholder="例: Asia/Tokyo" /></label>
        </div>
        <label style={{ display: "block", marginTop: "10px", maxWidth: "420px" }}>実行する処理フロー
          <select aria-label="実行する処理フロー" value={def.processFlowId ?? ""} onChange={(e) => updateDef((p) => ({ ...p, processFlowId: e.target.value || undefined }))} style={input}>
            <option value="">（選ぶ）</option>
            {refs.processFlows.map((f) => <option key={f.id} value={f.id}>{f.name} ({f.id})</option>)}
            {def.processFlowId && !refs.processFlows.some((f) => f.id === def.processFlowId) && <option value={def.processFlowId}>{def.processFlowId} (見つからない)</option>}
          </select>
        </label>
      </Section>
      <Section title="再実行の方針 (retry)" hintText="失敗したときに、何回まで・どんな間隔で試すか">
        {renderIssues(["retry"])}
        <label style={{ display: "block", marginBottom: "6px" }}>
          <input type="checkbox" aria-label="失敗したら再実行する" checked={def.retry !== undefined} onChange={(e) => (e.target.checked ? setR({}) : updateDef((p) => { const { retry: _, ...rest } = p; return rest as GenericDefinition; }))} /> 失敗したら再実行する
        </label>
        {def.retry !== undefined && <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: "8px", maxWidth: "620px" }}>
          <label>最大の試行の回数<input aria-label="最大の試行の回数" type="number" min={1} defaultValue={r.maxAttempts ?? ""} key={r.maxAttempts} onChange={(e) => { const n = Number(e.target.value); if (e.target.value !== "" && Number.isInteger(n) && n >= 1) setR({ maxAttempts: n }); }} style={input} /></label>
          <label>間隔の取り方
            <select aria-label="間隔の取り方" value={r.backoff ?? "none"} onChange={(e) => setR({ backoff: e.target.value as GenericRetry["backoff"] })} style={input}>
              <option value="none">なし</option><option value="fixed">一定</option><option value="exponential">だんだん長く</option>
            </select>
          </label>
          <label>最初の間隔 (秒)<input aria-label="最初の間隔" type="number" min={0} value={r.intervalSeconds ?? ""} onChange={(e) => setR({ intervalSeconds: e.target.value === "" ? undefined : Number(e.target.value) })} style={input} /></label>
        </div>}
      </Section>
    </>
  );
}

/** 種類ごとの入力欄 (該当しない種類では何も出さない) */
export function KindSections(props: Props) {
  switch (props.def.kind) {
    case "state-machine": return <StateMachineSection {...props} />;
    case "seed-data": return <SeedDataSection {...props} />;
    case "requirement": return <RequirementSection {...props} />;
    case "job-definition": return <JobSection {...props} />;
    default: return null;
  }
}
