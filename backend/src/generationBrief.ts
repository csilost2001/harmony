/**
 * 生成の指示書 (designer__get_generation_brief): コードを生成する AI が、設計から集める情報を、1 つの文書にまとめる。
 *
 * 処理フローごと: 何を作るか・技術スタック・処理の流れ (言葉)・使うテーブル・規約の参照・関連する画面の項目・テスト観点・記録の呼び方。
 * 画面ごと: 項目の制約・関連する処理フロー・遷移・テスト観点・記録の呼び方。
 * 中身 (工程の原本など) を丸ごとは載せない。必要なら get_process_flow / get_table で読む。大きさには上限がある。
 * 仕様: docs/spec/code-generation.md
 */
import { deriveTestViewpointSheet, walkAllSteps, type DocFlow, type DocScreen, type DocTable } from "@harmony/shared";
import { loadDesignInputFromRoot } from "./designInput.js";
import { readProject } from "./projectStorage.js";
import { actionsOf, flowContext, storyOf } from "./handlers/designInsight.js";

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const MAX_STORY_CHARS = 40000;
const MAX_TABLES = 30, MAX_ITEMS = 80, MAX_CASES = 60, MAX_CONV = 60;
const more = <T,>(items: T[], max: number): { shown: T[]; extra: number } => ({ shown: items.slice(0, max), extra: Math.max(0, items.length - max) });

function tableBlock(t: DocTable): string {
  const cols = (t.columns ?? []).map((c) => `- \`${c.physicalName}\` ${c.name ?? ""} — ${c.dataType ?? "?"}${c.length ? `(${c.length}${c.scale ? `,${c.scale}` : ""})` : ""}${c.primaryKey ? " PK" : ""}${c.notNull ? " NOT NULL" : ""}${c.unique ? " UNIQUE" : ""}${c.autoIncrement ? " AUTO" : ""}${c.defaultValue ? ` 既定 ${c.defaultValue}` : ""}`);
  const fks = (t.constraints ?? []).filter((c) => c.kind === "foreignKey").map((c) => `- 外部キー: ${(c.columnIds ?? []).join(", ")} → ${c.referencedTableId ?? "?"}`);
  return [`### ${t.name ?? t.physicalName ?? t.id} (\`${t.physicalName ?? ""}\`, id: ${t.id})`, ...cols, ...fks].join("\n");
}

/** ドメインの単位・丸め規則 (`context.catalogs.domains`) と、工程の結果の形 (`outputBinding.shape`)。生成コードの桁・丸め・型がずれないように */
function unitAndRounding(flow: DocFlow, actions: ReadonlyArray<object>): string[] {
  const out: string[] = [];
  const domains = (flow as { context?: { catalogs?: { domains?: unknown } } }).context?.catalogs?.domains;
  if (isRecord(domains)) {
    for (const [name, d] of Object.entries(domains)) {
      if (!isRecord(d) || (d.unit === undefined && d.rounding === undefined)) continue;
      out.push(`- ドメイン \`${name}\`: ${[d.unit !== undefined ? `単位 ${String(d.unit)}` : "", d.rounding !== undefined ? `丸め ${String(d.rounding)}` : ""].filter(Boolean).join(" / ")}`);
    }
  }
  for (const act of actions) {
    try {
      for (const st of walkAllSteps(Array.isArray((act as { steps?: unknown }).steps) ? ((act as { steps?: unknown }).steps as never) : undefined)) {
        const ob = isRecord(st) ? st.outputBinding : undefined;
        if (isRecord(ob) && (ob.shape === "one" || ob.shape === "list") && typeof ob.name === "string") out.push(`- 変数 \`${ob.name}\` (工程 \`${String((st as Record<string, unknown>).id ?? "?")}\`): ${ob.shape === "one" ? "1 件" : "一覧 (0 件以上)"}`);
      }
    } catch { /* 壊れた工程は飛ばす */ }
  }
  return out.slice(0, 40);
}

