/**
 * FragmentsPanel unit tests (#1281)
 *
 * Screen.fragments[] CRUD + broken/重複 inline warning の rendering と onChange 契約を検証。
 * useWorkspaceReferences の全 field を固定 mock して store I/O を排除する
 * (ErrorCatalogPanel.test.tsx パターン踏襲)。
 */
import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { ScreenFragmentInstance } from "../../../../types/v3";

// useWorkspaceReferences が内部で WS / store I/O を呼ぶため test 環境では mock する
vi.mock("../../../../hooks/useWorkspaceReferences", () => ({
  useWorkspaceReferences: () => ({
    screens: [],
    tables: [],
    viewDefinitions: [],
    processFlows: [],
    fragments: [{ name: "messageArea" }, { name: "uploadRow" }],
    components: [],
    exceptionTypes: [],
    modelEndpoints: [],
    secrets: [],
    events: [],
  }),
}));

import { FragmentsPanel } from "./FragmentsPanel";

function makeFragment(fragmentRef: string, instanceId?: string): ScreenFragmentInstance {
  return instanceId !== undefined ? { fragmentRef, instanceId } : { fragmentRef };
}

describe("FragmentsPanel", () => {
  it("1. 既存 fragments が描画される (fragmentRef + instanceId 両方 input に値が入る)", () => {
    const frags = [makeFragment("generic-definitions/ui-fragment/messageArea", "errorArea")];
    const { container } = render(
      <FragmentsPanel fragments={frags} onChange={() => {}} readonly={false} defaultExpanded />,
    );
    const inputs = container.querySelectorAll("input");
    const fragmentRefInput = Array.from(inputs).find(
      (inp) => inp.placeholder.startsWith("例: generic-definitions/ui-fragment/"),
    ) as HTMLInputElement | undefined;
    expect(fragmentRefInput).not.toBeUndefined();
    expect(fragmentRefInput!.value).toBe("generic-definitions/ui-fragment/messageArea");

    const instanceIdInput = Array.from(inputs).find(
      (inp) => inp.placeholder === "例: errorArea",
    ) as HTMLInputElement | undefined;
    expect(instanceIdInput).not.toBeUndefined();
    expect(instanceIdInput!.value).toBe("errorArea");
  });

  it("2. fragmentRef 変更で onChange (full path 形式)", () => {
    const frags = [makeFragment("generic-definitions/ui-fragment/messageArea")];
    const onChange = vi.fn();
    const { container } = render(
      <FragmentsPanel fragments={frags} onChange={onChange} readonly={false} defaultExpanded />,
    );
    const fragmentRefInput = Array.from(container.querySelectorAll("input")).find(
      (inp) => inp.placeholder.startsWith("例: generic-definitions/ui-fragment/"),
    ) as HTMLInputElement;
    fireEvent.change(fragmentRefInput, {
      target: { value: "generic-definitions/ui-fragment/uploadRow" },
    });
    expect(onChange).toHaveBeenCalled();
    const result = onChange.mock.calls.at(-1)![0] as ScreenFragmentInstance[];
    expect(result[0].fragmentRef).toBe("generic-definitions/ui-fragment/uploadRow");
  });

  it("3. instanceId 空文字 → undefined", () => {
    const frags = [makeFragment("generic-definitions/ui-fragment/messageArea", "slot1")];
    const onChange = vi.fn();
    const { container } = render(
      <FragmentsPanel fragments={frags} onChange={onChange} readonly={false} defaultExpanded />,
    );
    const instanceIdInput = Array.from(container.querySelectorAll("input")).find(
      (inp) => inp.placeholder === "例: errorArea",
    ) as HTMLInputElement;
    fireEvent.change(instanceIdInput, { target: { value: "" } });
    expect(onChange).toHaveBeenCalled();
    const result = onChange.mock.calls.at(-1)![0] as ScreenFragmentInstance[];
    expect(result[0].instanceId).toBeUndefined();
  });

  it("4. 追加ボタンで空欄 fragment 追加 (onChange 引数長 +1、最後の要素 {fragmentRef: ''})", () => {
    const frags = [makeFragment("generic-definitions/ui-fragment/messageArea")];
    const onChange = vi.fn();
    const { container } = render(
      <FragmentsPanel fragments={frags} onChange={onChange} readonly={false} defaultExpanded />,
    );
    const addBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("追加"),
    );
    expect(addBtn).not.toBeUndefined();
    fireEvent.click(addBtn!);
    expect(onChange).toHaveBeenCalled();
    const result = onChange.mock.calls.at(-1)![0] as ScreenFragmentInstance[];
    expect(result).toHaveLength(2);
    expect(result.at(-1)).toEqual({ fragmentRef: "" });
  });

  it("5. 削除ボタンで該当 fragment 除去 (最後の 1 件削除で undefined)", () => {
    const frags = [makeFragment("generic-definitions/ui-fragment/messageArea")];
    const onChange = vi.fn();
    const { container } = render(
      <FragmentsPanel fragments={frags} onChange={onChange} readonly={false} defaultExpanded />,
    );
    const deleteBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.title === "削除",
    );
    expect(deleteBtn).not.toBeUndefined();
    fireEvent.click(deleteBtn!);
    expect(onChange).toHaveBeenCalled();
    const result = onChange.mock.calls.at(-1)![0];
    expect(result).toBeUndefined();
  });

  it("6. broken fragmentRef は warning icon (catalog 不在の name で warning)", () => {
    // "nonExistent" は mock catalog (messageArea / uploadRow) に存在しない
    const frags = [makeFragment("generic-definitions/ui-fragment/nonExistent")];
    const { container } = render(
      <FragmentsPanel fragments={frags} onChange={() => {}} readonly={false} defaultExpanded />,
    );
    const warningIcon = container.querySelector(".bi-exclamation-triangle.text-warning");
    expect(warningIcon).not.toBeNull();
  });

  it("7. (fragmentRef, instanceId) ペア重複は warning icon (同一 pair の 2 件で両方 warning)", () => {
    const frags = [
      makeFragment("generic-definitions/ui-fragment/messageArea", "slot1"),
      makeFragment("generic-definitions/ui-fragment/messageArea", "slot1"),
    ];
    const { container } = render(
      <FragmentsPanel fragments={frags} onChange={() => {}} readonly={false} defaultExpanded />,
    );
    const warningIcons = container.querySelectorAll(".bi-exclamation-triangle.text-warning");
    expect(warningIcons.length).toBeGreaterThanOrEqual(2);
  });

  it("8. readonly モードで input disabled + 追加/削除ボタン非表示", () => {
    const frags = [makeFragment("generic-definitions/ui-fragment/messageArea", "slot1")];
    const { container } = render(
      <FragmentsPanel fragments={frags} onChange={() => {}} readonly defaultExpanded />,
    );
    // input は disabled になっている
    const inputs = container.querySelectorAll("input");
    inputs.forEach((inp) => {
      expect(inp.disabled).toBe(true);
    });
    // 追加/削除ボタンは存在しない
    const deleteBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.title === "削除",
    );
    expect(deleteBtn).toBeUndefined();
    const addBtn = Array.from(container.querySelectorAll("button")).find(
      (btn) => btn.textContent?.includes("追加"),
    );
    expect(addBtn).toBeUndefined();
  });
});
