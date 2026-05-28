/**
 * Row / Col / Container primitive のレイアウト DOM 契約テスト。
 *
 * #1404: Puck の <DropZone> は外側コンテナと子要素の間に自前の wrapper div を
 * 挟むため、横並びの flex/grid class を外側 div に付けても Col 群 (DropZone の子)
 * には効かず縦積みになっていた。本テストは「横並びを司る flex/grid class が
 * DropZone wrapper (= Col の直接の親) に渡される」ことを検証し、再発を検知する。
 *
 * 実描画 (DnD / AppStore 依存) は過剰モックを避け、<DropZone> を className/zone を
 * そのまま DOM へ透過する軽量モックに差し替えて、各 primitive が渡す props を検査する。
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// <DropZone> を軽量モックに差し替える。
// 実 Puck の DropZone は AppStore / DnD context に依存し単体描画できないため、
// 受け取った className / zone を DOM 属性として透過する stub に置換する。
// これにより「primitive が DropZone wrapper に何の class を渡したか」を検査できる。
vi.mock("@measured/puck", () => ({
  DropZone: ({ zone, className }: { zone: string; className?: string }) => (
    <div data-testid="dropzone" data-zone={zone} className={className} />
  ),
}));

import { RowConfig } from "../primitives/Row";
import { ColConfig } from "../primitives/Col";
import { ContainerConfig } from "../primitives/Container";
import { CssFrameworkProvider } from "../CssFrameworkContext";
import type { CssFramework } from "../layoutPropsMapping/types";

// ComponentConfig.render を React コンポーネントとして呼び出すヘルパ。
// render は通常関数なので JSX 要素にラップして RTL で描画する。
function renderPrimitive(
  renderFn: (props: never) => React.ReactNode,
  props: Record<string, unknown>,
  framework: CssFramework,
) {
  const El = () => <>{renderFn(props as never)}</>;
  return render(
    <CssFrameworkProvider value={framework}>
      <El />
    </CssFrameworkProvider>,
  );
}

describe("Row primitive (#1404)", () => {
  it("Tailwind: 横並び flex class を DropZone wrapper に渡す (外側 div ではない)", () => {
    renderPrimitive(RowConfig.render, { gap: "sm" }, "tailwind");
    const dropzone = screen.getByTestId("dropzone");
    // 横並びの context は Col の直接の親 = DropZone wrapper に乗る必要がある
    expect(dropzone.className).toContain("flex");
    expect(dropzone.className).toContain("flex-row");
    // 外側コンテナ (testid=puck-primitive-row) には flex class を付けない
    const outer = screen.getByTestId("puck-primitive-row");
    expect(outer.className).not.toContain("flex");
  });

  it("Bootstrap: row class を DropZone wrapper に渡す", () => {
    renderPrimitive(RowConfig.render, { gap: "sm" }, "bootstrap");
    const dropzone = screen.getByTestId("dropzone");
    expect(dropzone.className).toContain("row");
  });
});

describe("Col primitive (#1404)", () => {
  it("Tailwind: 列幅 class は Col 自身の最外殻 div に乗る (flex item として横並びする)", () => {
    renderPrimitive(ColConfig.render, { span: 3 }, "tailwind");
    const outer = screen.getByTestId("puck-primitive-col");
    // span=3 → w-3/12。Col の div が Row の flex の直接の子なので、ここで幅指定する
    expect(outer.className).toContain("w-3/12");
    // Col 内部の DropZone には列幅 class を渡さない (子は縦積みのまま)
    const dropzone = screen.getByTestId("dropzone");
    expect(dropzone.className ?? "").not.toContain("w-3/12");
  });

  it("Bootstrap: 列幅 class (col-N) は Col 自身の最外殻 div に乗る", () => {
    renderPrimitive(ColConfig.render, { span: 4 }, "bootstrap");
    const outer = screen.getByTestId("puck-primitive-col");
    expect(outer.className).toContain("col-4");
  });
});

describe("Container primitive (#1404)", () => {
  it("direction=row: flex-row を DropZone wrapper に渡す", () => {
    renderPrimitive(ContainerConfig.render, { direction: "row" }, "tailwind");
    const dropzone = screen.getByTestId("dropzone");
    expect(dropzone.className).toContain("flex");
    expect(dropzone.className).toContain("flex-row");
    const outer = screen.getByTestId("puck-primitive-container");
    expect(outer.className).not.toContain("flex");
  });

  it("direction=column: flex-col を DropZone wrapper に渡す", () => {
    renderPrimitive(ContainerConfig.render, { direction: "column" }, "tailwind");
    const dropzone = screen.getByTestId("dropzone");
    expect(dropzone.className).toContain("flex-col");
  });
});
