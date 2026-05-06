/**
 * Image primitive — 画像 (img)。
 *
 * #806 子 4
 */


import type { ComponentConfig } from "@measured/puck";
import { useCssFramework } from "../CssFrameworkContext";
import { resolveLayoutPropsMapper } from "../layoutPropsMapping";
import type { LayoutProps } from "../layoutPropsMapping/types";

export interface ImageProps extends LayoutProps {
  src?: string;
  alt?: string;
  width?: string;
  fluid?: boolean;
}

export const ImageConfig: ComponentConfig<ImageProps> = {
  label: "画像",
  fields: {
    src: { type: "text", label: "URL" },
    alt: { type: "text", label: "代替テキスト" },
    width: { type: "text", label: "幅 (例: 200px, 100%)" },
    fluid: { type: "radio", label: "レスポンシブ (最大幅 100%)", options: [
      { label: "はい", value: true },
      { label: "いいえ", value: false },
    ] },
  },
  defaultProps: { src: "https://placehold.co/400x200", alt: "画像", fluid: true },
  render: (props) => {
    const framework = useCssFramework();
    const mapper = resolveLayoutPropsMapper(framework);
    const layoutClass = mapper(props);
    const imgClass = framework === "bootstrap"
      ? (props.fluid ? "img-fluid" : "")
      : (props.fluid ? "max-w-full h-auto" : "");
    return (
      <img
        data-testid="puck-primitive-image"
        src={props.src ?? "https://placehold.co/400x200"}
        alt={props.alt ?? ""}
        style={props.width ? { width: props.width } : undefined}
        className={[imgClass, layoutClass].filter(Boolean).join(" ") || undefined}
      />
    );
  },
};
