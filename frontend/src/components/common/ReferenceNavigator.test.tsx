import { describe, it, expect, vi } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ReferenceNavigator } from "./ReferenceNavigator";
vi.mock("../../mcp/mcpBridge", () => ({
  mcpBridge: { request: vi.fn().mockResolvedValue({ referrers: [] }) },
}));
import { requestGoToReference, requestFindReferences, referenceAt } from "../../utils/referenceTarget";

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

describe("ReferenceNavigator", () => {
  it("定義へ移動の合図を受けて、ワークスペースの中の定義の画面へ移る", () => {
    render(
      <MemoryRouter initialEntries={["/w/ws1/process-flow/edit/f1"]}>
        <Routes><Route path="/w/:wsId/*" element={<><ReferenceNavigator /><Where /></>} /></Routes>
      </MemoryRouter>,
    );
    expect(screen.getByTestId("where")).toHaveTextContent("/w/ws1/process-flow/edit/f1");
    act(() => requestGoToReference(referenceAt("@screen.cart", 3)!));
    expect(screen.getByTestId("where")).toHaveTextContent("/w/ws1/screen/items/cart");
  });

  it("参照元の合図を受けて、参照元のダイアログを開く。調べられない種類では開かない", async () => {
    render(
      <MemoryRouter initialEntries={["/w/ws1/process-flow/edit/f1"]}>
        <Routes><Route path="/w/:wsId/*" element={<ReferenceNavigator />} /></Routes>
      </MemoryRouter>,
    );
    act(() => requestFindReferences(referenceAt("@msg.x", 3)!));
    expect(screen.queryByTestId("references-dialog")).toBeNull();
    act(() => requestFindReferences(referenceAt("@table.orders", 3)!));
    expect(await screen.findByTestId("references-dialog")).toBeInTheDocument();
  });
});
