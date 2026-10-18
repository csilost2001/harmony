/** 「流れ」表示の小さな部品: 条件の言葉・印 (チップ)・変数の印 */
import type { ReactNode } from "react";
import type { Seg } from "./expressionText";
import type { Chip, VarLabels } from "./storyModel";
import { useStoryUi } from "./storyUi";

function VarSeg({ name, path, raw, labels, showNames }: { name: string; path: string[]; raw: string; labels: VarLabels; showNames: boolean }) {
  const ui = useStoryUi();
  const text = showNames ? raw : labels.full(name, path);
  // この処理の中で作られる変数だけを、ボタンにする。入力・規約・セッションの値などは、ふつうの文字
  if (!labels.isDefined(name)) return <span className="pfs-ref" title={raw}>{text}</span>;
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
export function CondText({ segs }: { segs: readonly Seg[] }) {
  const ui = useStoryUi();
  if (segs.length === 0) return <span className="pfs-muted">（条件が空です）</span>;
  return (
    <span className="pfs-cond">
      {segs.map((s, i) => {
        if (s.k === "text") return <span key={i}>{s.v}</span>;
        if (s.k === "code") return <code key={i} className="pfs-inline-code">{s.v}</code>;
        return <VarSeg key={i} name={s.name} path={s.path} raw={s.raw} labels={ui.ctx.labels} showNames={ui.showNames} />;
      })}
    </span>
  );
}

export function ChipView({ chip }: { chip: Chip }) {
  const ui = useStoryUi();
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

export function Chips({ chips }: { chips: readonly Chip[] }): ReactNode {
  if (chips.length === 0) return null;
  return <div className="pfs-chips">{chips.map((c, i) => <ChipView key={`${i}:${c.text}`} chip={c} />)}</div>;
}
