/**
 * Select primitive — セレクトボックス (select)。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface SelectProps extends LayoutProps {
  label?: string;
  placeholder?: string;
  required?: boolean;
}

export const SelectConfig: ComponentConfig<SelectProps> = {
  label: "セレクトボックス",
  fields: {
    label: { type: "text", label: "ラベル" },
    placeholder: { type: "text", label: "プレースホルダー" },
    required: { type: "radio", label: "必須", options: [
      { label: "はい", value: true },
      { label: "いいえ", value: false },
    ] },
  },
  defaultProps: { label: "選択", placeholder: "選択してください", required: false },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const selectClass = framework === "bootstrap" ? "form-select" : "border border-gray-300 rounded-md px-3 py-2 w-full";
    const wrapperClass = framework === "bootstrap" ? "mb-3" : "mb-4";
    return (
      <div data-testid="puck-primitive-select" className={[wrapperClass, layoutClass].filter(Boolean).join(" ")}>
        {props.label && (
          <label className={framework === "bootstrap" ? "form-label" : "block text-sm font-medium mb-1"}>
            {props.label}
            {props.required && <span className={framework === "bootstrap" ? "text-danger ms-1" : "text-red-500 ml-1"}>*</span>}
          </label>
        )}
        <select className={selectClass}>
          <option value="">{props.placeholder}</option>
          <option value="option1">選択肢 1</option>
          <option value="option2">選択肢 2</option>
        </select>
      </div>
    );
  },
};
