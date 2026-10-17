/**
 * 版を比べる (#163) と、変更の要約の文 (#164)。保存前の版・いまの保存済みの内容・試作の、任意の 2 つを並べて比べる。
 * 差の取り方は、編集中の「変更点」と同じ。人の言葉の要約を先頭に置き、コミットメッセージ・レビュー依頼の文としてコピーできる。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { mcpBridge } from "../../mcp/mcpBridge";
import { reportFailure } from "../../utils/failureToast";
import { HISTORY_KIND_LABELS, type TabDesign } from "../../utils/designHistory";
import { writeClipboardText } from "../../utils/tableExport";
import { showToast } from "../../utils/toast";
import { loadTrials, trialRef } from "../../utils/trialSnapshots";
import { changeRow, commitMessageText, compareSnapshots, countsText, reviewRequestText } from "../../utils/versionCompare";
import { useWorkspacePath } from "../../hooks/useWorkspacePath";
import { formatTime } from "../operations/reviewUtils";

export interface CompareSelection { base: string; target: string }
interface VersionRow { id: string; savedAt: string }
const MAX_ROWS = 200;

export function HistoryCompareTab({ design, label, selection }: { design: TabDesign; label: string; selection?: CompareSelection }) {
  const { wsId } = useWorkspacePath();
  const [versions, setVersions] = useState<VersionRow[] | null>(design.versionType ? null : []);
  const trials = useMemo(() => loadTrials(wsId)[trialRef(design.kind, design.id)] ?? [], [wsId, design.kind, design.id]);
  const [baseChoice, setBaseChoice] = useState(selection?.base ?? "");
  const [target, setTarget] = useState(selection?.target ?? "current");
  /** 読み込みの結果。どの組み合わせの結果かを持ち、いまの選択と合うときだけ使う (選択のたびに、結果を消す処理を書かない) */
  const [loaded, setLoaded] = useState<{ key: string; snaps?: { base: unknown; target: unknown }; error?: string } | null>(null);
  const cache = useRef(new Map<string, unknown>());

  useEffect(() => {
    if (!design.versionType) return;
    let alive = true;
    mcpBridge.request("fileVersions.list", { resourceType: design.versionType, resourceId: design.id })
      .then((r) => { if (alive) setVersions(((r as { versions?: VersionRow[] }).versions ?? [])); })
      .catch((e) => { if (alive) { setVersions([]); reportFailure(e, "保存前の版の一覧の読み込み"); } });
    return () => { alive = false; };
  }, [design.versionType, design.id]);

  // 基準の既定: いちばん新しい保存前の版 (なければ試作)
  const base = baseChoice || (versions?.[0] ? `v:${versions[0].id}` : trials[0] ? `t:${trials[0].id}` : "");
  const setBase = setBaseChoice;

  const fetchSnap = useCallback(async (opt: string): Promise<unknown> => {
    if (cache.current.has(opt)) return cache.current.get(opt);
    let snap: unknown;
    if (opt === "current") snap = await mcpBridge.request(design.load.method as never, { [design.load.key]: design.id } as never);
    else if (opt.startsWith("v:")) snap = ((await mcpBridge.request("fileVersions.get", { resourceType: design.versionType!, resourceId: design.id, versionId: opt.slice(2) })) as { snapshot: unknown }).snapshot;
    else snap = trials.find((t) => t.id === opt.slice(2))?.snapshot;
    if (snap === undefined || snap === null) throw new Error("比べる内容を読み込めませんでした");
    cache.current.set(opt, snap);
    return snap;
  }, [design.load.key, design.load.method, design.id, design.versionType, trials]);

  const pairKey = base && target ? `${base}|${target}` : "";
  useEffect(() => {
    if (!pairKey) return;
    let alive = true;
    Promise.all([fetchSnap(base), fetchSnap(target)])
      .then(([b, t]) => { if (alive) setLoaded({ key: pairKey, snaps: { base: b, target: t } }); })
      .catch((e) => { if (alive) setLoaded({ key: pairKey, error: e instanceof Error ? e.message : String(e) }); });
    return () => { alive = false; };
  }, [pairKey, base, target, fetchSnap]);
  const current = loaded && loaded.key === pairKey ? loaded : null;
  const snaps = current?.snaps ?? null;
  const error = current?.error ?? null;

  const options = useMemo(() => [
    { id: "current", text: "いまの保存済みの内容" },
    ...(versions ?? []).map((v) => ({ id: `v:${v.id}`, text: `${formatTime(v.savedAt)} の直前の内容 (保存前の版)` })),
    ...trials.map((t) => ({ id: `t:${t.id}`, text: `試作「${t.name}」 (${formatTime(t.at)})` })),
  ], [versions, trials]);
  const textOf = (id: string) => options.find((o) => o.id === id)?.text ?? id;
  const cmp = useMemo(() => (snaps ? compareSnapshots(snaps.base, snaps.target) : null), [snaps]);
  const subject = `${HISTORY_KIND_LABELS[design.kind]}「${label}」`;
  const copy = (text: string, what: string) => { writeClipboardText(text).then(() => showToast(`${what}をコピーしました`)).catch((e) => reportFailure(e, `${what}のコピー`)); };

  if (!design.versionType) {
    return <p className="an-hint" data-testid="dh-compare-unsupported">{HISTORY_KIND_LABELS[design.kind]}は、編集内容が複数のファイルに分かれるため、保存前の版を比べられません (ファイルとしての版は残っています)。</p>;
  }
  return (
    <div data-testid="dh-compare">
      {versions !== null && options.length < 2 && <p className="an-hint">比べられる内容が、まだありません。保存を重ねると、保存のたびに「保存前の版」が残ります (最大 20 世代)。</p>}
      <div className="an-form-row dh-compare-pick">
        <label>基準 (前)<select className="an-input" value={base} onChange={(e) => setBase(e.target.value)} data-testid="dh-compare-base"><option value="">(選ぶ)</option>{options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}</select></label>
        <button type="button" className="an-btn" onClick={() => { setBase(target); setTarget(base); }} title="前と後を入れ替える" aria-label="前と後を入れ替える" data-testid="dh-compare-swap"><i className="bi bi-arrow-left-right" /></button>
        <label>比較先 (後)<select className="an-input" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="dh-compare-target"><option value="">(選ぶ)</option>{options.map((o) => <option key={o.id} value={o.id}>{o.text}</option>)}</select></label>
      </div>
      {error ? <p className="an-alert" role="alert">{error}</p> : null}
      {cmp && (
        <>
          <p className="dh-counts" data-testid="dh-compare-counts"><b>{countsText(cmp.counts)}</b> <small className="an-hint">({textOf(base)} → {textOf(target)})</small></p>
          {cmp.summary.length > 0 && (
            <section>
              <h3 className="dh-h">変更のまとめ</h3>
              <ul className="dh-summary" data-testid="dh-compare-summary">{cmp.summary.map((s, i) => <li key={`${i}:${s}`}>{s}</li>)}</ul>
              <div className="dh-copy-row">
                <button type="button" className="an-btn" onClick={() => copy(commitMessageText(subject, cmp), "コミットメッセージの文")} data-testid="dh-copy-commit"><i className="bi bi-git" /> コミットメッセージとしてコピー</button>
                <button type="button" className="an-btn" onClick={() => copy(reviewRequestText(subject, cmp, textOf(base), textOf(target)), "レビュー依頼の文")} data-testid="dh-copy-review"><i className="bi bi-chat-left-text" /> レビュー依頼の文としてコピー</button>
              </div>
            </section>
          )}
          {cmp.changes.length > 0 && (
            <section>
              <h3 className="dh-h">場所ごとの差 (前 → 後)</h3>
              <div className="dh-diff-wrap">
                <table className="an-table dh-diff" data-testid="dh-compare-table">
                  <thead><tr><th>場所</th><th>前</th><th>後</th></tr></thead>
                  <tbody>
                    {cmp.changes.slice(0, MAX_ROWS).map((c, i) => {
                      const r = changeRow(c);
                      return <tr key={i} className={`dh-diff-${r.kind}`} data-testid="dh-compare-row"><td>{r.where}</td><td className="dh-before">{r.before}</td><td className="dh-after">{r.after}</td></tr>;
                    })}
                  </tbody>
                </table>
              </div>
              {cmp.changes.length > MAX_ROWS && <p className="an-hint">ほか {cmp.changes.length - MAX_ROWS} 件は、表に出していません (まとめには含まれます)。</p>}
            </section>
          )}
        </>
      )}
    </div>
  );
}
