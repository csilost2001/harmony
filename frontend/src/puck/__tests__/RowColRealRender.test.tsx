/**
 * Row > Col x3 の実レイアウト構造テスト (#1404)。
 *
 * RowColLayout.test.tsx は DropZone をモックして「primitive が DropZone へ正しい class を
 * 渡す」契約を検証する。本テストはそれを補完し、**実 @measured/puck の <Render>** を通して
 * 実際の DOM 階層を検証する (モックでは検出できない item-wrapper 挿入の有無を実機で担保)。
 *
 * #1404 の核心:
 *   - Puck の DropZone は className をその container div に付与する
 *   - Puck 0.20.x は各子コンポーネントを item-wrapper で包まず、component 本体の root を
 *     DropZone container の「直接の子」として配置する (data-puck-component は ref 経由で
 *     component 本体 root に付与、選択 overlay は portal で別レイヤー)
 *   - したがって Row が DropZone に付けた `flex flex-row` が効き、Col 本体 (w-N/12) が
 *     flex item として横並びする
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Render, type Config } from "@measured/puck";
import { RowConfig } from "../primitives/Row";
import { ColConfig } from "../primitives/Col";
import { CssFrameworkProvider } from "../CssFrameworkContext";
import type { CssFramework } from "../layoutPropsMapping/types";

const config = {
  components: { Row: RowConfig, Col: ColConfig },
} as unknown as Config;

function makeData(span: 1 | 2 | 3 | 4 | 6 | 12) {
  return {
    root: { props: {} },
    content: [{ type: "Row", props: { id: "row-1", gap: "sm" } }],
    zones: {
      "row-1:content": [
        { type: "Col", props: { id: "col-1", span } },
        { type: "Col", props: { id: "col-2", span } },
        { type: "Col", props: { id: "col-3", span } },
      ],
    },
  } as never;
}

function renderRowCol(framework: CssFramework, span: 1 | 2 | 3 | 4 | 6 | 12) {
  return render(
    <CssFrameworkProvider value={framework}>
      <Render config={config} data={makeData(span)} />
    </CssFrameworkProvider>,
  );
}

describe("Row > Col x3 実レイアウト (#1404, real Puck Render)", () => {
  it("Tailwind: 3 つの Col 本体が同一 flex コンテナの直接の子として並ぶ", () => {
    const { container } = renderRowCol("tailwind", 3);
    const cols = Array.from(
      container.querySelectorAll('[data-testid="puck-primitive-col"]'),
    );
    expect(cols).toHaveLength(3);

    // 3 つの Col の親はすべて同一要素 (= Row が DropZone に付けた flex コンテナ)
    const parents = new Set(cols.map((c) => c.parentElement));
    expect(parents.size).toBe(1);

    const flexParent = cols[0].parentElement!;
    // 横並びの flex context がこの親 (Col の直接の親) に効いている
    expect(flexParent.className).toContain("flex");
    expect(flexParent.className).toContain("flex-row");

    // 各 Col 本体に列幅 class が乗り、flex item として幅が決まる
    cols.forEach((c) => expect(c.className).toContain("w-3/12"));

    // item-wrapper が挟まっていない (Col の親が flex コンテナそのもの) ことの裏付け:
    // 親の直接の子 3 つがすべて Col である
    const directChildren = Array.from(flexParent.children);
    expect(directChildren).toHaveLength(3);
    directChildren.forEach((el) =>
      expect(el.getAttribute("data-testid")).toBe("puck-primitive-col"),
    );
  });

  it("Bootstrap: 3 つの Col 本体が row コンテナの直接の子として並ぶ", () => {
    const { container } = renderRowCol("bootstrap", 4);
    const cols = Array.from(
      container.querySelectorAll('[data-testid="puck-primitive-col"]'),
    );
    expect(cols).toHaveLength(3);

    const parents = new Set(cols.map((c) => c.parentElement));
    expect(parents.size).toBe(1);

    const rowParent = cols[0].parentElement!;
    expect(rowParent.className).toContain("row");
    cols.forEach((c) => expect(c.className).toContain("col-4"));
  });
});
