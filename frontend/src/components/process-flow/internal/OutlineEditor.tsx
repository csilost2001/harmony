/**
 * 処理フローの工程を、1 行 1 工程のテキストで書く「アウトライン」表示 (試作)。
 * 変換のルールは utils/processFlowOutline.ts。保存形式は今の JSON のまま。
 *
 * - 行頭で `/` を打つと、種類を選ぶメニューが開く (Enter で `[種類] ` を挿入)
 * - 行の入れ替え = 工程の並べ替え、行の削除 = 工程の削除、`^id` の無い行 = 新しい工程
 * - Tab / Shift+Tab = 選んだ行の字下げ (入れ子 = subSteps)。Esc で欄を出ると、Tab は通常のフォーカス移動
 * - 欄を出ると (問題がなく、削除を含まなければ) 自動で反映する。削除を含むときは「反映」ボタンで確かめる
 */
import { useEffect, useMemo, useRef, useState } from "react";
import type { Step, StepType } from "../../../types/v3";
import { applyOutline, kindLabel, parseOutline, stepsToOutline, type OutlineLine } from "../../../utils/processFlowOutline";
import { collectAllProcessFlowLocalIds } from "../../../utils/localIdGenerator";
import { StepInsertMenu } from "./StepInsertMenu";
import "../../../styles/processFlowOutline.css";

interface Props {
  steps: readonly Step[];
  kinds: readonly StepType[];
  readonly: boolean;
  onApply: (lines: OutlineLine[]) => void;
}

