/** ドラッグ中のノードがそろったときのガイド線 (図の座標で描く)。ReactFlow の子として置く。 */
import { ViewportPortal } from "@xyflow/react";
import type { Guides } from "../../hooks/useSnapGuides";

export function DiagramGuides({ guides }: { guides: Guides }) {
  if (guides.vertical.length === 0 && guides.horizontal.length === 0) return null;
  return (
    <ViewportPortal>
      <div className="dgm-guides" data-testid="dgm-guides" aria-hidden="true">
        {guides.vertical.map((x) => <div key={`v${x}`} className="dgm-guide dgm-guide-v" style={{ transform: `translate(${x}px, -50000px)` }} />)}
        {guides.horizontal.map((y) => <div key={`h${y}`} className="dgm-guide dgm-guide-h" style={{ transform: `translate(-50000px, ${y}px)` }} />)}
      </div>
    </ViewportPortal>
  );
}
