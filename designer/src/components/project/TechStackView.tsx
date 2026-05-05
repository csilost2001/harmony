/**
 * 技術スタック選定画面 (#826)。
 *
 * AI コード生成のためのターゲット技術スタックをプロジェクト単位で設定する。
 * 設定値は project.techStack に永続化され、AI がコード生成時の指針として利用する。
 *
 * レイアウト:
 *   左ペイン (220px) — カテゴリツリー
 *   中央             — 選択中カテゴリのラジオ群 + 説明
 *   右ペイン (260px) — 選択サマリ + 制約違反 warning
 */

import { useState, useEffect, useCallback } from "react";
import { loadRawProject, saveTechStack } from "../../store/flowStore";
import { validateTechStackConstraints } from "../../utils/techStackConstraints";
import type {
  ProjectTechStack,
  TechStackDesigner,
  TechStackBackend,
  TechStackDatabase,
  TechStackFrontend,
  TechStackAuth,
  TechStackDeployment,
} from "../../types/v3/project";

// ── 定数 ───────────────────────────────────────────────────────────────────────

type CategoryId = "designer" | "backend" | "database" | "frontend" | "auth" | "deployment";

interface Category {
  id: CategoryId;
  label: string;
  icon: string;
}

const CATEGORIES: Category[] = [
  { id: "designer",   label: "デザイナー",     icon: "bi-brush" },
  { id: "backend",    label: "バックエンド",   icon: "bi-server" },
  { id: "database",   label: "データベース",   icon: "bi-database" },
  { id: "frontend",   label: "フロントエンド", icon: "bi-window" },
  { id: "auth",       label: "認証",           icon: "bi-shield-lock" },
  { id: "deployment", label: "デプロイ",       icon: "bi-cloud-upload" },
];

// ── ラジオ選択コンポーネント ──────────────────────────────────────────────────

interface RadioOption {
  value: string;
  label: string;
  description?: string;
}

interface RadioGroupProps {
  name: string;
  options: RadioOption[];
  value: string | undefined;
  onChange: (v: string) => void;
}

function RadioGroup({ name, options, value, onChange }: RadioGroupProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {options.map((opt) => (
        <label
          key={opt.value}
          style={{
            display: "flex", alignItems: "flex-start", gap: 8,
            padding: "10px 12px", borderRadius: 6, cursor: "pointer",
            background: value === opt.value ? "rgba(13,110,253,0.12)" : "rgba(255,255,255,0.04)",
            border: `1px solid ${value === opt.value ? "#0d6efd" : "rgba(255,255,255,0.1)"}`,
          }}
        >
          <input
            type="radio"
            name={name}
            value={opt.value}
            checked={value === opt.value}
            onChange={() => onChange(opt.value)}
            style={{ marginTop: 3, flexShrink: 0 }}
          />
          <div>
            <div style={{ fontWeight: 500, fontSize: 13 }}>{opt.label}</div>
            {opt.description && (
              <div style={{ fontSize: 11, color: "#888", marginTop: 2 }}>{opt.description}</div>
            )}
          </div>
        </label>
      ))}
    </div>
  );
}

// ── カテゴリパネル ──────────────────────────────────────────────────────────────

function DesignerPanel({
  value,
  onChange,
}: {
  value: TechStackDesigner;
  onChange: (v: TechStackDesigner) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 1 }}>
          エディタ種別
        </h4>
        <RadioGroup
          name="designer-editor-kind"
          value={value.editorKind ?? "grapesjs"}
          onChange={(v) => onChange({ ...value, editorKind: v as TechStackDesigner["editorKind"] })}
          options={[
            { value: "grapesjs", label: "GrapesJS",   description: "HTML 直接編集。Thymeleaf / React 両展開可。" },
            { value: "puck",     label: "Puck",        description: "React コンポーネントツリー編集。React 専用。" },
          ]}
        />
      </div>
      <div>
        <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 1 }}>
          CSS フレームワーク
        </h4>
        <RadioGroup
          name="designer-css-framework"
          value={value.cssFramework ?? "bootstrap"}
          onChange={(v) => onChange({ ...value, cssFramework: v as TechStackDesigner["cssFramework"] })}
          options={[
            { value: "bootstrap", label: "Bootstrap 5",  description: "Bootstrap 5 を canvas に読み込み。" },
            { value: "tailwind",  label: "Tailwind CSS", description: "Tailwind ベースの theme CSS を canvas に読み込み。" },
          ]}
        />
      </div>
    </div>
  );
}

