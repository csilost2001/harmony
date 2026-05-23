// #1260 Phase 3: ErrorCatalogPanel の exceptionTypeRef 入力欄追加の rendering / onChange test。

import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { ProcessFlow } from "../../types/v3";
import { ErrorCatalogPanel } from "./ErrorCatalogPanel";

function groupWith(errors: Record<string, Partial<{ httpStatus: number; defaultMessage: string; description: string; exceptionTypeRef: string }>>): ProcessFlow {
  return {
    schemaVersion: 3,
    schemaUri: "",
    actions: [],
    context: { catalogs: { errors } },
  } as unknown as ProcessFlow;
}

describe("ErrorCatalogPanel — exceptionTypeRef 入力欄 (#1260 B)", () => {
  it("既存 entry に exceptionTypeRef 入力欄が描画される", () => {
    const group = groupWith({
      STOCK_SHORTAGE: { exceptionTypeRef: "generic-definitions/exception-type/StockShortage" },
    });
    const { container } = render(
      <ErrorCatalogPanel group={group} onChange={() => {}} render="bodyOnly" />,
    );
    expect(container.textContent).toContain("exceptionTypeRef");
    const input = container.querySelector(
      'input[placeholder^="例: generic-definitions/exception-type/"]',
    ) as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(input.value).toBe("generic-definitions/exception-type/StockShortage");
  });

  it("exceptionTypeRef 変更で onChange が呼ばれる (raw storage 形式で保存)", () => {
    const group = groupWith({
      STOCK_SHORTAGE: {},
    });
    const onChange = vi.fn();
    const { container } = render(
      <ErrorCatalogPanel group={group} onChange={onChange} render="bodyOnly" />,
    );
    const input = container.querySelector(
      'input[placeholder^="例: generic-definitions/exception-type/"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "generic-definitions/exception-type/Foo" },
    });
    expect(onChange).toHaveBeenCalled();
    const lastCall = onChange.mock.calls.at(-1)![0] as ProcessFlow;
    expect(lastCall.context?.catalogs?.errors?.STOCK_SHORTAGE.exceptionTypeRef).toBe(
      "generic-definitions/exception-type/Foo",
    );
  });

  it("空文字に戻すと exceptionTypeRef は undefined になる", () => {
    const group = groupWith({
      STOCK_SHORTAGE: { exceptionTypeRef: "generic-definitions/exception-type/Foo" },
    });
    const onChange = vi.fn();
    const { container } = render(
      <ErrorCatalogPanel group={group} onChange={onChange} render="bodyOnly" />,
    );
    const input = container.querySelector(
      'input[placeholder^="例: generic-definitions/exception-type/"]',
    ) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "" } });
    const lastCall = onChange.mock.calls.at(-1)![0] as ProcessFlow;
    expect(lastCall.context?.catalogs?.errors?.STOCK_SHORTAGE.exceptionTypeRef).toBeUndefined();
  });
});
