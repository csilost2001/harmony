import { describe, it, expect } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { ReferenceNavigator } from "./ReferenceNavigator";
import { requestGoToReference, referenceAt } from "../../utils/referenceTarget";

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
});
