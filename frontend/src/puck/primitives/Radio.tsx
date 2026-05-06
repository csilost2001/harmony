/**
 * Radio primitive — ラジオボタングループ。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface RadioProps extends LayoutProps {
  groupLabel?: string;
  option1?: string;
  option2?: string;
  option3?: string;
}

export const RadioConfig: ComponentConfig<RadioProps> = {
  label: "ラジオボタン",
  fields: {
    groupLabel: { type: "text", label: "グループラベル" },
    option1: { type: "text", label: "選択肢 1" },
    option2: { type: "text", label: "選択肢 2" },
    option3: { type: "text", label: "選択肢 3 (空白で非表示)" },
  },
  defaultProps: { groupLabel: "選択してください", option1: "選択肢 1", option2: "選択肢 2", option3: "" },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const options = [props.option1, props.option2, props.option3].filter(Boolean);
    const groupName = `radio-${Math.random().toString(36).slice(2, 8)}`;

    if (framework === "bootstrap") {
      return (
        <div data-testid="puck-primitive-radio" className={layoutClass || undefined}>
          {props.groupLabel && <label className="form-label fw-semibold">{props.groupLabel}</label>}
          {options.map((opt, i) => (
            <div key={i} className="form-check">
              <input type="radio" name={groupName} className="form-check-input" defaultChecked={i === 0} />
              <label className="form-check-label">{opt}</label>
            </div>
          ))}
        </div>
      );
    }
    return (
      <div data-testid="puck-primitive-radio" className={layoutClass || undefined}>
        {props.groupLabel && <p className="text-sm font-medium mb-2">{props.groupLabel}</p>}
        {options.map((opt, i) => (
          <div key={i} className="flex items-center gap-2 mb-1">
            <input type="radio" name={groupName} className="w-4 h-4" defaultChecked={i === 0} />
            <label className="text-sm">{opt}</label>
          </div>
        ))}
      </div>
    );
  },
};
