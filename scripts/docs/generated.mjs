#!/usr/bin/env node
/**
 * AI 向けの資料のうち、正本 (スキーマ・サンプル・スキル・tool の定義) から**機械的に作るもの**。手で書くと、正本とずれるため。
 *
 *   docs/spec/schema-index.json              スキーマの索引 (ファイルごとの $defs の名前・要約・必須項目)
 *   docs/spec/process-flow-step-kinds.md     工程の種類の一覧 (種類・日本語名・スキーマの定義・必須の項目・固有の項目)
 *   docs/spec/process-flow-pitfalls.md       処理フロー作成の self-check ルールの一覧 (ai-skills/create-flow/SKILL.md の見出しから)
 *   docs/glossary.json                       用語集 (日本語の用語 ↔ スキーマ ↔ MCP tool ↔ 仕様書。工程の種類は自動、中心の用語は下の CORE_TERMS)
 *   examples/PATTERNS.md                     サンプルが示す工程のパターン (種類ごとの例の場所)
 *   docs/spec/schema-refs.json               参照の宣言 (x-ref-kind) の一覧 (項目・種類)
 *   shared/src/analysis/refKinds.generated.ts  項目名 → 参照先の種類 の表 (参照の整合の検査が使う)
 *
 * 使い方: node scripts/docs/generated.mjs [--write | --check]   (--check は npm run check:docs に含まれる。直し方: --write)
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (base, rel) => fs.readFileSync(path.join(base, rel), "utf8");
const exists = (base, rel) => fs.existsSync(path.join(base, rel));
const json = (v) => `${JSON.stringify(v, null, 2)}\n`;

/** 説明の最初の 1 文 (括弧の中の。では切らない) */
export function firstSentence(desc, max = 140) {
  if (typeof desc !== "string") return "";
  let depth = 0, end = -1;
  for (let i = 0; i < desc.length; i++) {
    const ch = desc[i];
    if (ch === "(" || ch === "（") depth++;
    else if ((ch === ")" || ch === "）") && depth > 0) depth--;
    else if (ch === "。" && depth === 0) { end = i; break; }
  }
  const s = (end >= 0 ? desc.slice(0, end + 1) : desc).replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const FRONTMATTER = (description, category = "schema") => `---\ndescription: ${JSON.stringify(description)}\nstatus: current\ncategory: ${category}\n---\n`;
const BANNER = "> **自動生成**: この文書は手で直さない。正本を直して `node scripts/docs/generated.mjs --write` で作り直す (ずれていると `npm run check:docs` が止める)。\n\n";

// ─── スキーマの索引 ─────────────────────────────────────────

export function buildSchemaIndex(base = root) {
  const dir = path.join(base, "schemas/v3");
  const files = [];
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".schema.json")).sort()) files.push({ rel: f, kind: f.replace(/\.v3\.schema\.json$/, ""), top: true });
  const gdir = path.join(dir, "generic-definitions");
  if (fs.existsSync(gdir)) for (const f of fs.readdirSync(gdir).filter((n) => n.endsWith(".schema.json")).sort()) files.push({ rel: `generic-definitions/${f}`, kind: `generic-definitions/${f.replace(/\.v3\.schema\.json$/, "")}`, top: false });
  const out = [];
  for (const { rel, kind, top } of files) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, rel), "utf8"));
    const defs = Object.entries(s.$defs ?? {}).map(([name, d]) => {
      const parts = Array.isArray(d.allOf) ? d.allOf : [];
      const required = [...new Set([...(d.required ?? []), ...parts.flatMap((p) => (p && p.required) || [])])];
      return {
        name, description: firstSentence(d.description ?? parts.map((p) => p?.description).find(Boolean) ?? ""),
        ...(d.enum ? { enum: d.enum.length } : {}), ...(d.oneOf ? { oneOf: d.oneOf.length } : {}), ...(required.length ? { required } : {}),
      };
    });
    out.push({
      file: `schemas/v3/${rel}`, kind, ...(top ? { uri: `harmony://schema/${kind}` } : {}), title: s.title ?? "", description: firstSentence(s.description ?? ""),
      // ルート自身の必須の項目 (ルートに $defs の定義名はない)。条件つきの必須 (if / then) は含まない
      ...(Array.isArray(s.required) && s.required.length ? { rootRequired: s.required } : {}), ...(s.$ref ? { rootRef: s.$ref } : {}),
      defCount: defs.length, defs,
    });
  }
  return json({ generatedFrom: "schemas/v3/**/*.schema.json (node scripts/docs/generated.mjs --write)", schemaVersion: "v3", schemas: out });
}

