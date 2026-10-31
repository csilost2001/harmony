import { describe, it, expect } from "vitest";
import { TECH_STACK_PRESETS, applyPreset } from "./techStackPresets";
import { validateTechStackConstraints } from "./techStackConstraints";

describe("技術スタックのプリセット", () => {
  it("すべてのプリセットが、組み合わせの制約を満たす", () => {
    for (const p of TECH_STACK_PRESETS) expect(validateTechStackConstraints(p.stack), p.id).toEqual([]);
  });
  it("id は重複せず、スキーマの選択肢 (列挙値) だけを使う", () => {
    expect(new Set(TECH_STACK_PRESETS.map((p) => p.id)).size).toBe(TECH_STACK_PRESETS.length);
    const langs = ["java", "typescript", "python", "go", "kotlin"], fws = ["spring-boot", "nestjs", "express", "fastapi", "gin"], dbs = ["postgresql", "mysql", "sqlite", "oracle", "sqlserver"];
    const libs = ["react", "vue", "thymeleaf", "blade", "none"], ffws = ["next", "nuxt", "vite", "none"], auths = ["jwt", "session", "oauth2", "saml", "none"], deps = ["docker", "vm", "lambda", "cloud-run", "kubernetes"];
    for (const { stack: s, id } of TECH_STACK_PRESETS) {
      expect(langs).toContain(s.backend.language); expect(fws).toContain(s.backend.framework); expect(dbs).toContain(s.database.type);
      expect(libs).toContain(s.frontend.library); expect(ffws).toContain(s.frontend.framework); expect(auths).toContain(s.auth.method); expect(deps).toContain(s.deployment.target);
      expect(id).toMatch(/^[a-z0-9-]+$/);
    }
  });
  it("TypeScript 系のプリセットは orm が prisma (推奨)、それ以外の言語は orm を持たない", () => {
    for (const { stack: s, id } of TECH_STACK_PRESETS) {
      if (s.backend.language === "typescript") expect(s.backend.orm, id).toBe("prisma");
      else expect(s.backend.orm, id).toBeUndefined();
    }
    expect(TECH_STACK_PRESETS.filter((p) => p.stack.backend.language === "typescript").map((p) => p.id)).toEqual(["ts-fullstack", "ts-light"]);
  });
  it("適用すると、画面デザインの設定は残し、そのほかを置き換える。元の設定は書き換えない", () => {
    const current = { designer: { cssFramework: "tailwind" as const }, backend: { language: "go" as const, framework: "gin" as const } };
    const next = applyPreset(current, TECH_STACK_PRESETS[0]);
    expect(next.designer).toEqual({ cssFramework: "tailwind" });
    expect(next.backend).toEqual({ language: "java", framework: "spring-boot" });
    expect(current.backend.language).toBe("go");
    next.backend!.language = "python";
    expect(TECH_STACK_PRESETS[0].stack.backend.language).toBe("java"); // プリセット自体は変わらない
  });
});