function convRefs(obj: unknown): string[] {
  return [...new Set([...JSON.stringify(obj).matchAll(/@conv\.[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*/g)].map((m) => m[0]))].sort();
}

function resolveConv(ref: string, input: Awaited<ReturnType<typeof loadDesignInputFromRoot>>["input"]): string {
  const [, group, key] = ref.split(".");
  const pick = (m: Record<string, unknown> | undefined) => (m && key ? m[key] : undefined);
  const v = group === "limit" ? pick(input.limits) : group === "regex" ? pick(input.regex) : group === "msg" ? pick(input.messages) : group === "role" ? pick(input.roles) : group === "permission" ? pick(input.permissions) : undefined;
  if (v === undefined) return "";
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 159)}…` : s;
}

function itemLine(i: NonNullable<DocScreen["items"]>[number]): string {
  const parts = [i.type !== undefined ? String(typeof i.type === "string" ? i.type : JSON.stringify(i.type)) : "", i.direction ?? "", i.required ? "必須" : "", i.minLength !== undefined ? `最小 ${i.minLength} 文字` : "", i.maxLength !== undefined ? `最大 ${i.maxLength} 文字` : "", i.min !== undefined ? `≥ ${i.min}` : "", i.max !== undefined ? `≤ ${i.max}` : "", i.pattern ? `形式 ${i.pattern}` : ""].filter(Boolean);
  return `- \`${i.id}\` ${i.label ?? ""} — ${parts.join(" / ")}`;
}

function recordHowTo(kind: string, id: string): string {
  return [
    "## 生成したら",
    "",
    `1. \`designer__record_generation\` で、作ったファイルを記録する (\`sources\` に元にした設計: \`{ "kind": "${kind}", "id": "${id}" }\`)。テストのファイルは、パスに \`test\` か \`spec\` を含める`,
    "2. テストの名前かコメントに、テスト観点の ID を書く (観点表の ID。下の「テスト観点」) — `designer__check_test_coverage` が覆い方を数える",
    "3. 設計が変わったら、再生成の前に `designer__check_generation_drift` と `designer__get_regeneration_diff`",
  ].join("\n");
}

