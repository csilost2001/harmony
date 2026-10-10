/**
 * HarmonyTechStack の組合せ制約バリデーター (#826)。
 *
 * schema レベルでは表現が困難な言語 × フレームワーク / フロントエンドライブラリ × フレームワーク等の
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

  const frontendLib = techStack.frontend?.library;

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
