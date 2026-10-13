/**
 * ルール。命名規約 (規約カタログの正規表現・DB 規約の既定) の設定状況と、プロジェクト独自の検査ルールの編集。
 * 独自ルールは、対象の種類・項目の場所・条件を宣言する形 (任意のコードは書けない)。保存前に、いまの設計への当てはまり (試し打ち) を見られる。
 */
import { useMemo, useState } from "react";
import { checkRegexSafety, conventionPattern, customRuleIssues, NAMING_KEYS, parseCheckSettings, RULE_TARGETS, RULE_TARGET_LABELS, type CheckSettings, type CustomRule, type DesignDocInput, type NamingKey, type RuleCheck } from "@harmony/shared";
import { useNavigate } from "react-router-dom";
import { useWorkspacePath } from "../../../hooks/useWorkspacePath";
import { mcpBridge } from "../../../mcp/mcpBridge";
import { reportFailure } from "../../../utils/failureToast";
import { showToast } from "../../../utils/toast";
import { AnTable, Empty, Section } from "../ui";

const CHECK_LABELS: Record<RuleCheck["type"], string> = { required: "必要 (空でない)", forbidden: "書かない (空である)", pattern: "形式 (正規表現)", oneOf: "候補のどれか", range: "数の範囲" };
const blank = (n: number): CustomRule => ({ id: `rule-${n}`, name: "", target: "table", path: "description", check: { type: "required" }, severity: "warning" });

function checkWith(type: RuleCheck["type"], prev: RuleCheck): RuleCheck {
  if (type === prev.type) return prev;
  switch (type) {
    case "pattern": return { type, pattern: "" };
    case "oneOf": return { type, values: [] };
    case "range": return { type };
    default: return { type } as RuleCheck;
  }
}

