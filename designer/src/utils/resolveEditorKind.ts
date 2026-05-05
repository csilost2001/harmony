/**
 * editorKind の解決ロジック (画面単位 + project default fallback)。
 *
 * 解決順序 (multi-editor-puck.md § 2.3):
 *   1. screen.design.editorKind (画面個別指定)
 *   2. project.techStack.designer.editorKind (project default)
 *   3. "grapesjs" (最終 default)
 *
 * 純粋関数 — テスト容易性のため副作用なし。
 * resolveCssFramework と同パターン (#806 子 2)。
 *
 * #806 子 3: editorKind 解決 helper
 * #826: projectTechStack 引数に変更 (project.techStack.designer 参照)
 */
import type { ScreenDesign } from "../types/v3/screen";
import type { ProjectTechStack } from "../types/v3/project";

/** エディタ種別。画面作成時に固定し、以降変更不可。 */
export type EditorKind = "grapesjs" | "puck";

/**
 * 画面 + プロジェクトの techStack 設定から editorKind を解決する。
 *
 * @param screenDesign      - 画面の design 設定 (screen.design)。未指定時は undefined。
 * @param projectTechStack  - プロジェクトの techStack 設定 (project.techStack)。未指定時は undefined。
 * @returns 解決された editorKind ("grapesjs" | "puck")
 */
export function resolveEditorKind(
  screenDesign: Pick<ScreenDesign, "editorKind"> | undefined,
  projectTechStack: Pick<ProjectTechStack, "designer"> | undefined,
): EditorKind {
  return screenDesign?.editorKind ?? projectTechStack?.designer?.editorKind ?? "grapesjs";
}
