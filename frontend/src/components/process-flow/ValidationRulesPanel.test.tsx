// #1260 Phase 3: ValidationRulesPanel の severity + exceptionTypeRef 入力欄追加の rendering / onChange test。
// severity は pre-existing silent drift (schema にあるが UI 未実装) を同 PR で吸収。

import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { ValidationRule } from "../../types/v3";

// useWorkspaceReferences が内部で WS / store I/O を呼ぶため test 環境では mock して
// store fallback 削除等の将来変更で silent breakage しないよう固定する (S-1 review feedback)
vi.mock("../../hooks/useWorkspaceReferences", () => ({
  useWorkspaceReferences: () => ({
    screens: [],
    tables: [],
    viewDefinitions: [],
    processFlows: [],
    components: [],
    exceptionTypes: [],
    modelEndpoints: [],
    secrets: [],
    events: [],
  }),
}));

import { ValidationRulesPanel } from "./ValidationRulesPanel";

describe("ValidationRulesPanel — severity + exceptionTypeRef (#1260 B)", () => {
  it("既存 rule に severity select + exceptionTypeRef 入力欄が描画される", () => {
    const rules: ValidationRule[] = [
      {
        field: "quantity",
        type: "required",
        severity: "error",
        exceptionTypeRef: "generic-definitions/exception-type/StockShortage",
      } as ValidationRule,
    ];
    const { container } = render(
      <ValidationRulesPanel rules={rules} onChange={() => {}} />,
    );
    const severitySelect = container.querySelector('select[aria-label="severity"]') as HTMLSelectElement;
    expect(severitySelect).not.toBeNull();
    expect(severitySelect.value).toBe("error");
    const refInput = container.querySelector(
      'input[placeholder^="exceptionTypeRef"]',
    ) as HTMLInputElement;
    expect(refInput).not.toBeNull();
    expect(refInput.value).toBe("generic-definitions/exception-type/StockShortage");
  });

  it("severity 変更で onChange が呼ばれる", () => {
    const rules: ValidationRule[] = [{ field: "x", type: "required" } as ValidationRule];
    const onChange = vi.fn();
    const { container } = render(
      <ValidationRulesPanel rules={rules} onChange={onChange} />,
    );
    const select = container.querySelector('select[aria-label="severity"]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "msg" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({ severity: "msg" }),
    ]);
  });

  it("severity を未選択に戻すと undefined になる", () => {
    const rules: ValidationRule[] = [
      { field: "x", type: "required", severity: "error" } as ValidationRule,
    ];
    const onChange = vi.fn();
    const { container } = render(
      <ValidationRulesPanel rules={rules} onChange={onChange} />,
    );
    const select = container.querySelector('select[aria-label="severity"]') as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "" } });
    expect(onChange).toHaveBeenCalledWith([
      expect.not.objectContaining({ severity: expect.anything() }),
    ]);
  });

  it("rules 空 + 初期 collapsed で severity / exceptionTypeRef 入力欄は描画されない", () => {
    // panel は useState(list.length > 0) で初期展開を決めるので空 rules は collapsed
    const { container } = render(
      <ValidationRulesPanel rules={[]} onChange={() => {}} />,
    );
    expect(container.querySelector('select[aria-label="severity"]')).toBeNull();
    expect(container.querySelector('input[placeholder^="exceptionTypeRef"]')).toBeNull();
  });

  it("exceptionTypeRef 変更で onChange が呼ばれる (raw storage 形式)", () => {
    const rules: ValidationRule[] = [{ field: "x", type: "required" } as ValidationRule];
    const onChange = vi.fn();
    const { container } = render(
      <ValidationRulesPanel rules={rules} onChange={onChange} />,
    );
    const input = container.querySelector(
      'input[placeholder^="exceptionTypeRef"]',
    ) as HTMLInputElement;
    fireEvent.change(input, {
      target: { value: "generic-definitions/exception-type/Foo" },
    });
    expect(onChange).toHaveBeenCalledWith([
      expect.objectContaining({
        exceptionTypeRef: "generic-definitions/exception-type/Foo",
      }),
    ]);
  });
});
