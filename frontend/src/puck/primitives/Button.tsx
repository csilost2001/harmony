/**
 * Button primitive — ボタン (button)。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface ButtonProps extends LayoutProps {
  label?: string;
  variant?: "primary" | "secondary" | "danger" | "outline";
  size?: "sm" | "md" | "lg";
  fullWidth?: boolean;
}

export const ButtonConfig: ComponentConfig<ButtonProps> = {
  label: "ボタン",
  fields: {
    label: { type: "text", label: "ボタンテキスト" },
    variant: {
      type: "select",
      label: "種類",
      options: [
        { label: "プライマリ", value: "primary" },
        { label: "セカンダリ", value: "secondary" },
        { label: "危険", value: "danger" },
        { label: "アウトライン", value: "outline" },
      ],
    },
    size: {
      type: "select",
      label: "サイズ",
      options: [
        { label: "小 (sm)", value: "sm" },
        { label: "中 (md)", value: "md" },
        { label: "大 (lg)", value: "lg" },
      ],
    },
    fullWidth: { type: "radio", label: "全幅", options: [
      { label: "はい", value: true },
      { label: "いいえ", value: false },
    ] },
  },
  defaultProps: { label: "ボタン", variant: "primary", size: "md", fullWidth: false },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);

    let buttonClass: string;
    if (framework === "bootstrap") {
      const variantMap = { primary: "btn-primary", secondary: "btn-secondary", danger: "btn-danger", outline: "btn-outline-secondary" };
      const sizeMap = { sm: "btn-sm", md: "", lg: "btn-lg" };
      buttonClass = [
        "btn",
        variantMap[props.variant ?? "primary"],
        sizeMap[props.size ?? "md"],
        props.fullWidth ? "w-100" : "",
      ].filter(Boolean).join(" ");
    } else {
      const variantMap = { primary: "bg-blue-600 text-white hover:bg-blue-700", secondary: "bg-gray-600 text-white hover:bg-gray-700", danger: "bg-red-600 text-white hover:bg-red-700", outline: "border border-gray-400 text-gray-700 hover:bg-gray-50" };
      const sizeMap = { sm: "px-3 py-1 text-sm", md: "px-4 py-2", lg: "px-6 py-3 text-lg" };
      buttonClass = [
        "rounded font-medium cursor-pointer",
        variantMap[props.variant ?? "primary"],
        sizeMap[props.size ?? "md"],
        props.fullWidth ? "w-full" : "",
      ].filter(Boolean).join(" ");
    }

    const combinedClass = [buttonClass, layoutClass].filter(Boolean).join(" ");
    return <button data-testid="puck-primitive-button" className={combinedClass} type="button">{props.label}</button>;
  },
};
