import { describe, it, expect } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { useState } from "react";
import { ConvCompletionInput } from "./ConvCompletionInput";
import type { ProcessFlow } from "../../types/v3";
import type { ConventionsCatalog } from "../../schemas/conventionsValidator";

const conventions = { version: "1.0.0", msg: { required: { template: "必須" } } } as unknown as ConventionsCatalog;
const flow = {
  meta: { id: "pf", name: "f", kind: "screen" },
  actions: [{
    id: "a1", name: "a", trigger: "submit",
    inputs: [{ name: "userId", type: "string" }, { name: "amount", type: "number" }],
    steps: [],
  }],
} as unknown as ProcessFlow;

function Harness({ initial, withFlow }: { initial: string; withFlow: boolean }) {
  const [v, setV] = useState(initial);
  return <ConvCompletionInput value={v} onValueChange={setV} conventions={conventions} flow={withFlow ? flow : undefined} stepId="s1" />;
}

function typeAt(input: HTMLElement, text: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value: text, selectionStart: text.length } });
}

describe("ConvCompletionInput", () => {
  it("flow が無ければ @conv だけ補完する (候補の名前は @conv 補完候補)", () => {
    render(<Harness initial="" withFlow={false} />);
    const input = screen.getByRole("textbox");
    typeAt(input, "@conv.");
    expect(screen.getByRole("listbox", { name: "@conv 補完候補" })).toBeInTheDocument();
    typeAt(input, "@inputs.");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("flow があれば、条件・式の欄でも @inputs. などが補完される", () => {
    render(<Harness initial="" withFlow />);
    const input = screen.getByRole("textbox");
    typeAt(input, "@inputs.");
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options.some((t) => t.startsWith("userId"))).toBe(true);
    expect(options.some((t) => t.startsWith("amount"))).toBe(true);
  });

  it("部分一致でも絞り込める (2 文字以上)。前方一致が先", () => {
    render(<Harness initial="" withFlow />);
    const input = screen.getByRole("textbox");
    typeAt(input, "@inputs.mou");
    const options = screen.getAllByRole("option").map((o) => o.textContent ?? "");
    expect(options).toHaveLength(1);
    expect(options[0]).toContain("amount");
  });
});
