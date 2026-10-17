/**
 * 試作 (サンドボックス) (#178): 設計の内容を「試作」として残し、本体を変えずに試す。気に入ったら、編集中の画面へ読み込んで、変更点を確かめてから保存する。
 * 試作は、このブラウザにだけ残る (1 つの設計に 5 件まで)。編集中の下書きがあればその内容、なければ保存済みの内容が、試作になる。
 */
import { useState } from "react";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { mcpBridge } from "../../mcp/mcpBridge";
import { requestApplyVersion } from "../../utils/applyVersionBus";
import { DRAFT_KIND, type TabDesign } from "../../utils/designHistory";
import { loadDraft } from "../../utils/draftStorage";
import { reportFailure } from "../../utils/failureToast";
import { showToast } from "../../utils/toast";
import { TRIAL_REASON_TEXT, addTrial, loadTrials, removeTrial, trialRef, type TrialMap } from "../../utils/trialSnapshots";
import { formatTime } from "../operations/reviewUtils";
import type { CompareSelection } from "./HistoryCompareTab";

export function HistoryTrialTab({ design, onCompare }: { design: TabDesign; onCompare: (sel: CompareSelection) => void }) {
  const { wsId } = useWorkspacePath();
  const ref = trialRef(design.kind, design.id);
  const [trials, setTrials] = useState<TrialMap>(() => loadTrials(wsId));
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const list = trials[ref] ?? [];

  if (!design.versionType) return <p className="an-hint" data-testid="dh-trial-unsupported">試作は、編集内容が 1 つのファイルに収まる設計 (テーブル・処理フロー・業務フロー・帳票など) で使えます。</p>;

  const create = async () => {
    setBusy(true);
    try {
      const draft = loadDraft<unknown>(DRAFT_KIND[design.kind], design.id);
      const snapshot = draft ?? await mcpBridge.request(design.load.method as never, { [design.load.key]: design.id } as never);
      if (!snapshot) { showToast("試作にする内容を読み込めませんでした", "error"); return; }
      const r = addTrial(wsId, ref, name, snapshot);
      if (!r.ok) { showToast(TRIAL_REASON_TEXT[r.reason], "error"); return; }
      setTrials(r.trials); setName("");
      showToast(`試作「${r.trial.name}」を残しました (${draft ? "編集中の内容から" : "保存済みの内容から"})`);
    } catch (e) { reportFailure(e, "試作の作成"); } finally { setBusy(false); }
  };

  const apply = (trialName: string, snapshot: unknown) => {
    // 編集中のこの設計の画面だけが受け取る。受け取られなければ、編集を始めていない
    const taken = requestApplyVersion({ resourceType: design.versionType!, resourceId: design.id, snapshot });
    if (taken) showToast(`試作「${trialName}」を、編集中の内容として読み込みました。「変更点」で確かめてから保存してください`);
    else showToast("先に「編集開始」を押してください (編集中の画面へ読み込みます)", "info");
  };

  return (
    <div data-testid="dh-trial">
      <div className="an-form-row">
        <label>試作の名前<input className="an-input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="例: 桁数を増やす案" data-testid="dh-trial-name" onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && name.trim()) { e.preventDefault(); void create(); } }} /></label>
        <button type="button" className="an-btn primary" disabled={busy || !name.trim()} onClick={() => void create()} data-testid="dh-trial-create"><i className="bi bi-flask" /> いまの内容を試作にする</button>
      </div>
      {list.length === 0 ? <p className="an-hint" data-testid="dh-trial-empty">試作は、まだありません。気に入らなければ捨てられる、控えのコピーです。本体は変わりません。</p> : (
        <ul className="dh-trials">
          {list.map((t) => (
            <li key={t.id} className="dh-trial" data-testid="dh-trial-item">
              <span className="dh-trial-name"><b>{t.name}</b> <small className="an-hint">{formatTime(t.at)}</small></span>
              <button type="button" className="an-btn" onClick={() => onCompare({ base: "current", target: `t:${t.id}` })} data-testid="dh-trial-compare">本体と比べる</button>
              <button type="button" className="an-btn" onClick={() => apply(t.name, t.snapshot)} data-testid="dh-trial-apply">編集に読み込む</button>
              <button type="button" className="an-btn danger" onClick={() => setTrials(removeTrial(wsId, ref, t.id))} data-testid="dh-trial-remove">捨てる</button>
            </li>
          ))}
        </ul>
      )}
      <p className="an-hint">「編集に読み込む」は、試作の内容全体を、編集中の画面へ入れ替えます (項目ごとに選ぶ機能はありません)。入れ替えたあとも、保存するまで原本は変わらず、「変更点」で確かめて、Ctrl+Z で戻せます。試作は、このブラウザにだけ残ります。</p>
    </div>
  );
}
