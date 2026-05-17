/**
 * HarmonyTechStack の組合せ制約バリデーター (#826)。
 *
 * schema レベルでは表現が困難な言語 × フレームワーク / エディタ × フロントエンド等の
 * 組合せ制約を TypeScript 関数として実装する。
 * 各違反は具体的な field path + 修正提案メッセージを返す。
 */
import type { HarmonyTechStack } from "../types/v3/harmony";

export interface TechStackConstraintViolation {
  field: string;
  message: string;
  severity: "error";
}

/** バックエンド言語とフレームワークの許容組合せ。
 * Kotlin は現状 Spring Boot のみ (将来 Ktor 等を schema enum に追加する際に本 map も拡張要)。 */
const BACKEND_LANG_FRAMEWORK_MAP: Record<string, string[]> = {
  java:       ["spring-boot"],
  typescript: ["nestjs", "express"],
  python:     ["fastapi"],
  go:         ["gin"],
  kotlin:     ["spring-boot"],
};

/**
 * HarmonyTechStack の組合せ制約を検証し、違反リストを返す。
 *
 * @param techStack - 検証対象の HarmonyTechStack。undefined の場合は空配列を返す。
 * @returns 違反リスト。空配列は制約なし (全 OK)。
 */
export function validateTechStackConstraints(
  techStack: HarmonyTechStack | undefined,
): TechStackConstraintViolation[] {
  if (!techStack) return [];

  const violations: TechStackConstraintViolation[] = [];

  // 制約 1: editorKind=puck → frontend.library="react" 必須
  // Puck は React コンポーネントを出力するため、react 以外と組み合わせると
  // 生成コードが意味をなさない。
  // lib が undefined のときは「過渡状態 (まだ frontend を設定していない)」として
  // 制約発動を見送る — techStack 全フィールドが optional なため
  // 設定途中で error 表示するのは UX を損なう。frontend.library を選んだ瞬間に違反検知される。
  if (techStack.designer?.editorKind === "puck") {
    const lib = techStack.frontend?.library;
    if (lib !== undefined && lib !== "react") {
      violations.push({
        field: "frontend.library",
        message: `Puck エディタは React 専用です。frontend.library を "react" に変更してください (現在: "${lib}")。`,
        severity: "error",
      });
    }
  }

  // 制約 2: バックエンド言語 ↔ フレームワーク matrix
  const lang = techStack.backend?.language;
  const framework = techStack.backend?.framework;
  if (lang !== undefined && framework !== undefined) {
    const allowed = BACKEND_LANG_FRAMEWORK_MAP[lang] ?? [];
    if (!allowed.includes(framework)) {
      violations.push({
        field: "backend.framework",
        message: `言語 "${lang}" に対して "${framework}" は未対応です。使用可能なフレームワーク: ${allowed.map((f) => `"${f}"`).join(", ")}。`,
        severity: "error",
      });
    }
  }

  // 制約 3: frontend.library: thymeleaf | blade → editorKind: grapesjs 必須
  // HTML ベーステンプレートエンジンと Puck (React ベース) は共存不可。
  const frontendLib = techStack.frontend?.library;
  if ((frontendLib === "thymeleaf" || frontendLib === "blade") && techStack.designer?.editorKind === "puck") {
    violations.push({
      field: "designer.editorKind",
      message: `frontend.library "${frontendLib}" (テンプレートエンジン) は Puck エディタと共存できません。designer.editorKind を "grapesjs" に変更してください。`,
      severity: "error",
    });
  }

  // 制約 4: frontend.library: vue → frontend.framework は nuxt | vite | none のみ
  if (frontendLib === "vue") {
    const fw = techStack.frontend?.framework;
    if (fw !== undefined && !["nuxt", "vite", "none"].includes(fw)) {
      violations.push({
        field: "frontend.framework",
        message: `Vue.js には frontend.framework "${fw}" は使用できません。"nuxt", "vite", "none" から選択してください。`,
        severity: "error",
      });
    }
  }

  // 制約 5: frontend.library: react → frontend.framework は next | vite | none のみ
  if (frontendLib === "react") {
    const fw = techStack.frontend?.framework;
    if (fw !== undefined && !["next", "vite", "none"].includes(fw)) {
      violations.push({
        field: "frontend.framework",
        message: `React には frontend.framework "${fw}" は使用できません。"next", "vite", "none" から選択してください。`,
        severity: "error",
      });
    }
  }

  return violations;
}