function BackendPanel({
  value,
  onChange,
}: {
  value: TechStackBackend;
  onChange: (v: TechStackBackend) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 1 }}>
          言語
        </h4>
        <RadioGroup
          name="backend-language"
          value={value.language ?? "java"}
          onChange={(v) => onChange({ ...value, language: v as TechStackBackend["language"] })}
          options={[
            { value: "java",       label: "Java" },
            { value: "kotlin",     label: "Kotlin" },
            { value: "typescript", label: "TypeScript" },
            { value: "python",     label: "Python" },
            { value: "go",         label: "Go" },
          ]}
        />
      </div>
      <div>
        <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 1 }}>
          フレームワーク
        </h4>
        <RadioGroup
          name="backend-framework"
          value={value.framework ?? "spring-boot"}
          onChange={(v) => onChange({ ...value, framework: v as TechStackBackend["framework"] })}
          options={[
            { value: "spring-boot", label: "Spring Boot", description: "Java / Kotlin" },
            { value: "nestjs",      label: "NestJS",      description: "TypeScript" },
            { value: "express",     label: "Express",     description: "TypeScript" },
            { value: "fastapi",     label: "FastAPI",     description: "Python" },
            { value: "gin",         label: "Gin",         description: "Go" },
          ]}
        />
      </div>
    </div>
  );
}

function DatabasePanel({
  value,
  onChange,
}: {
  value: TechStackDatabase;
  onChange: (v: TechStackDatabase) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 1 }}>
          データベース種別
        </h4>
        <RadioGroup
          name="database-type"
          value={value.type ?? "postgresql"}
          onChange={(v) => onChange({ ...value, type: v as TechStackDatabase["type"] })}
          options={[
            { value: "postgresql", label: "PostgreSQL" },
            { value: "mysql",      label: "MySQL" },
            { value: "sqlite",     label: "SQLite" },
            { value: "oracle",     label: "Oracle" },
            { value: "sqlserver",  label: "SQL Server" },
          ]}
        />
      </div>
      <div>
        <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 1 }}>
          バージョン (省略可)
        </h4>
        <input
          type="text"
          placeholder="例: 16, 8.0"
          value={value.version ?? ""}
          onChange={(e) => onChange({ ...value, version: e.target.value || undefined })}
          style={{
            background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: 6, padding: "8px 12px",
            color: "#fff", fontSize: 13, width: "100%",
            boxSizing: "border-box" as const,
          }}
        />
      </div>
    </div>
  );
}

function FrontendPanel({
  value,
  onChange,
}: {
  value: TechStackFrontend;
  onChange: (v: TechStackFrontend) => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
      <div>
        <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 1 }}>
          ライブラリ / テンプレート
        </h4>
        <RadioGroup
          name="frontend-library"
          value={value.library ?? "thymeleaf"}
          onChange={(v) => onChange({ ...value, library: v as TechStackFrontend["library"] })}
          options={[
            { value: "thymeleaf", label: "Thymeleaf", description: "Java / Kotlin サーバサイドテンプレート" },
            { value: "blade",     label: "Blade",     description: "PHP Laravel テンプレート" },
            { value: "react",     label: "React",     description: "SPA / SSR (Next.js, Vite)" },
            { value: "vue",       label: "Vue.js",    description: "SPA / SSR (Nuxt.js, Vite)" },
            { value: "none",      label: "なし",       description: "API のみ (REST/GraphQL)" },
          ]}
        />
      </div>
      <div>
        <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 1 }}>
          フレームワーク (省略可)
        </h4>
        <RadioGroup
          name="frontend-framework"
          value={value.framework ?? "none"}
          onChange={(v) => onChange({ ...value, framework: v as TechStackFrontend["framework"] })}
          options={[
            { value: "next",  label: "Next.js",  description: "React SSR / SSG" },
            { value: "nuxt",  label: "Nuxt.js",  description: "Vue.js SSR / SSG" },
            { value: "vite",  label: "Vite",     description: "React / Vue SPA" },
            { value: "none",  label: "なし" },
          ]}
        />
      </div>
    </div>
  );
}

