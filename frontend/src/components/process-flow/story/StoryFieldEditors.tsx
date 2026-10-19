/**
 * 「流れ」表示で、工程の細かい欄をその場で直す窓: 入力チェックのルール・SQL・承認者と期限・外部システムの呼び方。
 * 触らない項目 (参照・拡張の項目など) は、そのまま残す。仕様: docs/spec/process-flow-story-view.md
 */
import { useMemo, useRef, useState } from "react";
import { isPlainEnter } from "../../../utils/imeKeys";
import { selectColumns } from "./conditionBuilder";
import { StoryPopover } from "./StoryPopover";
import { patchStep } from "./storyEdit";
import { useStoryUi } from "./storyUi";

type Rec = Record<string, unknown>;
const str = (v: unknown): string => (typeof v === "string" ? v : "");

interface PopProps {
  anchor: HTMLElement | null;
  onClose: () => void;
}

// ─── 入力チェックのルール ──────────────────────────────

const RULE_TYPES: Array<{ type: string; label: string }> = [
  { type: "required", label: "必須" },
  { type: "maxLength", label: "最大の長さ" },
  { type: "minLength", label: "最小の長さ" },
  { type: "range", label: "範囲 (数)" },
  { type: "regex", label: "形式 (正規表現)" },
  { type: "enum", label: "選択肢のどれか" },
  { type: "custom", label: "独自の式 (カードで直す)" },
];
const SEVERITIES: Array<{ value: string; label: string }> = [
  { value: "error", label: "エラーにして止める" },
  { value: "msg", label: "知らせるだけ (続行できる)" },
  { value: "noaccept", label: "値を受け付けない" },
  { value: "default", label: "既定値を入れる" },
];
const PARAM_KEYS = ["pattern", "patternRef", "length", "lengthRef", "min", "minRef", "max", "maxRef", "values"];

interface RuleDraft {
  /** もとのルール (触らない項目を残すため) */
  base: Rec;
  field: string;
  type: string;
  severity: string;
  message: string;
  condition: string;
  /** 種類ごとの値: 長さ・最小 (範囲)・形式・選択肢 */
  a: string;
  /** 範囲の最大 */
  b: string;
}

function toDraft(r: Rec): RuleDraft {
  const type = str(r.type) || "required";
  const ref = (v: unknown, refv: unknown) => (v !== undefined ? String(v) : str(refv));
  let a = "";
  let b = "";
  if (type === "maxLength" || type === "minLength") a = ref(r.length, r.lengthRef);
  else if (type === "range") { a = ref(r.min, r.minRef); b = ref(r.max, r.maxRef); }
  else if (type === "regex") a = str(r.pattern) || str(r.patternRef);
  else if (type === "enum") a = Array.isArray(r.values) ? (r.values as unknown[]).map(String).join("、") : "";
  return { base: r, field: str(r.field), type, severity: str(r.severity) || "error", message: str(r.message), condition: str(r.condition), a, b };
}

const isNum = (t: string) => t.trim() !== "" && Number.isFinite(Number(t));

function ruleProblem(d: RuleDraft): string {
  if (!d.field.trim()) return "どの入力かを選んでください";
  if ((d.type === "maxLength" || d.type === "minLength") && !(isNum(d.a) && Number(d.a) >= 0) && !d.a.trim().startsWith("@")) return "長さ (0 以上の数) を入れてください";
  if (d.type === "range") {
    const ok = (t: string) => t.trim() === "" || isNum(t) || t.trim().startsWith("@");
    if (!ok(d.a) || !ok(d.b)) return "最小・最大は、数で入れてください";
    if (d.a.trim() === "" && d.b.trim() === "") return "最小か最大のどちらかを入れてください";
  }
  if (d.type === "regex" && !d.a.trim()) return "形式 (正規表現) を入れてください";
  if (d.type === "enum" && d.a.split(/[、,\n]/).map((x) => x.trim()).filter(Boolean).length === 0) return "選択肢を 1 つ以上入れてください";
  return "";
}

