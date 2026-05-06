/**
 * InputGroup primitive — 入力フィールド + ボタン の業務複合。
 *
 * 検索バーパターン等に使用する。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface InputGroupProps extends LayoutProps {
  placeholder?: string;
  buttonLabel?: string;
  inputType?: "text" | "search" | "email";
}

export const InputGroupConfig: ComponentConfig<InputGroupProps> = {
  label: "入力グループ",
  fields: {
    placeholder: { type: "text", label: "プレースホルダー" },
    buttonLabel: { type: "text", label: "ボタンラベル" },
    inputType: {
      type: "select",
      label: "入力種別",
      options: [
        { label: "テキスト", value: "text" },
        { label: "検索", value: "search" },
        { label: "メール", value: "email" },
      ],
    },
  },
  defaultProps: { placeholder: "キーワードを入力", buttonLabel: "検索", inputType: "search" },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);

    if (framework === "bootstrap") {
      return (
        <div data-testid="puck-primitive-input-group" className={["input-group", layoutClass].filter(Boolean).join(" ")}>
          <input
            type={props.inputType ?? "search"}
            placeholder={props.placeholder}
            className="form-control"
            readOnly
          />
          <button className="btn btn-primary" type="button">{props.buttonLabel}</button>
        </div>
      );
    }
    return (
      <div data-testid="puck-primitive-input-group" className={["flex rounded-md overflow-hidden border border-gray-300", layoutClass].filter(Boolean).join(" ")}>
        <input
          type={props.inputType ?? "search"}
          placeholder={props.placeholder}
          className="flex-1 px-3 py-2 outline-none"
          readOnly
        />
        <button className="bg-blue-600 text-white px-4 py-2 font-medium hover:bg-blue-700" type="button">
          {props.buttonLabel}
        </button>
      </div>
    );
  },
};