function AuthPanel({
  value,
  onChange,
}: {
  value: TechStackAuth;
  onChange: (v: TechStackAuth) => void;
}) {
  return (
    <div>
      <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 1 }}>
        認証方式
      </h4>
      <RadioGroup
        name="auth-method"
        value={value.method ?? "session"}
        onChange={(v) => onChange({ ...value, method: v as TechStackAuth["method"] })}
        options={[
          { value: "session", label: "セッション認証", description: "サーバサイドセッション (Spring Security 等)" },
          { value: "jwt",     label: "JWT",            description: "JSON Web Token (Stateless)" },
          { value: "oauth2",  label: "OAuth 2.0",      description: "外部 IdP 連携 (Google, GitHub 等)" },
          { value: "saml",    label: "SAML",           description: "エンタープライズ SSO" },
          { value: "none",    label: "なし",            description: "認証不要" },
        ]}
      />
    </div>
  );
}

function DeploymentPanel({
  value,
  onChange,
}: {
  value: TechStackDeployment;
  onChange: (v: TechStackDeployment) => void;
}) {
  return (
    <div>
      <h4 style={{ margin: "0 0 12px", fontSize: 13, color: "#aaa", textTransform: "uppercase" as const, letterSpacing: 1 }}>
        デプロイターゲット
      </h4>
      <RadioGroup
        name="deployment-target"
        value={value.target ?? "docker"}
        onChange={(v) => onChange({ ...value, target: v as TechStackDeployment["target"] })}
        options={[
          { value: "docker",     label: "Docker",        description: "コンテナ (docker-compose / K8s)" },
          { value: "kubernetes", label: "Kubernetes",    description: "K8s クラスター" },
          { value: "cloud-run",  label: "Cloud Run",     description: "Google Cloud Run (Serverless コンテナ)" },
          { value: "lambda",     label: "AWS Lambda",    description: "Serverless Function" },
          { value: "vm",         label: "VM / オンプレ", description: "仮想マシンまたはオンプレミス" },
        ]}
      />
    </div>
  );
}

// ── サマリ行 ──────────────────────────────────────────────────────────────────

function SummarySection({ label, lines }: { label: string; lines: string[] }) {
  const nonEmpty = lines.filter(Boolean);
  if (nonEmpty.length === 0) return null;
  return (
    <div style={{ marginBottom: 14 }}>
      <div style={{ fontSize: 11, color: "#777", textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 4 }}>
        {label}
      </div>
      {nonEmpty.map((line, i) => (
        <div key={i} style={{ fontSize: 12, color: "#ccc" }}>{line}</div>
      ))}
    </div>
  );
}

// ── メインビュー ───────────────────────────────────────────────────────────────

