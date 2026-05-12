/**
 * RegionContext の単体テスト。
 *
 * usePageLayoutAssignments / useGadgetPuckData の挙動を smoke 検証する。
 *
 * pl-5 follow-up (#1026): Puck composition preview (feature parity)
 */

import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { RegionProvider, usePageLayoutAssignments, useGadgetPuckData } from "../primitives/RegionContext";

// --- 検証用コンポーネント ---

function AssignmentsReader() {
  const assignments = usePageLayoutAssignments();
  return <div data-testid="assignments">{JSON.stringify(assignments)}</div>;
}

function GadgetDataReader({ gadgetScreenId }: { gadgetScreenId?: string }) {
  const data = useGadgetPuckData(gadgetScreenId);
  return <div data-testid="gadget-data">{JSON.stringify(data)}</div>;
}

// ---------------------------------------------------------------------------

describe("usePageLayoutAssignments", () => {
  it("RegionProvider 外で呼んだ場合は空 object を返す", () => {
    render(<AssignmentsReader />);
    expect(screen.getByTestId("assignments").textContent).toBe("{}");
  });

  it("RegionProvider に assignments を渡すと参照できる", () => {
    const value = {
      assignments: { header: "sc-001", footer: "sc-002" },
      gadgetData: {},
    };
    render(
      <RegionProvider value={value}>
        <AssignmentsReader />
      </RegionProvider>,
    );
    const text = screen.getByTestId("assignments").textContent ?? "";
    const parsed = JSON.parse(text);
    expect(parsed).toEqual({ header: "sc-001", footer: "sc-002" });
  });
});

describe("useGadgetPuckData", () => {
  it("RegionProvider 外で呼んだ場合は null を返す", () => {
    render(<GadgetDataReader gadgetScreenId="sc-001" />);
    expect(screen.getByTestId("gadget-data").textContent).toBe("null");
  });

  it("gadgetScreenId が undefined の場合は null を返す", () => {
    const value = {
      assignments: { header: "sc-001" },
      gadgetData: { "sc-001": { root: { props: {} }, content: [] } },
    };
    render(
      <RegionProvider value={value}>
        <GadgetDataReader gadgetScreenId={undefined} />
      </RegionProvider>,
    );
    expect(screen.getByTestId("gadget-data").textContent).toBe("null");
  });

  it("登録されている gadgetScreenId の data を返す", () => {
    const puckData = { root: { props: {} }, content: [{ type: "Heading", props: {} }] };
    const value = {
      assignments: { header: "sc-001" },
      gadgetData: { "sc-001": puckData },
    };
    render(
      <RegionProvider value={value}>
        <GadgetDataReader gadgetScreenId="sc-001" />
      </RegionProvider>,
    );
    const text = screen.getByTestId("gadget-data").textContent ?? "";
    expect(JSON.parse(text)).toEqual(puckData);
  });

  it("登録されていない gadgetScreenId の場合は null を返す", () => {
    const value = {
      assignments: { header: "sc-001" },
      gadgetData: { "sc-001": { root: { props: {} }, content: [] } },
    };
    render(
      <RegionProvider value={value}>
        <GadgetDataReader gadgetScreenId="sc-999" />
      </RegionProvider>,
    );
    expect(screen.getByTestId("gadget-data").textContent).toBe("null");
  });
});
