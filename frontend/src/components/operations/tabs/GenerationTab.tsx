/** 生成の管理: AI が記録した「どの設計からどのファイルを作ったか」と、いまの設計・ファイルとの突き合わせ。設計が変わったときの再生成の差分 */
import { useState } from "react";
import { DRIFT_LABELS, OPS_ENTITY_LABELS, type DriftState } from "@harmony/shared";
import { AnTable, EntityLink, Section } from "../../analysis/ui";
import { reportFailure } from "../../../utils/failureToast";
import { opsApi, type RegenDiff } from "../../../utils/opsApi";
import { useLoad } from "../useLoad";
import { formatTime } from "../reviewUtils";

const TYPE_LABELS = { added: "追加", removed: "削除", changed: "変更" } as const;

export function GenerationTab() {
  const status = useLoad(opsApi.generationStatus);
  const [diffs, setDiffs] = useState<Record<string, RegenDiff | null>>({});
  const [open, setOpen] = useState<string | null>(null);
  const rows = status.data?.rows ?? [];
  const attention = rows.filter((r) => r.state !== "current").length;
  const show = async (path: string) => {
    if (open === path) { setOpen(null); return; }
    setOpen(path);
    if (diffs[path] === undefined) {
      try { const r = await opsApi.generationDiff(path); setDiffs((d) => ({ ...d, [path]: r.diffs[0] ?? null })); } catch (e) { reportFailure(e, "再生成の差分の取得"); setOpen(null); }
    }
  };
  const diff = open ? diffs[open] : undefined;
  return (
    <div className="an-pane" data-testid="op-generation">
      <Section title="生成物と設計の突き合わせ" testId="op-generation-section"
        hint="AI がコードを生成したとき、元にした設計 (の版) と生成したファイルを記録します (AI は designer__record_generation を使います)。ここでは、いまの設計とファイルを突き合わせて、再生成が要るもの・生成物が書き換えられたものを示します。">
        {status.error ? <p className="an-alert" role="alert">{status.error}</p> : null}
        {status.data?.problems.map((p) => <p key={p} className="an-alert" role="alert">{p}</p>)}
        {rows.length > 0 && <p className={attention ? "an-warn" : "an-hint"} data-testid="op-generation-summary">{attention ? `${attention} 件が、確認を要します (全 ${rows.length} 件)` : `すべて最新です (全 ${rows.length} 件)`}</p>}
        <AnTable testId="op-generation-table" headers={["生成物", "状態", "変わった設計", "記録した日時", ""]} empty="生成の記録はまだありません。AI にコードを生成させると、記録されます。"
          rows={rows.map((r) => [
            <code key="p">{r.base === "generated-code" ? `.tmp/generated-code/${r.path}` : r.path}</code>,
            <span key="s" className={`op-drift op-drift-${r.state}`} data-testid="op-drift-state" data-state={r.state}>{DRIFT_LABELS[r.state as DriftState]}</span>,
            r.changedSources.length ? <span key="c">{r.changedSources.map((c) => <span key={`${c.kind}:${c.id}`} className="op-chip"><EntityLink kind={c.kind} id={c.id}>{c.id}</EntityLink> <small>({OPS_ENTITY_LABELS[c.kind]}・{c.state === "deleted" ? "削除" : "変更"})</small></span>)}</span> : "",
            <span key="t" style={{ whiteSpace: "nowrap" }}>{formatTime(r.at)}{r.generator ? <small className="an-hint"> {r.generator}</small> : null}</span>,
            r.changedSources.length ? <button key="b" type="button" className="an-btn" aria-expanded={open === r.path} onClick={() => void show(r.path)} data-testid="op-drift-diff">{open === r.path ? "差分を閉じる" : "設計の差分"}</button> : "",
          ])} />
        {open && (
          <div className="op-box" data-testid="op-drift-diff-view">
            <b>{open}</b> を作ったときの設計から、いまの設計までの差分 (再生成の範囲を絞る材料です。AI は designer__get_regeneration_diff で同じものを読めます)
            {diff === undefined ? <p>読み込み中…</p> : diff === null ? <p className="an-empty">差分はありません。</p> : diff.sources.map((s) => (
              <div key={`${s.kind}:${s.id}`}>
                <h3 className="op-h3">{OPS_ENTITY_LABELS[s.kind]} <code>{s.id}</code></h3>
                {s.state === "deleted" ? <p className="an-warn">この設計は、削除されています。</p> : s.state === "no-snapshot" ? <p className="an-hint">生成のときの設計の写しが見つからないため、差分は出せません。再生成して、記録し直してください。</p> : (
                  <AnTable headers={["場所", "種類", "前", "後"]} empty="差分はありません。" rows={s.changes.map((c) => [<code key="p">{c.path}</code>, TYPE_LABELS[c.type], c.before ?? "", c.after ?? ""])} />
                )}
                {s.truncated && <p className="an-hint">変更が多いため、途中までを表示しています。</p>}
              </div>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}