export function OutlineEditor({ steps, kinds, readonly, onApply }: Props) {
  const baseline = useMemo(() => stepsToOutline(steps), [steps]);
  // 入力中の文字は、どの内容 (baseline) に対するものかと一緒に持つ。元の内容が変わったら (別のアクションへの切り替え・
  // 元に戻す・ほかの人の更新)、古い入力を別の工程へ反映してしまわないよう、破棄して知らせる
  const [pending, setPending] = useState<{ text: string; base: string } | null>(null);
  const stale = pending !== null && pending.base !== baseline;
  const draft = pending !== null && !stale ? pending.text : null;
  const setDraft = (t: string | null) => setPending(t === null ? null : { text: t, base: baseline });
  const text = draft ?? baseline;
  const areaRef = useRef<HTMLTextAreaElement>(null);
  const [menu, setMenu] = useState<{ at: number } | null>(null);
  /** 描画のあとで、カーソルをここへ置く (メニューを閉じた直後に打ち込んでも、文字が欠けないように) */
  const pendingCaret = useRef<number | null>(null);
  const pendingSelection = useRef<[number, number] | null>(null);
  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const at = pendingCaret.current;
    if (at != null) {
      pendingCaret.current = null;
      el.focus();
      el.setSelectionRange(at, at);
    }
    const sel = pendingSelection.current;
    if (sel) {
      pendingSelection.current = null;
      el.setSelectionRange(sel[0], sel[1]);
    }
  });

  const analysis = useMemo(() => {
    if (draft === null) return null;
    const parsed = parseOutline(draft, kinds);
    const ids = collectAllProcessFlowLocalIds({ actions: [{ steps }] });
    const result = parsed.errors.length === 0 ? applyOutline(steps, parsed.lines, ids) : null;
    return { parsed, result };
  }, [draft, steps, kinds]);

  const hasChange = !!analysis?.result && (analysis.result.added + analysis.result.changed + analysis.result.removed.length > 0 || analysis.result.reordered);
  const removedCount = analysis?.result?.removed.length ?? 0;
  const canApply = !readonly && hasChange;

  const apply = () => {
    if (!analysis?.result || !hasChange) return;
    if (removedCount > 0 && !window.confirm(`${removedCount} 件の工程を削除します。よろしいですか? (元に戻す操作で戻せます)`)) return;
    onApply(analysis.parsed.lines);
    setDraft(null);
  };

  /** 選んだ行 (カーソルのある行) の字下げを 1 段 (空白 2 つ) 増減する。選択も、字下げに合わせて動かす */
  const shiftIndent = (el: HTMLTextAreaElement, dir: 1 | -1) => {
    const v = el.value;
    const start = v.lastIndexOf("\n", el.selectionStart - 1) + 1;
    const endRaw = v.indexOf("\n", Math.max(el.selectionEnd - (el.selectionEnd > el.selectionStart && v[el.selectionEnd - 1] === "\n" ? 1 : 0), 0));
    const end = endRaw < 0 ? v.length : endRaw;
    const lines = v.slice(start, end).split("\n");
    let firstDelta = 0;
    const out = lines.map((ln, i) => {
      const next = dir > 0 ? `  ${ln}` : ln.replace(/^ {1,2}/, "");
      if (i === 0) firstDelta = next.length - ln.length;
      return next;
    });
    const replaced = out.join("\n");
    const nextText = v.slice(0, start) + replaced + v.slice(end);
    const selStart = Math.max(start, el.selectionStart + firstDelta);
    const selEnd = Math.max(selStart, el.selectionEnd + (replaced.length - (end - start)));
    pendingSelection.current = [selStart, selEnd];
    setDraft(nextText);
  };

  const insertAtCaret = (kind: StepType) => {
    const el = areaRef.current;
    if (!el) return;
    const at = menu?.at ?? el.selectionStart;
    const lineStart = text.lastIndexOf("\n", at - 1) + 1;
    const lineEndRaw = text.indexOf("\n", at);
    const lineEnd = lineEndRaw < 0 ? text.length : lineEndRaw;
    const line = text.slice(lineStart, lineEnd);
    const insert = `[${kindLabel(kind)}] `;
    const next = line.trim() === "" ? text.slice(0, lineStart) + insert + text.slice(lineEnd) : text.slice(0, lineEnd) + "\n" + insert + text.slice(lineEnd);
    const caret = line.trim() === "" ? lineStart + insert.length : lineEnd + 1 + insert.length;
    pendingCaret.current = caret;
    setDraft(next);
    setMenu(null);
  };

  return (
    <div className="pf-outline" data-testid="pf-outline">
      <p className="pf-outline-hint">
        1 行が 1 工程です。行頭で <kbd>/</kbd> を打つと種類を選べます。<kbd>Tab</kbd> / <kbd>Shift</kbd>+<kbd>Tab</kbd> で字下げすると、直前の工程の配下 (入れ子) になります。
        行を入れ替えると順序が変わり、行を消すと工程が消えます。行末の <code>^step-01</code> は工程の目印なので消さないでください (無い行は新しい工程になります)。種類・テーブル・条件などの詳細は、カード表示で編集します。
      </p>
      <textarea
        ref={areaRef}
        className="pf-outline-text"
        data-testid="pf-outline-text"
        value={text}
        readOnly={readonly}
        spellCheck={false}
        rows={Math.max(10, text.split("\n").length + 2)}
        aria-label="処理フローのアウトライン"
        placeholder={readonly ? "" : "例: [入力チェック] 入力値を検証する"}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (readonly || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            const el = e.currentTarget;
            const at = el.selectionStart;
            const lineStart = el.value.lastIndexOf("\n", at - 1) + 1;
            if (el.value.slice(lineStart, at).trim() === "" && el.selectionStart === el.selectionEnd) {
              e.preventDefault();
              setMenu({ at });
            }
          }
          if (e.key === "Escape") { e.preventDefault(); e.currentTarget.blur(); return; }
          if (e.key === "Tab" && !e.ctrlKey && !e.metaKey && !e.altKey) {
            e.preventDefault();
            shiftIndent(e.currentTarget, e.shiftKey ? -1 : 1);
          }
        }}
        onBlur={() => { if (canApply && removedCount === 0 && !menu) apply(); }}
      />
      <div className="pf-outline-status" role="status">
        {stale && <span className="pf-outline-warn" data-testid="pf-outline-stale">元の内容が変わったため、入力中の内容を破棄しました。</span>}
        {analysis === null ? (
          <span className="pf-outline-muted">{steps.length} 工程</span>
        ) : analysis.parsed.errors.length > 0 ? (
          <ul className="pf-outline-errors" data-testid="pf-outline-errors">
            {analysis.parsed.errors.map((er) => <li key={er.lineNo}>{er.lineNo} 行目: {er.message}</li>)}
          </ul>
        ) : (
          <span>
            {analysis.result && (
              <>
                {analysis.result.added > 0 && `追加 ${analysis.result.added} 件 `}
                {analysis.result.changed > 0 && `変更 ${analysis.result.changed} 件 `}
                {analysis.result.reordered && "順序を変更 "}
                {removedCount > 0 && <strong className="pf-outline-danger">削除 {removedCount} 件 </strong>}
                {!hasChange && "変更はありません"}
                {analysis.result.kindIgnored.length > 0 && (
                  <em className="pf-outline-warn"> ({analysis.result.kindIgnored.map((l) => l.lineNo).join(", ")} 行目: 既存の工程の種類は変えられないため、そのままにします)</em>
                )}
              </>
            )}
          </span>
        )}
        {!readonly && draft !== null && (
          <span className="pf-outline-actions">
            <button type="button" className="btn btn-sm btn-primary" data-testid="pf-outline-apply" disabled={!canApply} onClick={apply}>反映</button>
            <button type="button" className="btn btn-sm btn-secondary" data-testid="pf-outline-discard" onClick={() => setDraft(null)}>入力を取り消す</button>
          </span>
        )}
      </div>
      {menu && !readonly && (
        <StepInsertMenu kinds={kinds} where="アウトラインの行に" onPick={insertAtCaret} onClose={() => { setMenu(null); areaRef.current?.focus(); }} />
      )}
    </div>
  );
}
