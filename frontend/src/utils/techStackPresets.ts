/**
 * 技術スタックのプリセット。よくある組み合わせを 1 回の選択で入れる (スキーマの選択肢のうち、組み合わせの制約を満たすものだけ)。
 * 選択肢そのもの (言語・フレームワークの種類) を増やすには、スキーマの変更 (設計者の判断) が要る。プリセットは、既存の選択肢の組み合わせを選ぶだけ。
 * 画面デザインの設定 (designer) は、プリセットでは変えない。
 */
import type { HarmonyTechStack } from "../types/v3/harmony";

export interface TechStackPreset {
  id: string;
  label: string;
  description: string;
  stack: Required<Pick<HarmonyTechStack, "backend" | "database" | "frontend" | "auth" | "deployment">>;
}

export const TECH_STACK_PRESETS: readonly TechStackPreset[] = [
  { id: "java-enterprise", label: "Java 業務システム (Spring Boot + PostgreSQL)", description: "社内の業務システムで多い構成。React (Vite) の画面 + JWT 認証 + Docker。",
    stack: { backend: { language: "java", framework: "spring-boot" }, database: { type: "postgresql", version: "16" }, frontend: { library: "react", framework: "vite" }, auth: { method: "jwt" }, deployment: { target: "docker" } } },
  { id: "java-onprem", label: "Java 基幹・オンプレ (Spring Boot + Oracle + Thymeleaf)", description: "サーバ側で画面を作る従来型の構成。セッション認証 + 仮想マシン / オンプレ。",
    stack: { backend: { language: "java", framework: "spring-boot" }, database: { type: "oracle" }, frontend: { library: "thymeleaf", framework: "none" }, auth: { method: "session" }, deployment: { target: "vm" } } },
  { id: "kotlin-spring", label: "Kotlin (Spring Boot + PostgreSQL)", description: "Kotlin で書く Spring Boot。React (Vite) + JWT + Docker。",
    stack: { backend: { language: "kotlin", framework: "spring-boot" }, database: { type: "postgresql", version: "16" }, frontend: { library: "react", framework: "vite" }, auth: { method: "jwt" }, deployment: { target: "docker" } } },
  { id: "ts-fullstack", label: "TypeScript フルスタック (NestJS + PostgreSQL + Next.js)", description: "言語を TypeScript にそろえる構成。OAuth2 + Cloud Run。",
    stack: { backend: { language: "typescript", framework: "nestjs" }, database: { type: "postgresql", version: "16" }, frontend: { library: "react", framework: "next" }, auth: { method: "oauth2" }, deployment: { target: "cloud-run" } } },
  { id: "ts-light", label: "TypeScript 軽量 (Express + MySQL + React)", description: "小さく始める構成。セッション認証 + Docker。",
    stack: { backend: { language: "typescript", framework: "express" }, database: { type: "mysql", version: "8.0" }, frontend: { library: "react", framework: "vite" }, auth: { method: "session" }, deployment: { target: "docker" } } },
  { id: "python-vue", label: "Python (FastAPI + PostgreSQL + Vue / Nuxt)", description: "FastAPI の API と Vue (Nuxt) の画面。OAuth2 + Cloud Run。",
    stack: { backend: { language: "python", framework: "fastapi" }, database: { type: "postgresql", version: "16" }, frontend: { library: "vue", framework: "nuxt" }, auth: { method: "oauth2" }, deployment: { target: "cloud-run" } } },
  { id: "go-k8s", label: "Go (Gin + PostgreSQL) + Kubernetes", description: "API 中心の構成。画面は React (Vite)、JWT 認証、Kubernetes にデプロイ。",
    stack: { backend: { language: "go", framework: "gin" }, database: { type: "postgresql", version: "16" }, frontend: { library: "react", framework: "vite" }, auth: { method: "jwt" }, deployment: { target: "kubernetes" } } },
];

/** プリセットを、現在の設定に重ねる (画面デザインの設定は、そのまま残す) */
export function applyPreset(current: HarmonyTechStack, preset: TechStackPreset): HarmonyTechStack {
  return { ...current, ...structuredClone(preset.stack) };
}
