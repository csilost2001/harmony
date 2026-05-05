/**
 * Designer.tsx の cssFramework 解決ロジックのユニットテスト (#806 子 2)。
 *
 * resolveCssFramework(screenDesign, projectTechStack) の純粋関数を対象に、
 * 3 シナリオを検証する:
 *   - 画面 A: screen.design.cssFramework = "tailwind" → "tailwind"
 *   - 画面 B: screen.design.cssFramework = undefined + project.techStack.designer.cssFramework = "tailwind" → "tailwind"
 *   - 画面 C: 両方 undefined → "bootstrap" (最終 default)
 *
 * 仕様書参照: docs/spec/css-framework-switching.md § 1.3.1
 *             docs/spec/multi-editor-puck.md § 2.3
 * #826: projectTechStack 引数に変更
 */
import { describe, it, expect } from "vitest";
import { resolveCssFramework } from "../utils/resolveCssFramework";

describe("resolveCssFramework", () => {
  it("画面 A: screen.design.cssFramework が 'tailwind' のとき 'tailwind' を返す", () => {
    const screenDesign = { cssFramework: "tailwind" as const };
    const projectTechStack = { designer: { cssFramework: "bootstrap" as const } };
    expect(resolveCssFramework(screenDesign, projectTechStack)).toBe("tailwind");
  });

  it("画面 B: screen.design.cssFramework が undefined のとき project.techStack.designer.cssFramework にフォールバックする", () => {
    const screenDesign = { cssFramework: undefined };
    const projectTechStack = { designer: { cssFramework: "tailwind" as const } };
    expect(resolveCssFramework(screenDesign, projectTechStack)).toBe("tailwind");
  });

  it("画面 C: 両方 undefined のとき 'bootstrap' を返す", () => {
    expect(resolveCssFramework(undefined, undefined)).toBe("bootstrap");
  });

  it("screen.design 自体が undefined のとき project.techStack.designer.cssFramework にフォールバックする", () => {
    const projectTechStack = { designer: { cssFramework: "tailwind" as const } };
    expect(resolveCssFramework(undefined, projectTechStack)).toBe("tailwind");
  });

  it("screen.design.cssFramework が 'bootstrap' のとき project が tailwind でも 'bootstrap' を返す", () => {
    const screenDesign = { cssFramework: "bootstrap" as const };
    const projectTechStack = { designer: { cssFramework: "tailwind" as const } };
    expect(resolveCssFramework(screenDesign, projectTechStack)).toBe("bootstrap");
  });

  it("project.techStack に designer がない場合 'bootstrap' を返す", () => {
    expect(resolveCssFramework(undefined, {})).toBe("bootstrap");
  });
});
