/**
 * Textarea primitive — 複数行テキスト入力 (textarea)。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface TextareaProps extends LayoutProps {
  label?: string;
  placeholder?: string;
  rows?: number;
  required?: boolean;
}

export const TextareaConfig: ComponentConfig<TextareaProps> = {
  label: "テキストエリア",
  fields: {
    label: { type: "text", label: "ラベル" },
    placeholder: { type: "text", label: "プレースホルダー" },
    rows: { type: "number", label: "行数", min: 2, max: 20 },
    required: { type: "radio", label: "必須", options: [
      { label: "はい", value: true },
      { label: "いいえ", value: false },
    ] },
  },
  defaultProps: { label: "メモ", placeholder: "入力してください", rows: 4, required: false },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const textareaClass = framework === "bootstrap" ? "form-control" : "border border-gray-300 rounded-md px-3 py-2 w-full";
    const wrapperClass = framework === "bootstrap" ? "mb-3" : "mb-4";
    return (
      <div data-testid="puck-primitive-textarea" className={[wrapperClass, layoutClass].filter(Boolean).join(" ")}>
        {props.label && (
          <label className={framework === "bootstrap" ? "form-label" : "block text-sm font-medium mb-1"}>
            {props.label}
            {props.required && <span className={framework === "bootstrap" ? "text-danger ms-1" : "text-red-500 ml-1"}>*</span>}
          </label>
        )}
        <textarea
          placeholder={props.placeholder}
          rows={props.rows ?? 4}
          className={textareaClass}
          readOnly
        />
      </div>
    );
  },
};