export function TechStackView() {
  const [activeCategory, setActiveCategory] = useState<CategoryId>("designer");
  const [techStack, setTechStack] = useState<ProjectTechStack>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const violations = validateTechStackConstraints(techStack);
  const hasViolations = violations.length > 0;

  useEffect(() => {
    let cancelled = false;
    loadRawProject().then((raw) => {
      if (!cancelled) {
        setTechStack(raw.techStack ?? {});
        setLoading(false);
      }
    }).catch(() => {
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  const handleSave = useCallback(async () => {
    if (hasViolations || saving) return;
    setSaving(true);
    setSaveSuccess(false);
    try {
      await saveTechStack(techStack);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch (e) {
      console.error("[TechStackView] save failed", e);
    } finally {
      setSaving(false);
    }
  }, [techStack, hasViolations, saving]);

  const updateDesigner   = useCallback((d: TechStackDesigner)   => setTechStack((ts) => ({ ...ts, designer:   d })), []);
  const updateBackend    = useCallback((b: TechStackBackend)    => setTechStack((ts) => ({ ...ts, backend:    b })), []);
  const updateDatabase   = useCallback((db: TechStackDatabase)  => setTechStack((ts) => ({ ...ts, database:   db })), []);
  const updateFrontend   = useCallback((f: TechStackFrontend)   => setTechStack((ts) => ({ ...ts, frontend:   f })), []);
  const updateAuth       = useCallback((a: TechStackAuth)       => setTechStack((ts) => ({ ...ts, auth:       a })), []);
  const updateDeployment = useCallback((dep: TechStackDeployment) => setTechStack((ts) => ({ ...ts, deployment: dep })), []);

  const activeCategory_ = CATEGORIES.find((c) => c.id === activeCategory);

  if (loading) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#888" }}>
        <i className="bi bi-hourglass-split" style={{ marginRight: 8 }} />
        読み込み中...
      </div>
    );
  }

  return (
    <div style={{
      display: "flex", height: "100%", overflow: "hidden",
      background: "var(--bg-color, #1a1a1a)",
      color: "var(--text-color, #f0f0f0)",
      fontFamily: "system-ui, sans-serif",
    }}>
      {/* 左ペイン: カテゴリツリー */}
      <div style={{
        width: 220, flexShrink: 0,
        borderRight: "1px solid rgba(255,255,255,0.1)",
        background: "rgba(0,0,0,0.25)",
        display: "flex", flexDirection: "column", paddingTop: 8,
      }}>
        <div style={{ padding: "8px 16px", fontSize: 11, color: "#666", textTransform: "uppercase" as const, letterSpacing: 1 }}>
          カテゴリ
        </div>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setActiveCategory(cat.id)}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              padding: "10px 16px",
              border: "none",
              borderLeft: `3px solid ${activeCategory === cat.id ? "#0d6efd" : "transparent"}`,
              background: activeCategory === cat.id ? "rgba(13,110,253,0.18)" : "transparent",
              color: activeCategory === cat.id ? "#fff" : "#aaa",
              cursor: "pointer", fontSize: 13, textAlign: "left" as const,
              transition: "background 0.15s, color 0.15s",
            }}
          >
            <i className={`bi ${cat.icon}`} style={{ width: 16, flexShrink: 0 }} />
            {cat.label}
          </button>
        ))}
      </div>

      {/* 中央: 選択カテゴリのフォーム */}
      <div style={{ flex: 1, overflow: "auto", padding: "24px 28px" }}>
        <h2 style={{ margin: "0 0 20px", fontSize: 17, display: "flex", alignItems: "center", gap: 8 }}>
          {activeCategory_ && <i className={`bi ${activeCategory_.icon}`} />}
          {activeCategory_?.label}
        </h2>
        {activeCategory === "designer"   && <DesignerPanel   value={techStack.designer   ?? {}} onChange={updateDesigner}   />}
        {activeCategory === "backend"    && <BackendPanel    value={techStack.backend    ?? {}} onChange={updateBackend}    />}
        {activeCategory === "database"   && <DatabasePanel   value={techStack.database   ?? {}} onChange={updateDatabase}   />}
        {activeCategory === "frontend"   && <FrontendPanel   value={techStack.frontend   ?? {}} onChange={updateFrontend}   />}
        {activeCategory === "auth"       && <AuthPanel       value={techStack.auth       ?? {}} onChange={updateAuth}       />}
        {activeCategory === "deployment" && <DeploymentPanel value={techStack.deployment ?? {}} onChange={updateDeployment} />}

        {/* 保存ボタン */}
        <div style={{ marginTop: 32, display: "flex", alignItems: "center", gap: 12 }}>
          <button
            type="button"
            onClick={() => { void handleSave(); }}
            disabled={hasViolations || saving}
            style={{
              padding: "8px 20px", borderRadius: 6, border: "none",
              background: (hasViolations || saving) ? "#3a3a3a" : "#0d6efd",
              color: (hasViolations || saving) ? "#666" : "#fff",
              cursor: (hasViolations || saving) ? "not-allowed" : "pointer",
              fontSize: 13, fontWeight: 500, transition: "background 0.15s",
            }}
          >
            {saving
              ? <><i className="bi bi-hourglass-split" style={{ marginRight: 6 }} />保存中...</>
              : <><i className="bi bi-save" style={{ marginRight: 6 }} />保存</>}
          </button>
          {saveSuccess && (
            <span style={{ color: "#28a745", fontSize: 13 }}>
              <i className="bi bi-check-circle" style={{ marginRight: 4 }} />保存しました
            </span>
          )}
          {hasViolations && (
            <span style={{ color: "#dc3545", fontSize: 13 }}>
              <i className="bi bi-exclamation-triangle" style={{ marginRight: 4 }} />
              制約違反があるため保存できません
            </span>
          )}
        </div>
      </div>

      {/* 右ペイン: 選択サマリ + 制約違反 */}
      <div style={{
        width: 260, flexShrink: 0,
        borderLeft: "1px solid rgba(255,255,255,0.1)",
        padding: 16, overflow: "auto",
        background: "rgba(0,0,0,0.18)",
      }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "#888", textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 14 }}>
          現在の選択
        </div>
        <SummarySection label="デザイナー" lines={[
          techStack.designer?.editorKind   ? `エディタ: ${techStack.designer.editorKind}`   : "",
          techStack.designer?.cssFramework ? `CSS: ${techStack.designer.cssFramework}`       : "",
        ]} />
        <SummarySection label="バックエンド" lines={[
          techStack.backend?.language  ? `言語: ${techStack.backend.language}`              : "",
          techStack.backend?.framework ? `FW: ${techStack.backend.framework}`               : "",
        ]} />
        <SummarySection label="データベース" lines={[
          techStack.database?.type    ? `種別: ${techStack.database.type}`                  : "",
          techStack.database?.version ? `バージョン: ${techStack.database.version}`          : "",
        ]} />
        <SummarySection label="フロントエンド" lines={[
          techStack.frontend?.library   ? `ライブラリ: ${techStack.frontend.library}`       : "",
          techStack.frontend?.framework ? `FW: ${techStack.frontend.framework}`             : "",
        ]} />
        <SummarySection label="認証" lines={[
          techStack.auth?.method ? `方式: ${techStack.auth.method}` : "",
        ]} />
        <SummarySection label="デプロイ" lines={[
          techStack.deployment?.target ? `ターゲット: ${techStack.deployment.target}` : "",
        ]} />

        {/* 制約違反 */}
        {hasViolations && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: "#dc3545", textTransform: "uppercase" as const, letterSpacing: 1, marginBottom: 8 }}>
              <i className="bi bi-exclamation-triangle" style={{ marginRight: 4 }} />
              制約違反
            </div>
            {violations.map((v, i) => (
              <div
                key={i}
                style={{
                  background: "rgba(220,53,69,0.1)",
                  border: "1px solid rgba(220,53,69,0.3)",
                  borderRadius: 4, padding: "8px 10px", marginBottom: 8, fontSize: 12,
                }}
              >
                <div style={{ color: "#ff8080", fontWeight: 500, marginBottom: 2 }}>{v.field}</div>
                <div style={{ color: "#ccc" }}>{v.message}</div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
