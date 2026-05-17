import { describe, expect, it, vi } from "vitest";
import { fireEvent, render } from "@testing-library/react";
import { AutoResizeTextarea } from "./AutoResizeTextarea";

/**
 * AutoResizeTextarea: StepCard から抽出 (#1145)。
 * 入力値変更と onBlur ハンドリングが伝播することを確認。
 */
describe("AutoResizeTextarea", () => {
  it("初期値を表示する", () => {
    const { container } = render(
      <AutoResizeTextarea value="初期値" onChange={() => {}} />,
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.value).toBe("初期値");
  });

  it("入力変更時に onChange を発火", () => {
    const onChange = vi.fn();
    const { container } = render(
      <AutoResizeTextarea value="" onChange={onChange} />,
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: "hi" } });
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("blur 時に onBlur を発火", () => {
    const onBlur = vi.fn();
    const { container } = render(
      <AutoResizeTextarea value="x" onChange={() => {}} onBlur={onBlur} />,
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    fireEvent.blur(textarea);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it("placeholder と class を反映", () => {
    const { container } = render(
      <AutoResizeTextarea
        value=""
        onChange={() => {}}
        placeholder="ph"
        className="custom-class"
      />,
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.placeholder).toBe("ph");
    expect(textarea.className).toBe("custom-class");
  });

  it("className 未指定時は既定 class を使用", () => {
    const { container } = render(
      <AutoResizeTextarea value="" onChange={() => {}} />,
    );
    const textarea = container.querySelector("textarea") as HTMLTextAreaElement;
    expect(textarea.className).toBe("form-control form-control-sm auto-resize");
  });
});