// ─── 参照の種類 (x-ref-kind) ────────────────────────────────

/**
 * スキーマの `x-ref-kind` 注釈を集める。項目名 → 種類 の対応は、参照の検査・改名・付け替えが同じ宣言を使うための正本。
 * 読むのは `properties.<名>` の直下と、その `items` だけ (`additionalProperties` の写像・`oneOf` の中の注釈は拾わない。そういう場所に付けるときは、ここも直す)。
 */
export function collectRefKinds(base = root) {
  const dir = path.join(base, "schemas/v3");
  const out = [];
  const files = fs.readdirSync(dir).filter((n) => n.endsWith(".schema.json")).sort();
  for (const f of files) {
    const s = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8"));
    const schema = f.replace(/\.v3\.schema\.json$/, "");
    const visit = (node, def, trail) => {
      if (Array.isArray(node)) { node.forEach((n, i) => visit(n, def, `${trail}[${i}]`)); return; }
      if (!node || typeof node !== "object") return;
      if (node.properties && typeof node.properties === "object") {
        for (const [name, p] of Object.entries(node.properties)) {
          if (!p || typeof p !== "object") continue;
          if (typeof p["x-ref-kind"] === "string") out.push({ schema, def, property: name, refKind: p["x-ref-kind"], many: false });
          else if (p.items && typeof p.items === "object" && typeof p.items["x-ref-kind"] === "string") out.push({ schema, def, property: name, refKind: p.items["x-ref-kind"], many: true });
        }
      }
      for (const [k, v] of Object.entries(node)) visit(v, def, `${trail}/${k}`);
    };
    for (const [name, d] of Object.entries(s.$defs ?? {})) visit(d, name, "");
    visit({ ...s, $defs: undefined }, "(root)", "");
  }
  return out;
}

export function buildRefKinds(base = root) {
  const refs = collectRefKinds(base);
  const kinds = [...new Set(refs.map((r) => r.refKind))].sort();
  return json({
    generatedFrom: "schemas/v3/*.schema.json の x-ref-kind (node scripts/docs/generated.mjs --write)",
    note: "項目名 → 参照先の種類。entity 種類 (table / screen / processFlow / view / viewDefinition / pageLayout / screenGroup) は設計の id、それ以外 (column / action / response / step / screenItem / screenEvent) は、ある設計の中の id。",
    kinds, count: refs.length, refs,
  });
}

/** shared が、スキーマを読まずに使えるように、項目名 → 種類 の表を TypeScript にする */
export function buildRefKindsTs(base = root) {
  const refs = collectRefKinds(base);
  const byName = new Map();
  for (const r of refs) { if (!byName.has(r.property)) byName.set(r.property, new Set()); byName.get(r.property).add(r.refKind); }
  const lines = [...byName].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([name, ks]) => `  ${JSON.stringify(name)}: ${JSON.stringify([...ks].sort())},`);
  return `// 自動生成: schemas/v3/*.schema.json の x-ref-kind から (node scripts/docs/generated.mjs --write)。手で直さない。\n/** 項目名 → 参照先の種類 (同じ名前で種類が複数あるときは、あいまいなので、検査は使わない) */\nexport const REF_KINDS_BY_PROPERTY: Readonly<Record<string, readonly string[]>> = {\n${lines.join("\n")}\n};\n`;
}

// ─── 工程の種類 ─────────────────────────────────────────────

/** shared/src/flowStructure.ts の STEP_KIND_LABELS を、ソースの文字から読む (ビルドの有無に左右されないように) */
function stepKindLabels(base) {
  const src = read(base, "shared/src/flowStructure.ts");
  const m = src.match(/export const STEP_KIND_LABELS[^=]*=\s*\{([\s\S]*?)\n\};/);
  const labels = {};
  if (m) for (const l of m[1].matchAll(/^\s*([A-Za-z]+):\s*"([^"]+)"/gm)) labels[l[1]] = l[2];
  return labels;
}

