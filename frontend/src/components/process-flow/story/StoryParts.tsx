/** 「流れ」表示の小さな部品: 条件の言葉・印 (チップ)・変数の印 */
import type { ReactNode } from "react";
import type { Seg } from "./expressionText";
import type { Chip, VarLabels } from "./storyModel";
import { useStoryUi } from "./storyUi";

function VarSeg({ name, path, raw, labels, showNames, plain }: { name: string; path: string[]; raw: string; labels: VarLabels; showNames: boolean; plain?: boolean }) {
  const ui = useStoryUi();
  const text = showNames ? raw : labels.full(name, path);
  // この処理の中で作られる変数だけを、ボタンにする。入力・規約・セッションの値などは、ふつうの文字
  // ボタンの中に入れるときは (plain)、入れ子のボタンにならないよう、文字にする
  if (plain || !labels.isDefined(name)) return <span className="pfs-ref" title={raw}>{text}</span>;
  const active = ui.activeVar === name;
  return (
    <button
      type="button"
      className={`pfs-var${active ? " is-active" : ""}`}
      title={`${raw}${showNames ? "" : " — クリックで、作る場所と使う場所を光らせる"}`}
      onClick={(e) => { e.stopPropagation(); ui.setActiveVar(active ? null : name); }}
    >
      {text}
    </button>
  );
}

/** 条件の部品 → 表示 */
export function CondText({ segs, plain }: { segs: readonly Seg[]; plain?: boolean }) {
  const ui = useStoryUi();
  if (segs.length === 0) return <span className="pfs-muted">（条件が空です）</span>;
  return (
    <span className="pfs-cond">
      {segs.map((s, i) => {
        if (s.k === "text") return <span key={i}>{s.v}</span>;
        if (s.k === "code") return <code key={i} className="pfs-inline-code">{s.v}</code>;
        return <VarSeg key={i} name={s.name} path={s.path} raw={s.raw} labels={ui.ctx.labels} showNames={ui.showNames} plain={plain} />;
      })}
    </span>
  );
}

export function ChipView({ chip, onEdit }: { chip: Chip; onEdit?: (chip: Chip, el: HTMLElement) => void }) {
  const ui = useStoryUi();
  // 編集中は、直せる印をクリックすると、その場で直す窓が開く
  if (ui.edit && onEdit && chip.edit) {
    return (
      <button type="button" className={`pfs-chip pfs-chip--${chip.tone ?? "plain"} pfs-chip--editable`} title={`${chip.title ?? chip.text} — クリックで直す`} onClick={(e) => { e.stopPropagation(); onEdit(chip, e.currentTarget); }}>
        {chip.text}
      </button>
    );
  }
  if (chip.varName) {
    const active = ui.activeVar === chip.varName;
    return (
      <button
        type="button"
        className={`pfs-chip pfs-chip--var${active ? " is-active" : ""}`}
        title={chip.title}
        onClick={(e) => { e.stopPropagation(); ui.setActiveVar(active ? null : chip.varName ?? null); }}
      >
        {chip.text}
      </button>
    );
  }
  return <span className={`pfs-chip pfs-chip--${chip.tone ?? "plain"}`} title={chip.title}>{chip.text}</span>;
}

export function Chips({ chips, onEdit, extra }: { chips: readonly Chip[]; onEdit?: (chip: Chip, el: HTMLElement) => void; extra?: ReactNode }): ReactNode {
  if (chips.length === 0 && !extra) return null;
  return <div className="pfs-chips">{chips.map((c, i) => <ChipView key={`${i}:${c.text}`} chip={c} onEdit={onEdit} />)}{extra}</div>;
}
