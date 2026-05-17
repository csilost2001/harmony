/**
 * cssFramework の解決ロジック (画面単位 + project default fallback)。
 *
 * 解決順序 (css-framework-switching.md § 1.3.1 / multi-editor-puck.md § 2.3):
 *   1. screen.design.cssFramework (画面個別指定)
 *   2. project.techStack.designer.cssFramework (project default)
 *   3. "bootstrap" (最終 default)
 *
 * 純粋関数 — テスト容易性のため副作用なし。
 *
 * #806 子 2: Designer.tsx の theme 解決ロジック画面単位化
 * #826: projectTechStack 引数に変更 (project.techStack.designer 参照)
 */
import type { CssFramework } from "../types/v3/harmony";
import type { ScreenDesign } from "../types/v3/screen";
import type { HarmonyTechStack } from "../types/v3/harmony";

export function resolveCssFramework(
  screenDesign: Pick<ScreenDesign, "cssFramework"> | undefined,
  projectTechStack: Pick<HarmonyTechStack, "designer"> | undefined,
): CssFramework {
  return screenDesign?.cssFramework ?? projectTechStack?.designer?.cssFramework ?? "bootstrap";
}