function stepKinds(base) {
  const schema = JSON.parse(read(base, "schemas/v3/process-flow.v3.schema.json"));
  const defs = schema.$defs;
  const labels = stepKindLabels(base);
  const rows = [];
  for (const ref of defs.Step.oneOf) {
    const name = ref.$ref.replace("#/$defs/", "");
    const d = defs[name];
    const parts = d.allOf ?? [];
    const own = parts.find((p) => p && p.properties && !p.$ref) ?? {};
    const kindProp = own.properties?.kind ?? {};
    const kind = kindProp.const ?? (name === "ExtensionStep" ? "namespace:StepName" : name);
    const required = (own.required ?? []).filter((r) => !["id", "kind", "description"].includes(r));
    // 条件つきの必須 (if: { properties: { x: { const: v } } } then: { required: [...] })
    const conditional = parts.filter((p) => p && p.if && p.then && Array.isArray(p.then.required)).map((p) => {
      const cond = Object.entries(p.if.properties ?? {}).map(([k, v]) => `${k}=${v?.const ?? JSON.stringify(v)}`).join(", ");
      return { when: cond, required: p.then.required };
    });
    const fields = Object.keys(own.properties ?? {}).filter((p) => p !== "kind");
    rows.push({ kind, label: labels[kind] ?? (name === "ExtensionStep" ? labels.extension : ""), def: name, required, conditional, fields, description: firstSentence(d.description ?? "") });
  }
  return rows;
}

export function buildStepKinds(base = root) {
  const rows = stepKinds(base);
  const lines = [
    FRONTMATTER("処理フローの工程の種類の一覧 (種類・日本語名・スキーマの定義・必須の項目・固有の項目)。スキーマから自動生成", "process-flow"),
    "# 処理フローの工程の種類\n",
    BANNER,
    `工程 (Step) は \`kind\` で種類を表す。組み込みの ${rows.length - 1} 種類と、拡張の工程 (\`namespace:StepName\`)。どの工程も \`id\` / \`kind\` / \`description\` は必須で、実行条件 (\`runIf\`)・備考 (\`notes\`)・成熟度 (\`maturity\`)・見出し (\`heading\`)・入れ子の工程 (\`subSteps\`)・失敗時の挙動 (\`errorHandling\`) などの共通の項目を持てる (スキーマの \`StepBaseProps\`)。\n`,
    "| kind | 日本語名 | スキーマの定義 | 常に必須の項目 | 条件つきで必須 | 固有の項目 |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| \`${r.kind}\` | ${r.label || ""} | \`${r.def}\` | ${r.required.map((x) => `\`${x}\``).join(", ") || "—"} | ${r.conditional.map((c) => `\`${c.when}\` のとき ${c.required.map((x) => `\`${x}\``).join(", ")}`).join("<br>") || "—"} | ${r.fields.slice(0, 10).map((x) => `\`${x}\``).join(", ") || "—"}${r.fields.length > 10 ? ` ほか ${r.fields.length - 10}` : ""} |`),
    "",
    "- 形の正本: `harmony://schema/process-flow` (`schemas/v3/process-flow.v3.schema.json`)。`$defs` の一覧と要約は [schema-index.json](schema-index.json)",
    "- 意味 (実行時の約束): [process-flow-runtime-conventions.md](process-flow-runtime-conventions.md)。式の書き方: [process-flow-expression-language.md](process-flow-expression-language.md)",
    "- 人が読む言葉での見え方: [process-flow-story-view.md](process-flow-story-view.md)",
    "",
  ];
  return lines.join("\n");
}

// ─── 処理フロー作成の self-check ルール ────────────────────────

