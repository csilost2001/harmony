/**
 * techStackConstraints.ts のユニットテスト (#826)。
 *
 * 5 制約ルールを全て網羅:
 *   1. editorKind=puck → frontend.library="react" 必須
 *   2. BE 言語 ↔ BE フレームワーク matrix 制約
 *   3. thymeleaf | blade → editorKind=grapesjs 必須
 *   4. vue → framework は nuxt | vite | none のみ
 *   5. react → framework は next | vite | none のみ
 */
import { describe, it, expect } from "vitest";
import { validateTechStackConstraints } from "./techStackConstraints";

describe("validateTechStackConstraints", () => {
  it("undefined を渡すと空配列を返す", () => {
    expect(validateTechStackConstraints(undefined)).toEqual([]);
  });

  it("空オブジェクトを渡すと空配列を返す (全フィールド省略時は制約なし)", () => {
    expect(validateTechStackConstraints({})).toEqual([]);
  });

  // ── 制約 1: puck → react 必須 ──────────────────────────────────────────────

  describe("制約 1: editorKind=puck → frontend.library='react' 必須", () => {
    it("puck + react の組合せは OK", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "puck" },
        frontend: { library: "react" },
      });
      expect(result).toHaveLength(0);
    });

    it("puck + thymeleaf は違反 (制約 1 と 3 の両方)", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "puck" },
        frontend: { library: "thymeleaf" },
      });
      expect(result.length).toBeGreaterThanOrEqual(2);
      expect(result.some((v) => v.field === "frontend.library")).toBe(true);
      expect(result.some((v) => v.field === "designer.editorKind")).toBe(true);
    });

    it("puck + vue は制約 1 違反", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "puck" },
        frontend: { library: "vue" },
      });
      expect(result.some((v) => v.field === "frontend.library")).toBe(true);
    });

    it("puck で frontend が未定義の場合は制約 1 は発動しない", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "puck" },
      });
      expect(result.some((v) => v.field === "frontend.library")).toBe(false);
    });

    it("grapesjs + thymeleaf は OK", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "grapesjs" },
        frontend: { library: "thymeleaf" },
      });
      expect(result).toHaveLength(0);
    });
  });

  // ── 制約 2: BE 言語 × フレームワーク matrix ─────────────────────────────────

  describe("制約 2: バックエンド言語 ↔ フレームワーク matrix", () => {
    it("java + spring-boot は OK", () => {
      const result = validateTechStackConstraints({
        backend: { language: "java", framework: "spring-boot" },
      });
      expect(result).toHaveLength(0);
    });

    it("typescript + nestjs は OK", () => {
      const result = validateTechStackConstraints({
        backend: { language: "typescript", framework: "nestjs" },
      });
      expect(result).toHaveLength(0);
    });

    it("typescript + express は OK", () => {
      const result = validateTechStackConstraints({
        backend: { language: "typescript", framework: "express" },
      });
      expect(result).toHaveLength(0);
    });

    it("python + fastapi は OK", () => {
      const result = validateTechStackConstraints({
        backend: { language: "python", framework: "fastapi" },
      });
      expect(result).toHaveLength(0);
    });

    it("go + gin は OK", () => {
      const result = validateTechStackConstraints({
        backend: { language: "go", framework: "gin" },
      });
      expect(result).toHaveLength(0);
    });

    it("kotlin + spring-boot は OK", () => {
      const result = validateTechStackConstraints({
        backend: { language: "kotlin", framework: "spring-boot" },
      });
      expect(result).toHaveLength(0);
    });

    it("java + nestjs は制約 2 違反", () => {
      const result = validateTechStackConstraints({
        backend: { language: "java", framework: "nestjs" },
      });
      expect(result.some((v) => v.field === "backend.framework")).toBe(true);
      expect(result[0].severity).toBe("error");
    });

    it("typescript + spring-boot は制約 2 違反", () => {
      const result = validateTechStackConstraints({
        backend: { language: "typescript", framework: "spring-boot" },
      });
      expect(result.some((v) => v.field === "backend.framework")).toBe(true);
    });

    it("python + gin は制約 2 違反", () => {
      const result = validateTechStackConstraints({
        backend: { language: "python", framework: "gin" },
      });
      expect(result.some((v) => v.field === "backend.framework")).toBe(true);
    });

    it("go + fastapi は制約 2 違反", () => {
      const result = validateTechStackConstraints({
        backend: { language: "go", framework: "fastapi" },
      });
      expect(result.some((v) => v.field === "backend.framework")).toBe(true);
    });

    it("言語のみ指定でフレームワーク未指定の場合は制約なし", () => {
      const result = validateTechStackConstraints({
        backend: { language: "java" },
      });
      expect(result).toHaveLength(0);
    });
  });

  // ── 制約 3: thymeleaf | blade → editorKind=grapesjs ──────────────────────

  describe("制約 3: thymeleaf | blade → editorKind=grapesjs 必須", () => {
    it("thymeleaf + puck は制約 3 違反", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "puck" },
        frontend: { library: "thymeleaf" },
      });
      expect(result.some((v) => v.field === "designer.editorKind")).toBe(true);
    });

    it("blade + puck は制約 3 違反", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "puck" },
        frontend: { library: "blade" },
      });
      expect(result.some((v) => v.field === "designer.editorKind")).toBe(true);
    });

    it("thymeleaf + grapesjs は OK", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "grapesjs" },
        frontend: { library: "thymeleaf" },
      });
      expect(result).toHaveLength(0);
    });

    it("blade + grapesjs は OK", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "grapesjs" },
        frontend: { library: "blade" },
      });
      expect(result).toHaveLength(0);
    });
  });

  // ── 制約 4: vue → framework は nuxt | vite | none のみ ─────────────────────

  describe("制約 4: vue → framework は nuxt | vite | none のみ", () => {
    it("vue + nuxt は OK", () => {
      const result = validateTechStackConstraints({
        frontend: { library: "vue", framework: "nuxt" },
      });
      expect(result).toHaveLength(0);
    });

    it("vue + vite は OK", () => {
      const result = validateTechStackConstraints({
        frontend: { library: "vue", framework: "vite" },
      });
      expect(result).toHaveLength(0);
    });

    it("vue + none は OK", () => {
      const result = validateTechStackConstraints({
        frontend: { library: "vue", framework: "none" },
      });
      expect(result).toHaveLength(0);
    });

    it("vue + next は制約 4 違反", () => {
      const result = validateTechStackConstraints({
        frontend: { library: "vue", framework: "next" },
      });
      expect(result.some((v) => v.field === "frontend.framework")).toBe(true);
    });
  });

  // ── 制約 5: react → framework は next | vite | none のみ ───────────────────

  describe("制約 5: react → framework は next | vite | none のみ", () => {
    it("react + next は OK", () => {
      const result = validateTechStackConstraints({
        frontend: { library: "react", framework: "next" },
      });
      expect(result).toHaveLength(0);
    });

    it("react + vite は OK", () => {
      const result = validateTechStackConstraints({
        frontend: { library: "react", framework: "vite" },
      });
      expect(result).toHaveLength(0);
    });

    it("react + none は OK", () => {
      const result = validateTechStackConstraints({
        frontend: { library: "react", framework: "none" },
      });
      expect(result).toHaveLength(0);
    });

    it("react + nuxt は制約 5 違反", () => {
      const result = validateTechStackConstraints({
        frontend: { library: "react", framework: "nuxt" },
      });
      expect(result.some((v) => v.field === "frontend.framework")).toBe(true);
    });
  });

  // ── 複合制約テスト ───────────────────────────────────────────────────────────

  describe("複合制約テスト", () => {
    it("全て valid な典型スタック (Java Spring + PostgreSQL + Thymeleaf + GrapesJS)", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "grapesjs", cssFramework: "bootstrap" },
        backend: { language: "java", framework: "spring-boot" },
        database: { type: "postgresql", version: "16" },
        frontend: { library: "thymeleaf" },
        auth: { method: "session" },
        deployment: { target: "docker" },
      });
      expect(result).toHaveLength(0);
    });

    it("全て valid な典型スタック (TypeScript Next + React + Puck)", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "puck", cssFramework: "tailwind" },
        backend: { language: "typescript", framework: "nestjs" },
        database: { type: "postgresql" },
        frontend: { library: "react", framework: "next" },
        auth: { method: "jwt" },
        deployment: { target: "docker" },
      });
      expect(result).toHaveLength(0);
    });

    it("複数違反が同時に検出される (puck + thymeleaf + java + gin)", () => {
      const result = validateTechStackConstraints({
        designer: { editorKind: "puck" },
        backend: { language: "java", framework: "gin" },
        frontend: { library: "thymeleaf" },
      });
      // 制約 1 (frontend.library), 2 (backend.framework), 3 (designer.editorKind) の 3 件
      expect(result.length).toBeGreaterThanOrEqual(3);
      expect(result.every((v) => v.severity === "error")).toBe(true);
    });
  });
});
