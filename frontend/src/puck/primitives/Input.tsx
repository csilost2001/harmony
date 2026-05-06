/**
 * Input primitive — テキスト入力 (input)。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface InputProps extends LayoutProps {
  label?: string;
  placeholder?: string;
  inputType?: "text" | "email" | "password" | "number" | "tel" | "date";
  required?: boolean;
}

export const InputConfig: ComponentConfig<InputProps> = {
  label: "入力フィールド",
  fields: {
    label: { type: "text", label: "ラベル" },
    placeholder: { type: "text", label: "プレースホルダー" },
    inputType: {
      type: "select",
      label: "入力種別",
      options: [
        { label: "テキスト", value: "text" },
        { label: "メールアドレス", value: "email" },
        { label: "パスワード", value: "password" },
        { label: "数値", value: "number" },
        { label: "電話番号", value: "tel" },
        { label: "日付", value: "date" },
      ],
    },
    required: { type: "radio", label: "必須", options: [
      { label: "はい", value: true },
      { label: "いいえ", value: false },
    ] },
  },
  defaultProps: { label: "ラベル", placeholder: "入力してください", inputType: "text", required: false },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const inputClass = framework === "bootstrap" ? "form-control" : "border border-gray-300 rounded-md px-3 py-2 w-full";
    const wrapperClass = framework === "bootstrap" ? "mb-3" : "mb-4";
    return (
      <div data-testid="puck-primitive-input" className={[wrapperClass, layoutClass].filter(Boolean).join(" ")}>
        {props.label && (
          <label className={framework === "bootstrap" ? "form-label" : "block text-sm font-medium mb-1"}>
            {props.label}
            {props.required && <span className={framework === "bootstrap" ? "text-danger ms-1" : "text-red-500 ml-1"}>*</span>}
          </label>
        )}
        <input
          type={props.inputType ?? "text"}
          placeholder={props.placeholder}
          className={inputClass}
          readOnly
        />
      </div>
    );
  },
};