export function buildPitfalls(base = root) {
  const src = read(base, "ai-skills/create-flow/SKILL.md");
  const rules = [...src.matchAll(/^###{0,1} Rule (\d+[a-z]?): (.+)$/gm)].map((m) => ({ no: m[1], title: m[2].replace(/\s*\((?:[^()]*(?:#\d+|retail|schema 制約|落とし穴)[^()]*)\)\s*$/, "").replace(/\s*\((?:#|retail).*$/, "").replace(/`/g, "").replace(/</g, "&lt;").replace(/>/g, "&gt;").trim() }));
  const lines = [
    FRONTMATTER("処理フロー作成の self-check ルール (よくある間違い) の一覧。create-flow スキルの見出しから自動生成", "process-flow"),
    "# 処理フロー作成の self-check ルール\n",
    BANNER,
    `処理フローを作る前に確かめる、過去の間違いから作ったルール ${rules.length} 件。**本文 (症状・正しい形・検出の方法) は、スキル \`create-flow\` にある** (MCP の Prompt \`create-flow\`、またはリポジトリの \`ai-skills/create-flow/SKILL.md\` の「Step 3」)。この表は、ルールを探す索引。レビューの観点は Prompt \`review-flow\`。\n`,
    "| Rule | 内容 |",
    "|---|---|",
    ...rules.map((r) => `| ${r.no} | ${r.title} |`),
    "",
    "- 機械で検出できるものは \`cd frontend && npm run validate:samples -- ../examples/<project-id>\` と \`designer__check_design\` が止める。意味 (架空の値・SQL の別名の取り違え) は目で確かめる",
    "",
  ];
  return lines.join("\n");
}

// ─── サンプルが示すパターン ────────────────────────────────

const CHILD_KEYS = ["steps", "subSteps", "onCommit", "onRollback", "onApproved", "onRejected", "onTimeout"];
function* walk(steps) {
  for (const s of steps ?? []) {
    if (!s || typeof s !== "object") continue;
    yield s;
    for (const k of CHILD_KEYS) if (Array.isArray(s[k])) yield* walk(s[k]);
    for (const b of Array.isArray(s.branches) ? s.branches : []) yield* walk(b?.steps);
    if (s.elseBranch) yield* walk(s.elseBranch.steps);
    if (s.inlineBranch) { yield* walk(s.inlineBranch.ok); yield* walk(s.inlineBranch.ng); }
    const oc = s.errorHandling?.outcomes;
    if (oc && typeof oc === "object") for (const spec of Object.values(oc)) yield* walk(spec?.sideEffects);
  }
}

const FEATURES = [
  ["runIf", "実行条件つきの工程 (`runIf`)", (s) => typeof s.runIf === "string" && s.runIf],
  ["subSteps", "入れ子の工程 (`subSteps`)", (s) => Array.isArray(s.subSteps) && s.subSteps.length],
  ["inlineBranch", "検証の OK / NG 側の工程 (`inlineBranch`)", (s) => s.kind === "validation" && s.inlineBranch],
  ["multiArm", "3 つ以上の道を持つ分岐", (s) => s.kind === "branch" && Array.isArray(s.branches) && s.branches.length >= 3],
  ["guard", "道が 1 本だけの分岐 (ガード)", (s) => s.kind === "branch" && Array.isArray(s.branches) && s.branches.length === 1],
  ["txHandlers", "コミット後 / ロールバック時の工程つきのトランザクション", (s) => s.kind === "transactionScope" && (s.onCommit?.length || s.onRollback?.length)],
  ["outcomes", "失敗系の結果ごとの副作用 (`errorHandling.outcomes`)", (s) => s.errorHandling?.outcomes && Object.keys(s.errorHandling.outcomes).length],
  ["retry", "再試行 (`errorHandling.retryPolicy`)", (s) => s.errorHandling?.retryPolicy],
  ["outputBinding", "結果の束縛 (`outputBinding`)", (s) => s.outputBinding],
];

export function buildPatterns(base = root) {
  const kinds = stepKinds(base).map((r) => r.kind);
  const labels = stepKindLabels(base);
  const found = new Map(); // key -> [{project, flow, step}]
  const add = (key, hit) => { const l = found.get(key) ?? []; if (l.length < 3 && !l.some((x) => x.flow === hit.flow && x.project === hit.project)) l.push(hit); found.set(key, l); };
  const projects = fs.readdirSync(path.join(base, "examples"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  for (const project of projects) {
    const dir = path.join(base, "examples", project, "harmony", "process-flows");
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".json")).sort()) {
      let flow;
      try { flow = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); } catch { continue; }
      const flowId = flow?.meta?.id ?? f.replace(/\.json$/, "");
      for (const act of Array.isArray(flow?.actions) ? flow.actions : []) {
        for (const s of walk(act.steps)) {
          const kind = typeof s.kind === "string" && s.kind.includes(":") ? "namespace:StepName" : s.kind;
          if (kind) add(`kind:${kind}`, { project, flow: flowId, step: s.id });
          for (const [key, , test] of FEATURES) if (test(s)) add(`feature:${key}`, { project, flow: flowId, step: s.id });
        }
      }
    }
  }
  const cell = (hits) => (hits ?? []).map((h) => `\`examples/${h.project}/harmony/process-flows/${h.flow}.json\` (${h.step})`).join("<br>") || "(サンプルにない)";
  const lines = [
    "# サンプルが示す工程のパターン\n",
    "> **自動生成**: この文書は手で直さない。`node scripts/docs/generated.mjs --write` で作り直す (ずれていると `npm run check:docs` が止める)。\n",
    "新しい処理フローを作るときは、近い工程の例を読む。形の正本は `schemas/v3/process-flow.v3.schema.json`。種類の一覧は `docs/spec/process-flow-step-kinds.md`。\n",
    "## 工程の種類ごと\n",
    "| kind | 日本語名 | 例 (サンプルの場所と工程の id) |",
    "|---|---|---|",
    ...kinds.map((k) => `| \`${k}\` | ${labels[k] ?? (k.includes(":") ? labels.extension : "") ?? ""} | ${cell(found.get(`kind:${k}`))} |`),
    "",
    "## 書き方のパターン\n",
    "| パターン | 例 |",
    "|---|---|",
    ...FEATURES.map(([key, label]) => `| ${label} | ${cell(found.get(`feature:${key}`))} |`),
    "",
  ];
  return lines.join("\n");
}