export function RulesTab({ input, settings, problems, reload }: { input: DesignDocInput; settings: CheckSettings; problems: string[]; reload: () => void }) {
  const navigate = useNavigate();
  const { wsPath } = useWorkspacePath();
  const [rules, setRules] = useState<CustomRule[]>(settings.rules);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dirty = JSON.stringify(rules) !== JSON.stringify(settings.rules);

  const dbDefault = Object.values(input.db ?? {}).find((d) => d.default) ?? (Object.values(input.db ?? {}).length === 1 ? Object.values(input.db ?? {})[0] : undefined);
  const conv = conventionPattern(dbDefault?.namingConvention);
  const naming = (Object.keys(NAMING_KEYS) as NamingKey[]).map((k) => {
    const e = input.regex?.[k] as { pattern?: string; description?: string } | undefined;
    const bad = e?.pattern ? checkRegexSafety(e.pattern) : null;
    const viaDb = !e?.pattern && conv && (k === "namingTable" || k === "namingColumn");
    return { key: k, what: NAMING_KEYS[k], status: bad ? `使えません: ${bad}` : e?.pattern ? `設定済み: ${e.pattern}${e.description ? ` (${e.description})` : ""}` : viaDb ? `DB 規約の既定: ${conv!.label}` : "未設定" };
  });

  // 試し打ち: 編集中のルールを、いまの設計に当てた結果 (保存はしない)
  const preview = useMemo(() => {
    const parsed = parseCheckSettings({ version: 1, suppressions: [], rules });
    const issues = customRuleIssues({ ...input, checkSettings: parsed.settings });
    return { problems: parsed.problems, issues };
  }, [input, rules]);

  const update = (i: number, patch: Partial<CustomRule>) => setRules((rs) => rs.map((r, k) => (k === i ? { ...r, ...patch } : r)));
  const save = async () => {
    // 読めない項目があるファイルは、そのままでは書けない。捨てることを承知したときだけ、読めない項目を捨てて書く
    const discard = problems.length > 0;
    if (discard && !window.confirm(`design-check.json の次の項目は読めないため、保存すると失われます。\n\n${problems.join("\n")}\n\n捨てて保存しますか?`)) return;
    setBusy(true); setError(null);
    try { await mcpBridge.request("designCheck.saveRules", { rules, ...(discard ? { discardUnreadable: true } : {}) }); showToast("ルールを保存しました"); reload(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); reportFailure(e, "ルールの保存"); }
    finally { setBusy(false); }
  };

  return (
    <div className="an-pane" data-testid="an-rules">
      {problems.length > 0 && <p className="an-alert" role="alert" data-testid="an-rules-unreadable">design-check.json に読めない項目があります (読めない項目は、適用されていません): {problems.join(" / ")}。ファイルを直すか、ここで保存すると、読めない項目を捨てて書き直します (確認があります)。</p>}
      <Section title="命名規約" hint="規約カタログの正規表現 (@conv.regex.<キー>) で決めます。接頭辞の規約も、正規表現 (例: ^m_) で書けます。違反は要確認に出ます。" testId="an-naming"
        actions={<button type="button" className="an-btn" onClick={() => navigate(wsPath("/conventions/catalog"))}>規約カタログを開く</button>}>
        <AnTable headers={["対象", "規約カタログのキー", "状況"]} rows={naming.map((n) => [n.what, <code key="k">@conv.regex.{n.key}</code>, n.status])} />
      </Section>

      <Section title={`独自の検査ルール (${rules.length} 件)`} hint="対象の種類・項目の場所・条件を宣言して、プロジェクト独自の検査を足します。" testId="an-custom-rules"
        actions={<><button type="button" className="an-btn" onClick={() => setRules((rs) => [...rs, blank(rs.length + 1)])} data-testid="an-rule-add"><i className="bi bi-plus-lg" /> ルールを足す</button>
          <button type="button" className="an-btn primary" disabled={busy || (!dirty && problems.length === 0) || preview.problems.length > 0} onClick={() => void save()} data-testid="an-rules-save">保存</button></>}>
        {error && <p className="an-alert" role="alert">{error}</p>}
        {rules.length === 0 && <Empty>ルールはありません。「ルールを足す」で、例えば「テーブルには説明が必須」を決められます。</Empty>}
        {rules.map((r, i) => (
          <fieldset key={i} className="an-rule" data-testid="an-rule">
            <legend>{r.name || `ルール ${i + 1}`}</legend>
            <div className="an-form-row">
              <label>ID<input className="an-input" value={r.id} onChange={(e) => update(i, { id: e.target.value })} /></label>
              <label>名前<input className="an-input" value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder="例: テーブルの説明は必須" data-testid="an-rule-name" /></label>
              <label>対象<select className="an-input" value={r.target} onChange={(e) => update(i, { target: e.target.value as CustomRule["target"] })}>{RULE_TARGETS.map((t) => <option key={t} value={t}>{RULE_TARGET_LABELS[t]}</option>)}</select></label>
              <label>項目の場所<input className="an-input" value={r.path} onChange={(e) => update(i, { path: e.target.value })} placeholder="例: description / meta.maturity" data-testid="an-rule-path" /></label>
            </div>
            <div className="an-form-row">
              <label>条件<select className="an-input" value={r.check.type} onChange={(e) => update(i, { check: checkWith(e.target.value as RuleCheck["type"], r.check) })} data-testid="an-rule-check">{(Object.keys(CHECK_LABELS) as RuleCheck["type"][]).map((t) => <option key={t} value={t}>{CHECK_LABELS[t]}</option>)}</select></label>
              {r.check.type === "pattern" && <label>正規表現<input className="an-input" value={r.check.pattern} onChange={(e) => update(i, { check: { type: "pattern", pattern: e.target.value } })} placeholder="例: ^[a-z]+$" /></label>}
              {r.check.type === "oneOf" && <label>候補 (カンマ区切り)<input className="an-input" value={r.check.values.join(",")} onChange={(e) => update(i, { check: { type: "oneOf", values: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) } })} placeholder="例: draft,committed" /></label>}
              {r.check.type === "range" && <><label>最小<input className="an-input" type="number" value={r.check.min ?? ""} onChange={(e) => update(i, { check: { ...r.check, type: "range", min: e.target.value === "" ? undefined : Number(e.target.value) } as RuleCheck })} /></label>
                <label>最大<input className="an-input" type="number" value={r.check.max ?? ""} onChange={(e) => update(i, { check: { ...r.check, type: "range", max: e.target.value === "" ? undefined : Number(e.target.value) } as RuleCheck })} /></label></>}
              <label>重大度<select className="an-input" value={r.severity} onChange={(e) => update(i, { severity: e.target.value as CustomRule["severity"] })}><option value="error">エラー</option><option value="warning">警告</option><option value="info">情報</option></select></label>
              <label className="an-check"><input type="checkbox" checked={r.enabled !== false} onChange={(e) => update(i, { enabled: e.target.checked ? undefined : false })} /> 有効</label>
              <button type="button" className="an-btn danger" onClick={() => setRules((rs) => rs.filter((_, k) => k !== i))}>削除</button>
            </div>
            <div className="an-form-row">
              <label>適用の条件 (項目の場所)<input className="an-input" value={r.when?.path ?? ""} onChange={(e) => update(i, { when: e.target.value ? { ...(r.when ?? { path: "" }), path: e.target.value } : undefined })} placeholder="例: meta.maturity (省略 = すべてに適用)" /></label>
              {r.when && <label>等しい値<input className="an-input" value={String(r.when.equals ?? "")} onChange={(e) => update(i, { when: { path: r.when!.path, ...(e.target.value ? { equals: e.target.value } : { notEmpty: true }) } })} placeholder="例: committed (空 = 値がある場合)" /></label>}
              <label>違反の文言 (省略可)<input className="an-input" value={r.message ?? ""} onChange={(e) => update(i, { message: e.target.value || undefined })} /></label>
            </div>
          </fieldset>
        ))}
        {preview.problems.length > 0 && <p className="an-alert" role="alert" data-testid="an-rules-problems">{preview.problems.join(" / ")}</p>}
        {rules.length > 0 && preview.problems.length === 0 && (
          <p className="an-hint" data-testid="an-rules-preview">試し打ち: いまの設計に当てると、{preview.issues.length} 件の違反が出ます{dirty ? " (まだ保存していません)" : ""}。{preview.issues.slice(0, 3).map((i, k) => <span key={k}> / {i.message}</span>)}</p>
        )}
        <p className="an-hint">項目の場所は、対象の JSON の中の場所です (例: テーブルの <code>description</code>、処理フローの <code>meta.maturity</code>、カラムの <code>length</code>)。ルールは <code>design-check.json</code> に保存され、npm run check:design・MCP の点検にも効きます。</p>
      </Section>
    </div>
  );
}
