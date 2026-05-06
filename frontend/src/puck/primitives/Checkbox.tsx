/**
 * Checkbox primitive — チェックボックス (input[type=checkbox])。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface CheckboxProps extends LayoutProps {
  label?: string;
  checked?: boolean;
}

export const CheckboxConfig: ComponentConfig<CheckboxProps> = {
  label: "チェックボックス",
  fields: {
    label: { type: "text", label: "ラベル" },
    checked: { type: "radio", label: "初期状態", options: [
      { label: "チェックあり", value: true },
      { label: "チェックなし", value: false },
    ] },
  },
  defaultProps: { label: "チェックボックス", checked: false },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    if (framework === "bootstrap") {
      return (
        <div data-testid="puck-primitive-checkbox" className={["form-check", layoutClass].filter(Boolean).join(" ")}>
          <input
            type="checkbox"
            className="form-check-input"
            defaultChecked={props.checked}
            readOnly
          />
          <label className="form-check-label">{props.label}</label>
        </div>
      );
    }
    return (
      <div data-testid="puck-primitive-checkbox" className={["flex items-center gap-2", layoutClass].filter(Boolean).join(" ")}>
        <input
          type="checkbox"
          className="w-4 h-4"
          defaultChecked={props.checked}
          readOnly
        />
        <label className="text-sm">{props.label}</label>
      </div>
    );
  },
};