// ─── 用語集 ─────────────────────────────────────────────────

/** 中心の用語 (手で保つ)。tool の名前・仕様書・スキーマの定義が実在することは、生成のときに確かめる */
export const CORE_TERMS = [
  { term: "処理フロー", english: "ProcessFlow", meaning: "画面やバッチの裏の処理を、アクションと工程の並びで書いた設計", schema: "process-flow", tools: ["list_process_flows", "get_process_flow", "add_process_flow", "update_process_flow", "get_flow_story"], spec: ["process-flow-variables", "process-flow-story-view"] },
  { term: "アクション", english: "ActionDefinition", meaning: "処理フローの中の、1 つの入口 (ボタン・API・バッチ) ごとの処理のまとまり。工程を持つ", schema: "process-flow#ActionDefinition", tools: ["add_action"], spec: ["process-flow-variables"] },
  { term: "工程", english: "Step", meaning: "処理の 1 手順。kind で種類を表す (入力チェック・DB アクセス・分岐 など)", schema: "process-flow#Step", tools: ["add_step", "update_step", "edit_steps", "list_steps", "get_step"], spec: ["process-flow-step-kinds", "process-flow-substeps"] },
  { term: "分岐", english: "BranchStep", meaning: "条件で道を選ぶ工程。上から順に調べ、最初に成り立った道だけを実行する", schema: "process-flow#BranchStep", tools: ["analyze_branches"], spec: ["process-flow-runtime-conventions", "process-flow-story-view"] },
  { term: "判定表", english: "decision table", meaning: "複合条件の分岐を、条件の行 × 道の列の表 (○ × －) で見る・直す。隠れる道・抜けを指摘する", schema: "", tools: ["analyze_branches"], spec: ["process-flow-story-view", "ui-editing-depth"] },
  { term: "流れ", english: "story view", meaning: "処理フローを、入れ子と言葉の条件で読む表示。AI が作った複雑な処理を人が読み、細かい仕様を人が書く", schema: "", tools: ["get_flow_story"], spec: ["process-flow-story-view"] },
  { term: "画面", english: "Screen", meaning: "利用者が見る 1 画面の設計。業務部品の木で組む", schema: "screen#Screen", tools: ["list_screens", "get_screen_layout", "set_screen_layout", "add_screen", "update_screen"], spec: ["screen-layout", "layout-components"] },
  { term: "画面項目", english: "ScreenItem", meaning: "画面の入力・表示の 1 項目 (型・必須・長さ・テーブルの列への結びつき)", schema: "screen-item#ScreenItem", tools: ["rename_screen_item", "check_screen_item_refs"], spec: ["screen-items"] },
  { term: "業務部品", english: "layout component", meaning: "画面を組む部品。プロジェクト独自の部品も登録できる", schema: "layout-components", tools: ["list_layout_components"], spec: ["layout-components", "screen-layout"] },
  { term: "テーブル", english: "Table", meaning: "データベースのテーブル定義 (カラム・インデックス・制約)", schema: "table#Table", tools: ["list_tables", "get_table", "add_table", "update_table", "generate_ddl", "import_ddl"], spec: [] },
  { term: "規約", english: "conventions", meaning: "プロジェクトの取り決め (ロール・権限・上限値・正規表現・DB 規約・メッセージ)。@conv.* で参照する", schema: "conventions", tools: ["get_conventions", "save_conventions"], spec: ["process-flow-prefix-system"] },
  { term: "汎用定義", english: "generic definition", meaning: "メッセージ・ドメイン型・定数 など 17 種の、名前で引く定義", schema: "generic-definition", tools: ["list_designs", "get_design", "save_design"], spec: ["generic-definition-layer"] },
  { term: "業務フロー", english: "BusinessFlow", meaning: "スイムレーンで書く、人と画面と処理をまたぐ業務の流れ", schema: "business-flow", tools: ["list_business_flows", "get_business_flow", "save_business_flow"], spec: ["business-flow"] },
  { term: "帳票", english: "Report", meaning: "帳票の出力・部・項目の設計", schema: "report", tools: ["list_reports", "get_report", "save_report"], spec: ["report"] },
  { term: "ページレイアウト", english: "PageLayout", meaning: "共通のヘッダ・フッタ・サイドバーなどの、画面をまたぐ部品", schema: "page-layout", tools: ["list_page_layouts", "get_page_layout", "save_page_layout"], spec: ["page-layout"] },
  { term: "ワークスペース", english: "workspace", meaning: "1 つのプロジェクトの設計一式を置くフォルダ (harmony.json と dataDir)", schema: "harmony", tools: ["workspace_list", "workspace_open", "workspace_status"], spec: ["workspace", "workspace-multi"] },
  { term: "成熟度", english: "maturity", meaning: "設計の仕上がり (draft など)。処理フロー (meta.maturity)・アクション・工程・業務フロー・帳票に付く", schema: "common", tools: ["set_maturity"], spec: ["process-flow-maturity"] },
  { term: "マーカー", english: "marker", meaning: "設計に付ける、人から AI への指示・質問・メモ。解決すると、解決日時と内容が付く", schema: "common#Marker", tools: ["list_markers", "find_all_markers", "add_marker", "resolve_marker"], spec: ["ui-markers"] },
  { term: "要確認", english: "issue", meaning: "設計の抜け・矛盾の指摘 (check_design が返す)。黙らせるのは人 (理由つきの抑制)", schema: "", tools: ["check_design", "analyze_design"], spec: ["design-check", "design-document"] },
  { term: "設計書", english: "design document", meaning: "設計を紙面の体裁で読む成果物 (HTML / Word / Excel)。原本と常に一致する", schema: "", tools: ["get_design_document"], spec: ["design-document"] },
  { term: "テスト観点", english: "test viewpoints", meaning: "画面入力の境界値や処理の分岐から導く、ID つきのテストの観点表", schema: "", tools: ["get_test_viewpoints"], spec: ["test-viewpoints"] },
  { term: "参照元", english: "references", meaning: "ある設計を参照している設計の一覧。改名・削除の前の影響確認", schema: "", tools: ["find_references", "rename_entity", "replace_references"], spec: ["references"] },
  { term: "拡張", english: "extension", meaning: "独自の工程・型・トリガーなどを足す仕組み (名前空間つき)。スキーマは変えずに表す", schema: "extensions", tools: ["list_extensions", "add_step_extension"], spec: ["process-flow-extensions", "plugin-system"] },
  { term: "編集セッション", english: "edit session", meaning: "画面での編集の作業コピー (下書き)。保存で原本が変わる", schema: "", tools: [], spec: ["edit-session-draft", "edit-session-protocol"] },
  { term: "プロファイル", english: "profile", meaning: "AI に見せる MCP tool の絞り込み (?profile=flow など)。権限ではない", schema: "", tools: ["get_tool_guide"], spec: ["server-security"] },
];