function fromDraft(d: RuleDraft): Rec {
  const r: Rec = { ...d.base, field: d.field.trim(), type: d.type, severity: d.severity };
  const setRef = (key: string, refKey: string, text: string, asNumber: boolean) => {
    const t = text.trim();
    delete r[key];
    delete r[refKey];
    if (!t) return;
    if (t.startsWith("@")) r[refKey] = t;
    else r[key] = asNumber ? Number(t) : t;
  };
  if (d.type !== "custom") {
    for (const k of PARAM_KEYS) delete r[k];
    if (d.type === "maxLength" || d.type === "minLength") setRef("length", "lengthRef", d.a, true);
    else if (d.type === "range") { setRef("min", "minRef", d.a, true); setRef("max", "maxRef", d.b, true); }
    else if (d.type === "regex") setRef("pattern", "patternRef", d.a, false);
    else if (d.type === "enum") r.values = d.a.split(/[、,\n]/).map((x) => x.trim()).filter(Boolean);
  }
  if (d.message.trim()) r.message = d.message.trim();
  else delete r.message;
  if (d.condition.trim()) r.condition = d.condition.trim();
  else delete r.condition;
  return r;
}

export function RulesEditor({ anchor, stepId, onClose }: PopProps & { stepId: string }) {
  const ui = useStoryUi();
  const step = useMemo(() => findStep(ui.ctx.action.steps as unknown as Rec[], stepId), [ui.ctx.action.steps, stepId]);
  const [rules, setRules] = useState<RuleDraft[]>(() => ((step?.rules as Rec[] | undefined) ?? []).map(toDraft));
  const inputs = ui.ctx.action.inputs ?? [];
  const set = (i: number, patch: Partial<RuleDraft>) => setRules((cur) => cur.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const problems = rules.map(ruleProblem);
  const apply = () => {
    if (problems.some(Boolean)) return;
    const next = rules.map(fromDraft);
    ui.edit?.mutate((a) => { patchStep(a.steps, stepId, { rules: next }); });
    onClose();
  };
  return (
    <StoryPopover anchor={anchor} title="入力チェックのルール" onClose={onClose} width={520}>
      {rules.length === 0 && <p className="pfs-note">まだルールがありません。</p>}
      {rules.map((r, i) => (
        <div key={i} className="pfs-rule" data-testid="pfs-rule">
          <div className="pfs-row-fields">
            <input className="pfs-field" aria-label="対象の入力" list="pfs-rule-fields" placeholder="例: customerId (選ぶか、書く)" value={r.field} onChange={(e) => set(i, { field: e.target.value })} />
            <select className="pfs-field" aria-label="ルールの種類" value={r.type} onChange={(e) => set(i, { type: e.target.value, a: "", b: "" })}>
              {RULE_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
            <button type="button" className="pfs-btn" aria-label="このルールを消す" onClick={() => setRules((cur) => cur.filter((_, k) => k !== i))}>×</button>
          </div>
          {(r.type === "maxLength" || r.type === "minLength") && (
            <input className="pfs-field" aria-label="長さ" placeholder="例: 20 (文字数。@conv.limit.x で参照も可)" value={r.a} onChange={(e) => set(i, { a: e.target.value })} />
          )}
          {r.type === "range" && (
            <div className="pfs-row-fields">
              <input className="pfs-field" aria-label="最小" placeholder="最小 (例: 1)" value={r.a} onChange={(e) => set(i, { a: e.target.value })} />
              <input className="pfs-field" aria-label="最大" placeholder="最大 (例: 99)" value={r.b} onChange={(e) => set(i, { b: e.target.value })} />
            </div>
          )}
          {r.type === "regex" && <input className="pfs-field pfs-mono" aria-label="形式" placeholder="例: ^[0-9]{7}$ (@conv.regex.x で参照も可)" value={r.a} onChange={(e) => set(i, { a: e.target.value })} />}
          {r.type === "enum" && <input className="pfs-field" aria-label="選択肢" placeholder="例: 新規、継続、解約 (「、」か「,」で区切る)" value={r.a} onChange={(e) => set(i, { a: e.target.value })} />}
          {r.type === "custom" && <p className="pfs-note">独自の式は、「カードで開く」から直します (ここでは、そのまま残ります)。</p>}
          <div className="pfs-row-fields">
            <select className="pfs-field" aria-label="違反したとき" value={r.severity} onChange={(e) => set(i, { severity: e.target.value })}>
              {SEVERITIES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
            <input className="pfs-field" aria-label="メッセージ" placeholder="メッセージ (例: 取引先IDは必須です)" value={r.message} onChange={(e) => set(i, { message: e.target.value })} />
          </div>
          {problems[i] && <p className="pfs-warn">{problems[i]}</p>}
        </div>
      ))}
      <datalist id="pfs-rule-fields">{inputs.map((x) => <option key={x.name} value={x.name}>{x.label ?? x.name}</option>)}</datalist>
      <div className="pfs-pop-btns is-left">
        <button type="button" className="pfs-btn" onClick={() => setRules((cur) => [...cur, toDraft({ field: inputs[0]?.name ?? "", type: "required", severity: "error" })])} data-testid="pfs-rule-add">＋ ルールを足す</button>
      </div>
      <div className="pfs-pop-btns">
        <button type="button" className="pfs-btn" onClick={onClose}>やめる</button>
        <button type="button" className="pfs-btn is-primary" disabled={problems.some(Boolean)} onClick={apply} data-testid="pfs-rules-apply">決める</button>
      </div>
    </StoryPopover>
  );
}

function findStep(steps: readonly Rec[], id: string): Rec | null {
  for (const s of steps) {
    if (s.id === id) return s;
    for (const k of ["steps", "subSteps", "onCommit", "onRollback", "onApproved", "onRejected", "onTimeout"]) {
      if (Array.isArray(s[k])) { const f = findStep(s[k] as Rec[], id); if (f) return f; }
    }
    for (const b of (Array.isArray(s.branches) ? (s.branches as Rec[]) : [])) { const f = findStep((b.steps as Rec[]) ?? [], id); if (f) return f; }
    const eb = s.elseBranch as Rec | undefined;
    if (eb && Array.isArray(eb.steps)) { const f = findStep(eb.steps as Rec[], id); if (f) return f; }
    const ib = s.inlineBranch as Rec | undefined;
    if (ib) for (const k of ["ok", "ng"]) if (Array.isArray(ib[k])) { const f = findStep(ib[k] as Rec[], id); if (f) return f; }
  }
  return null;
}

// ─── SQL ───────────────────────────────────────────────

export function SqlEditor({ anchor, stepId, onClose }: PopProps & { stepId: string }) {
  const ui = useStoryUi();
  const step = useMemo(() => findStep(ui.ctx.action.steps as unknown as Rec[], stepId), [ui.ctx.action.steps, stepId]);
  const [sql, setSql] = useState(str(step?.sql));
  const ta = useRef<HTMLTextAreaElement>(null);
  const cols = useMemo(() => selectColumns(sql), [sql]);
  const insert = (text: string) => {
    const el = ta.current;
    if (!el) { setSql((s) => `${s}${text}`); return; }
    const a = el.selectionStart ?? sql.length;
    const b = el.selectionEnd ?? sql.length;
    setSql(`${sql.slice(0, a)}${text}${sql.slice(b)}`);
    requestAnimationFrame(() => { el.focus(); el.setSelectionRange(a + text.length, a + text.length); });
  };
  const apply = () => {
    ui.edit?.mutate((a) => { patchStep(a.steps, stepId, { sql: sql.trim() ? sql : undefined }); });
    onClose();
  };
  const nq = str(step?.naturalQuery);
  return (
    <StoryPopover anchor={anchor} title="SQL" onClose={onClose} width={560}>
      {nq && <p className="pfs-note">やりたいこと (自然な言葉): {nq}</p>}
      <textarea ref={ta} className="pfs-field pfs-mono" rows={8} value={sql} spellCheck={false} onChange={(e) => setSql(e.target.value)} aria-label="SQL" placeholder="例: SELECT id, name FROM customers WHERE id = @inputs.customerId" data-testid="pfs-sql" />
      <div className="pfs-row-fields">
        <select className="pfs-field" aria-label="テーブルを入れる" value="" onChange={(e) => { if (e.target.value) insert(e.target.value); }}>
          <option value="">テーブルの物理名を入れる…</option>
          {(ui.edit?.tables ?? []).map((t) => <option key={t.id} value={t.physicalName}>{t.name || t.physicalName} ({t.physicalName})</option>)}
        </select>
        <select className="pfs-field" aria-label="入力を入れる" value="" onChange={(e) => { if (e.target.value) insert(e.target.value); }}>
          <option value="">入力の値を入れる…</option>
          {(ui.ctx.action.inputs ?? []).map((i) => <option key={i.name} value={`@inputs.${i.name}`}>{i.label ?? i.name} (@inputs.{i.name})</option>)}
        </select>
      </div>
      {cols.length > 0 && <p className="pfs-note">結果の列: {cols.join(", ")} (条件の候補に出ます)</p>}
      <div className="pfs-pop-btns">
        <button type="button" className="pfs-btn" onClick={onClose}>やめる</button>
        <button type="button" className="pfs-btn is-primary" onClick={apply} data-testid="pfs-sql-apply">決める</button>
      </div>
    </StoryPopover>
  );
}

// ─── 承認者と期限 ──────────────────────────────────────

interface ApproverDraft { base: Rec; role: string; label: string }

export function ApproversEditor({ anchor, stepId, onClose }: PopProps & { stepId: string }) {
  const ui = useStoryUi();
  const step = useMemo(() => findStep(ui.ctx.action.steps as unknown as Rec[], stepId), [ui.ctx.action.steps, stepId]);
  const [list, setList] = useState<ApproverDraft[]>(() => ((step?.approvers as Rec[] | undefined) ?? []).map((a) => ({ base: a, role: str(a.role), label: str(a.label) })));
  const [deadline, setDeadline] = useState(str(step?.deadlineExpression));
  const set = (i: number, patch: Partial<ApproverDraft>) => setList((cur) => cur.map((a, k) => (k === i ? { ...a, ...patch } : a)));
  const problem = list.length === 0 ? "承認者を 1 人以上入れてください" : list.some((a) => !a.role.trim()) ? "役割を入れてください (例: @conv.role.manager)" : "";
  const apply = () => {
    if (problem) return;
    const approvers = list.map((a) => { const r: Rec = { ...a.base, role: a.role.trim() }; if (a.label.trim()) r.label = a.label.trim(); else delete r.label; return r; });
    ui.edit?.mutate((x) => { patchStep(x.steps, stepId, { approvers, deadlineExpression: deadline.trim() ? deadline.trim() : undefined }); });
    onClose();
  };
  return (
    <StoryPopover anchor={anchor} title="承認者と期限" onClose={onClose} width={460}>
      {list.map((a, i) => (
        <div key={i} className="pfs-row-fields" data-testid="pfs-approver">
          <input className="pfs-field" aria-label="役割" placeholder="役割 (例: @conv.role.manager)" value={a.role} onChange={(e) => set(i, { role: e.target.value })} />
          <input className="pfs-field" aria-label="呼び名" placeholder="呼び名 (例: 営業部長)" value={a.label} onChange={(e) => set(i, { label: e.target.value })} />
          <button type="button" className="pfs-btn" aria-label="この承認者を外す" onClick={() => setList((cur) => cur.filter((_, k) => k !== i))}>×</button>
        </div>
      ))}
      <div className="pfs-pop-btns is-left"><button type="button" className="pfs-btn" onClick={() => setList((cur) => [...cur, { base: {}, role: "", label: "" }])} data-testid="pfs-approver-add">＋ 承認者を足す</button></div>
      <label className="pfs-label">期限 (式。例: now() + 3 日。空なら期限なし)</label>
      <input className="pfs-field pfs-mono" aria-label="期限" value={deadline} onChange={(e) => setDeadline(e.target.value)} onKeyDown={(e) => { if (isPlainEnter(e)) apply(); }} />
      <p className="pfs-note">承認の種類 (順番・同時・定足数など) と、エスカレーションは、「カードで開く」から直します。</p>
      {problem && <p className="pfs-warn">{problem}</p>}
      <div className="pfs-pop-btns">
        <button type="button" className="pfs-btn" onClick={onClose}>やめる</button>
        <button type="button" className="pfs-btn is-primary" disabled={Boolean(problem)} onClick={apply} data-testid="pfs-approvers-apply">決める</button>
      </div>
    </StoryPopover>
  );
}

// ─── 外部システムの呼び方 ──────────────────────────────

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];

export function ExternalEditor({ anchor, stepId, onClose }: PopProps & { stepId: string }) {
  const ui = useStoryUi();
  const step = useMemo(() => findStep(ui.ctx.action.steps as unknown as Rec[], stepId), [ui.ctx.action.steps, stepId]);
  const http = (step?.httpCall as Rec | undefined) ?? null;
  const [systemRef, setSystemRef] = useState(str(step?.systemRef));
  const [useHttp, setUseHttp] = useState(Boolean(http));
  const [method, setMethod] = useState(str(http?.method) || "POST");
  const [path, setPath] = useState(str(http?.path));
  const [timeoutSec, setTimeoutSec] = useState(typeof step?.timeoutMs === "number" ? String(step.timeoutMs / 1000) : "");
  const [forget, setForget] = useState(Boolean(step?.fireAndForget));
  const problem = !systemRef.trim() ? "接続先の名前を入れてください (例: paymentGateway)" : useHttp && !path.trim() ? "パス (例: /v1/charges) を入れてください" : timeoutSec.trim() && !(Number(timeoutSec) >= 0) ? "待つ秒数は、数で入れてください" : "";
  const apply = () => {
    if (problem) return;
    ui.edit?.mutate((a) => {
      patchStep(a.steps, stepId, {
        systemRef: systemRef.trim(),
        httpCall: useHttp ? { ...(http ?? {}), method, path: path.trim() } : http ?? undefined,
        timeoutMs: timeoutSec.trim() ? Math.round(Number(timeoutSec) * 1000) : undefined,
        fireAndForget: forget ? true : undefined,
      });
    });
    onClose();
  };
  return (
    <StoryPopover anchor={anchor} title="外部システムの呼び方" onClose={onClose} width={440}>
      <label className="pfs-label">接続先 (外部システムの名前)</label>
      <input className="pfs-field" aria-label="接続先" placeholder="例: paymentGateway" value={systemRef} onChange={(e) => setSystemRef(e.target.value)} />
      <label className="pfs-label"><input type="checkbox" checked={useHttp} onChange={(e) => setUseHttp(e.target.checked)} /> HTTP の呼び方を、ここで決める</label>
      {useHttp && (
        <div className="pfs-row-fields">
          <select className="pfs-field is-inline" aria-label="メソッド" value={method} onChange={(e) => setMethod(e.target.value)}>{HTTP_METHODS.map((m) => <option key={m} value={m}>{m}</option>)}</select>
          <input className="pfs-field" aria-label="パス" placeholder="例: /v1/charges" value={path} onChange={(e) => setPath(e.target.value)} />
        </div>
      )}
      <div className="pfs-row-fields">
        <input className="pfs-field" aria-label="待つ秒数" placeholder="待つ秒数 (例: 5。空なら既定)" value={timeoutSec} onChange={(e) => setTimeoutSec(e.target.value)} />
        <label className="pfs-label"><input type="checkbox" checked={forget} onChange={(e) => setForget(e.target.checked)} /> 返事は待たない</label>
      </div>
      <p className="pfs-note">リクエストの中身・認証・サーキットブレーカなどは、「カードで開く」から直します。</p>
      {problem && <p className="pfs-warn">{problem}</p>}
      <div className="pfs-pop-btns">
        <button type="button" className="pfs-btn" onClick={onClose}>やめる</button>
        <button type="button" className="pfs-btn is-primary" disabled={Boolean(problem)} onClick={apply} data-testid="pfs-external-apply">決める</button>
      </div>
    </StoryPopover>
  );
}