export async function buildGenerationBrief(root: string, args: { processFlowId?: string; screenId?: string }): Promise<string> {
  const { input } = await loadDesignInputFromRoot(root);
  const project = await readProject(root);
  const techStack = isRecord(project) ? project.techStack : undefined;
  const testCtx = { limits: input.limits, regex: input.regex, messages: input.messages };
  const out: string[] = [];

  if (args.processFlowId) {
    const flow = input.flows.find((f: DocFlow) => f.meta.id === args.processFlowId);
    if (!flow) throw new Error(`処理フロー「${args.processFlowId}」が見つかりません (designer__list_process_flows で一覧)`);
    const screen = flow.meta.screenId ? input.screens.find((s) => s.id === flow.meta.screenId) : undefined;
    const tableIds = new Set<string>();
    // 設計は途中でも保存できる (工程が null・文字列だったり、actions が配列でなかったりする)。壊れた部分は飛ばす
    const actionList = Array.isArray(flow.actions) ? flow.actions.filter(isRecord) : [];
    for (const act of actionList) {
      try { for (const st of walkAllSteps(Array.isArray(act.steps) ? (act.steps as never) : undefined)) { const t = isRecord(st) ? st.tableId : undefined; if (typeof t === "string") tableIds.add(t); } } catch { /* 壊れた工程は飛ばす */ }
    }
    const tables = input.tables.filter((t) => tableIds.has(t.id));
    const convs = convRefs(flow);
    const sheet = deriveTestViewpointSheet({ ...testCtx, screens: [], flows: [flow] });
    const cases = sheet.flows.flatMap((f) => f.cases);

    out.push(`# 生成の指示書: ${flow.meta.name ?? flow.meta.id} (処理フロー \`${flow.meta.id}\`)`, "");
    out.push("## 何を作るか", "", flow.meta.description ?? "(説明なし)", "");
    for (const a of actionList) out.push(`- アクション \`${a.id ?? ""}\` ${a.name ?? ""}${a.httpRoute ? ` — ${a.httpRoute.method} ${a.httpRoute.path}${a.httpRoute.auth ? ` (認証: ${a.httpRoute.auth})` : ""}` : ""}${a.requiredPermissions?.length ? ` / 必要な権限: ${a.requiredPermissions.join(", ")}` : ""}`);
    out.push("", "## 技術スタック", "", techStack ? "```json\n" + JSON.stringify(techStack, null, 2) + "\n```" : "(未設定。designer__get_tech_stack / save_tech_stack)", "");
    let story: string;
    try { story = storyOf(flow as never, actionsOf(flow as never, undefined), await flowContext(root)); } catch { story = "(処理の流れを組み立てられませんでした。設計が壊れている可能性があります。designer__check_design で確かめてください)"; }
    if (story.length > MAX_STORY_CHARS) story = `${story.slice(0, MAX_STORY_CHARS)}\n\n(長いので ${MAX_STORY_CHARS} 文字で切りました。続きは designer__get_flow_story { processFlowId, actionId } でアクションごとに)`;
    out.push("## 処理の流れ", "", "条件は言葉で書いてある。もとの式は designer__get_step で読む。", "", story, "");
    const tb = more(tables, MAX_TABLES);
    out.push("## 使うテーブル", "", tb.shown.length ? tb.shown.map(tableBlock).join("\n\n") : "(この処理フローが直接使うテーブルはありません)", ...(tb.extra ? [`\n(ほか ${tb.extra} 件)`] : []), "");
    const rules = unitAndRounding(flow, actionList);
    if (rules.length) out.push("## 単位・丸め・結果の形 (設計で決めてある。コードでそのまま守る)", "", ...rules, "");
    const cv = more(convs, MAX_CONV);
    out.push("## 規約の参照 (@conv.*)", "", cv.shown.length ? cv.shown.map((r) => `- \`${r}\`${resolveConv(r, input) ? ` = ${resolveConv(r, input)}` : ""}`).join("\n") : "(なし)", ...(cv.extra ? [`\n(ほか ${cv.extra} 件)`] : []), "");
    if (screen) {
      const it = more(screen.items ?? [], MAX_ITEMS);
      out.push(`## 呼び出す画面: ${screen.name ?? screen.id} (\`${screen.id}\`)`, "", ...it.shown.map(itemLine), ...(it.extra ? [`(ほか ${it.extra} 件)`] : []), "");
    }
    const cs = more(cases, MAX_CASES);
    out.push("## テスト観点", "", cs.shown.length ? cs.shown.map((c) => `- \`${c.id}\` [${c.category}] ${c.conditions.join(" かつ ") || "(条件なし)"} → ${c.expected}${c.status ? ` (HTTP ${c.status})` : ""}`).join("\n") : "(なし)", ...(cs.extra ? [`\n(ほか ${cs.extra} 件。designer__get_test_viewpoints で全部)`] : []), "");
    out.push(recordHowTo("processFlow", flow.meta.id));
    return out.join("\n");
  }

  if (args.screenId) {
    const screen = input.screens.find((s) => s.id === args.screenId);
    if (!screen) throw new Error(`画面「${args.screenId}」が見つかりません (designer__list_screens で一覧)`);
    const flows = input.flows.filter((f) => f.meta.screenId === screen.id);
    const outgoing = (input.transitions ?? []).filter((t) => t.sourceScreenId === screen.id);
    const sheet = deriveTestViewpointSheet({ ...testCtx, screens: [screen], flows: [] });
    const cases = sheet.screens.flatMap((s) => s.cases);
    out.push(`# 生成の指示書: ${screen.name ?? screen.id} (画面 \`${screen.id}\`)`, "");
    out.push("## 何を作るか", "", `${screen.description ?? "(説明なし)"}`, "", `- 経路: ${screen.path ?? "(未設定)"} / 種類: ${screen.kind ?? "?"}${screen.auth ? ` / 認証: ${screen.auth}` : ""}${screen.permissions?.length ? ` / 必要な権限: ${screen.permissions.join(", ")}` : ""}`, "");
    out.push("## 技術スタック", "", techStack ? "```json\n" + JSON.stringify(techStack, null, 2) + "\n```" : "(未設定)", "");
    const it = more(screen.items ?? [], MAX_ITEMS);
    out.push("## 画面項目", "", it.shown.length ? it.shown.map(itemLine).join("\n") : "(項目なし)", ...(it.extra ? [`\n(ほか ${it.extra} 件)`] : []), "");
    out.push("## この画面から呼ぶ処理フロー", "", flows.length ? flows.map((f) => `- \`${f.meta.id}\` ${f.meta.name ?? ""} — 生成の指示書: designer__get_generation_brief { processFlowId: "${f.meta.id}" }`).join("\n") : "(なし)", "");
    out.push("## 遷移", "", outgoing.length ? outgoing.map((t) => `- → \`${t.targetScreenId}\`${t.label ? ` (${t.label})` : ""}${t.trigger ? ` 契機: ${t.trigger}` : ""}`).join("\n") : "(なし)", "");
    const cs = more(cases, MAX_CASES);
    out.push("## テスト観点", "", cs.shown.length ? cs.shown.map((c) => `- \`${c.id}\` [${c.category}] ${c.viewpoint} — 入力: ${c.input} → ${c.expected}`).join("\n") : "(なし)", ...(cs.extra ? [`\n(ほか ${cs.extra} 件)`] : []), "");
    out.push(recordHowTo("screen", screen.id));
    return out.join("\n");
  }
  throw new Error("processFlowId か screenId のどちらかを指定してください");
}