function toolNames(base) {
  const src = read(base, "backend/src/tools.ts");
  return new Set([...src.matchAll(/name:\s*"(?:designer|editSession)__([a-z_]+)"/g)].map((m) => m[1]));
}

export function buildGlossary(base = root) {
  const tools = toolNames(base);
  const kinds = stepKinds(base);
  const defsOf = (file) => { try { return Object.keys(JSON.parse(read(base, `schemas/v3/${file}.v3.schema.json`)).$defs ?? {}); } catch { return null; } };
  const problems = [];
  for (const t of CORE_TERMS) {
    for (const n of t.tools) if (!tools.has(n)) problems.push(`用語「${t.term}」: tool「${n}」がありません`);
    for (const sp of t.spec) if (!exists(base, `docs/spec/${sp}.md`) && !(sp === "process-flow-step-kinds")) problems.push(`用語「${t.term}」: 仕様書「${sp}」がありません`);
    if (t.schema) {
      const [file, def] = t.schema.split("#");
      if (!exists(base, `schemas/v3/${file}.v3.schema.json`)) problems.push(`用語「${t.term}」: スキーマ「${file}」がありません`);
      else if (def) { const d = defsOf(file); if (d && !d.includes(def)) problems.push(`用語「${t.term}」: スキーマ ${file} に定義「${def}」がありません`); }
    }
  }
  if (problems.length) throw new Error(`用語集の整合: ${problems.join(" / ")}`);
  const coreNames = new Set(CORE_TERMS.map((t) => t.term));
  const stepTerms = kinds.filter((k) => k.label).map((k) => ({ term: coreNames.has(k.label) ? `${k.label} (工程の種類)` : k.label, english: k.kind, meaning: `工程の種類 \`${k.kind}\`${k.description ? `。${k.description}` : ""}`, schema: `process-flow#${k.def}`, tools: [], spec: ["process-flow-step-kinds"], generated: true }));
  return json({ generatedFrom: "scripts/docs/generated.mjs の CORE_TERMS と、スキーマの工程の種類 (node scripts/docs/generated.mjs --write)", terms: [...CORE_TERMS, ...stepTerms] });
}

