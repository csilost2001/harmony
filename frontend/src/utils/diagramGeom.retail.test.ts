import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { layoutWithGroups, type GroupedGeomNode } from "./diagramGeom";

// 実際のサンプル (examples/retail) の画面フローを自動配置して、重ならず、グループの枠の中に収まることを確かめる (レビュー M1)
const root = resolve(__dirname, "../../../examples/retail");
const harmony = JSON.parse(readFileSync(resolve(root, "harmony.json"), "utf8")).entities;
const pos = JSON.parse(readFileSync(resolve(root, "harmony/screen-flow-positions.json"), "utf8")).positions as Record<string, { x: number; y: number; width: number; height: number }>;

const groups: GroupedGeomNode[] = (harmony.screenGroups as Array<{ id: string }>).map((g) => ({ id: g.id, x: pos[g.id]?.x ?? 0, y: pos[g.id]?.y ?? 0, w: pos[g.id]?.width ?? 320, h: pos[g.id]?.height ?? 360, isGroup: true }));
const screens: GroupedGeomNode[] = (harmony.screens as Array<{ id: string; groupId?: string }>).map((s) => ({ id: s.id, x: 0, y: 0, w: 200, h: 80, ...(s.groupId ? { parentId: s.groupId } : {}) }));
const edges = (harmony.screenTransitions as Array<{ sourceScreenId: string; targetScreenId: string }>).map((t) => ({ source: t.sourceScreenId, target: t.targetScreenId }));

const hit = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("retail の画面フローの自動配置 (続編 第 7 弾 #126、レビュー M1)", () => {
  const { positions, sizes } = layoutWithGroups([...groups, ...screens], edges, { dx: 100, dy: 50 });
  const size = (g: GroupedGeomNode) => sizes.get(g.id) ?? { w: g.w, h: g.h };

  it("全ノードに位置が付く", () => {
    for (const n of [...groups, ...screens]) expect(positions.has(n.id), n.id).toBe(true);
  });
  it("グループの中の画面は、画面どうしが重ならず、グループの枠の中に収まる", () => {
    for (const g of groups) {
      const kids = screens.filter((s) => s.parentId === g.id).map((s) => ({ ...positions.get(s.id)!, w: s.w, h: s.h, id: s.id }));
      const box = size(g);
      for (const k of kids) {
        expect(k.x, `${k.id} 左`).toBeGreaterThanOrEqual(0);
        expect(k.x + k.w, `${k.id} 右`).toBeLessThanOrEqual(box.w);
        expect(k.y + k.h, `${k.id} 下`).toBeLessThanOrEqual(box.h);
      }
      for (let i = 0; i < kids.length; i++) for (let j = i + 1; j < kids.length; j++) expect(hit(kids[i], kids[j]), `${kids[i].id} と ${kids[j].id}`).toBe(false);
    }
  });
  it("最上位 (グループの枠・グループに入っていない画面) どうしも重ならない", () => {
    const top = [...groups.map((g) => ({ ...positions.get(g.id)!, ...size(g), id: g.id })), ...screens.filter((s) => !s.parentId).map((s) => ({ ...positions.get(s.id)!, w: s.w, h: s.h, id: s.id }))];
    for (let i = 0; i < top.length; i++) for (let j = i + 1; j < top.length; j++) expect(hit(top[i], top[j]), `${top[i].id} と ${top[j].id}`).toBe(false);
  });
});
