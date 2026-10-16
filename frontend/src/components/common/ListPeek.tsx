/**
 * 一覧の「のぞき見」(UI 改善提案 続編 第 6 弾 #103 #112)。開かずに、行の中身 (表の全部の列。いま隠している列も) を小さなカードで見る。
 * - Space: 選んでいる行のカードを右に出す。↑↓で選ぶ行を変えると、カードも変わる。Esc か Space でもう一度閉じる
 * - Alt を押しながら行にポインタを合わせる: ポインタの近くにカードを出す
 * 読み取り専用。クリックで何かが変わるボタンは置かない。
 */
import type { ReactNode } from "react";
import "../../styles/listPeek.css";

export interface PeekField { label: string; value: ReactNode }

interface Props {
  title: ReactNode;
  fields: PeekField[];
  /** ポインタの近くに出す (無ければ画面の右) */
  at?: { x: number; y: number };
  onClose?: () => void;
}

export function ListPeek({ title, fields, at, onClose }: Props) {
  const style = at
    ? { left: Math.min(at.x + 14, Math.max(8, window.innerWidth - 340)), top: Math.min(at.y + 14, Math.max(8, window.innerHeight - 260)) }
    : undefined;
  return (
    <aside className={`list-peek${at ? " list-peek-at" : ""}`} style={style} role="complementary" aria-label="のぞき見" data-testid="list-peek">
      <header className="list-peek-head">
        <b className="list-peek-title">{title}</b>
        {onClose && <button type="button" className="list-peek-close" onClick={onClose} aria-label="のぞき見を閉じる" title="閉じる (Esc / Space)"><i className="bi bi-x-lg" /></button>}
      </header>
      <dl className="list-peek-body">
        {fields.map((f, i) => (
          <div key={`${i}:${f.label}`} className="list-peek-row">
            <dt>{f.label}</dt>
            <dd>{f.value === "" || f.value === null || f.value === undefined ? <span className="list-peek-empty">—</span> : f.value}</dd>
          </div>
        ))}
      </dl>
      {!at && <footer className="list-peek-foot">↑↓ で行を変える ・ Esc / Space で閉じる</footer>}
    </aside>
  );
}
