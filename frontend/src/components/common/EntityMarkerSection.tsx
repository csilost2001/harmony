import type { MarkerEntityType } from "@harmony/shared";
import type { Marker } from "../../types/v3";
import { MarkerListPanel, type MarkerAnchorChoice } from "./MarkerListPanel";

interface Props {
  type: MarkerEntityType;
  entity: { id: string; name?: string };
  markers: readonly Marker[] | undefined;
  onChange: (next: Marker[]) => void;
  readOnly: boolean;
  /** 編集画面の節 (section) のクラス名 (画面ごとに違う) */
  sectionClassName: string;
  anchorChoices?: readonly MarkerAnchorChoice[];
}

/**
 * 編集画面の中の、マーカー (AI への指示・質問) の節。折りたたみで、既定では閉じている。
 * テーブル以外の設計 (シーケンス・ビュー・ビュー定義・ページレイアウトなど) が、同じ見た目で使う。
 */
export function EntityMarkerSection({ type, entity, markers, onChange, readOnly, sectionClassName, anchorChoices }: Props) {
  return (
    <section className={sectionClassName} data-region="マーカー" data-testid={`${type}-markers-section`}>
      <MarkerListPanel markers={markers ?? []} onChange={onChange} entity={{ type, id: entity.id, name: entity.name }} readOnly={readOnly} anchorChoices={anchorChoices} />
    </section>
  );
}