// ─── 生成と検査 ─────────────────────────────────────────────

export const GENERATED = [
  { file: "docs/spec/schema-index.json", build: buildSchemaIndex },
  { file: "docs/spec/schema-refs.json", build: buildRefKinds },
  { file: "shared/src/analysis/refKinds.generated.ts", build: buildRefKindsTs },
  { file: "docs/spec/process-flow-step-kinds.md", build: buildStepKinds },
  { file: "docs/spec/process-flow-pitfalls.md", build: buildPitfalls },
  { file: "docs/glossary.json", build: buildGlossary },
  { file: "examples/PATTERNS.md", build: buildPatterns },
];

/** 食い違っている生成物 (ファイルがない・内容が違う)。生成に失敗したら、その理由 */
export function checkGenerated(base = root) {
  const out = [];
  for (const g of GENERATED) {
    let expected;
    try { expected = g.build(base); } catch (e) { out.push({ file: g.file, message: `作れません: ${e.message}` }); continue; }
    const target = path.join(base, g.file);
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8").replace(/\r\n/g, "\n") !== expected) out.push({ file: g.file, message: "正本と合っていません。node scripts/docs/generated.mjs --write で作り直してください" });
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === "--write") {
    for (const g of GENERATED) { fs.mkdirSync(path.dirname(path.join(root, g.file)), { recursive: true }); fs.writeFileSync(path.join(root, g.file), g.build(root)); console.log(`書きました: ${g.file}`); }
  } else {
    const bad = checkGenerated();
    for (const b of bad) console.error(`✗ ${b.file}: ${b.message}`);
    if (bad.length) process.exit(1);
    console.log(`生成物 ${GENERATED.length} 件は最新です`);
  }
}
