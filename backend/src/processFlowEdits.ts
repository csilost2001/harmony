/**
 * ProcessFlow の細粒度編集ヘルパー (#261 MCP リアルタイム編集対応)。
 *
 * 各関数は ProcessFlow を mutate して返す (同じ参照)。呼び出し側で writeProcessFlow し、
 * wsBridge.broadcast("processFlowChanged", { processFlowId }) してブラウザを再描画させる。
 */

type Step = {
  id: string;
  /** v3 discriminator (#1141 / #8)。schema 上は `kind` のみが正規。
   * 旧 v1/v2 データの `type` は移行猶予で保持するが、新規書込は `kind` のみ。 */
  kind?: string;
  /** @deprecated v1/v2 legacy。v3 では `kind` を参照する。 */
  type?: string;
  description?: string;
  subSteps?: Step[];
  branches?: Array<{ id: string; steps: Step[] }>;
  elseBranch?: { id: string; steps: Step[] };
  steps?: Step[]; // loop body / transactionScope.steps
  onCommit?: Step[]; // transactionScope: commit 成功後の追加処理
  onRollback?: Step[]; // transactionScope: rollback 後の補償処理
  outcomes?: Record<string, { sideEffects?: Step[] } | undefined>;
  /** common.v3 Note: kind は assumption/prerequisite/todo/deferred/question。`type` は legacy データ互換 (read-only)。 */
  notes?: Array<{ id: string; kind: string; type?: string; body: string; createdAt: string }>;
  [k: string]: unknown;
};

/** Step discriminator を抽出 (#1141)。v3 では `kind`、レガシーは `type` を参照。 */
function stepKindOf(s: Step): string | undefined {
  return s.kind ?? s.type;
}

type Action = {
  id: string;
  steps: Step[];
  [k: string]: unknown;
};

export type ProcessFlowDoc = {
  id: string;
  maturity?: string;
  actions: Action[];
  context?: { catalogs?: Partial<Record<CatalogName, Record<string, unknown>>>; [k: string]: unknown };
  updatedAt?: string;
  [k: string]: unknown;
};

/** 全 step を再帰走査。親配列も併せて返す (move/remove 用) */
function walkSteps(
  steps: Step[],
  visit: (step: Step, parentArray: Step[], index: number) => boolean | void,
): boolean {
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i];
    if (visit(s, steps, i) === true) return true;
    if (s.subSteps && walkSteps(s.subSteps, visit)) return true;
    if (s.branches) {
      for (const b of s.branches) {
        if (walkSteps(b.steps, visit)) return true;
      }
    }
    if (s.elseBranch && walkSteps(s.elseBranch.steps, visit)) return true;
    const k = stepKindOf(s);
    if (k === "loop" && s.steps && walkSteps(s.steps, visit)) return true;
    if (k === "transactionScope") {
      if (s.steps && walkSteps(s.steps, visit)) return true;
      if (s.onCommit && walkSteps(s.onCommit, visit)) return true;
      if (s.onRollback && walkSteps(s.onRollback, visit)) return true;
    }
    if (s.outcomes) {
      for (const oc of Object.values(s.outcomes)) {
        if (oc?.sideEffects && walkSteps(oc.sideEffects, visit)) return true;
      }
    }
    // ワークフローの承認・却下・タイムアウト時の工程、入力チェックの OK / NG の枝
    for (const key of ["onApproved", "onRejected", "onTimeout"] as const) {
      const list = s[key];
      if (Array.isArray(list) && walkSteps(list as Step[], visit)) return true;
    }
    const inline = s.inlineBranch as { ok?: Step[]; ng?: Step[] } | undefined;
    if (inline) {
      if (inline.ok && walkSteps(inline.ok, visit)) return true;
      if (inline.ng && walkSteps(inline.ng, visit)) return true;
    }
    // v3 の形: errorHandling.outcomes.<success|failure|timeout>.sideEffects
    const ehOutcomes = (s.errorHandling as { outcomes?: Record<string, { sideEffects?: Step[] } | undefined> } | undefined)?.outcomes;
    if (ehOutcomes) {
      for (const oc of Object.values(ehOutcomes)) {
        if (oc?.sideEffects && walkSteps(oc.sideEffects, visit)) return true;
      }
    }
  }
  return false;
}

/** 全 step を対象にコールバック実行 */
export function forEachStep(ag: ProcessFlowDoc, visit: (step: Step) => void): void {
  for (const a of ag.actions) walkSteps(a.steps, (s) => { visit(s); });
}

/** stepId で step を探す (見つからなければ null) */
export function findStep(ag: ProcessFlowDoc, stepId: string): Step | null {
  let found: Step | null = null;
  for (const a of ag.actions) {
    walkSteps(a.steps, (s) => {
      if (s.id === stepId) { found = s; return true; }
    });
    if (found) break;
  }
  return found;
}

/** stepId を含む配列と index を探す */
function findStepWithContext(
  ag: ProcessFlowDoc,
  stepId: string,
): { parentArray: Step[]; index: number } | null {
  let result: { parentArray: Step[]; index: number } | null = null;
  for (const a of ag.actions) {
    walkSteps(a.steps, (s, arr, idx) => {
      if (s.id === stepId) { result = { parentArray: arr, index: idx }; return true; }
    });
    if (result) break;
  }
  return result;
}

export function updateStep(ag: ProcessFlowDoc, stepId: string, patch: Record<string, unknown>): void {
  const s = findStep(ag, stepId);
  if (!s) throw new Error(`step ${stepId} が見つかりません`);
  Object.assign(s, patch);
}

export function removeStep(ag: ProcessFlowDoc, stepId: string): void {
  const ctx = findStepWithContext(ag, stepId);
  if (!ctx) throw new Error(`step ${stepId} が見つかりません`);
  ctx.parentArray.splice(ctx.index, 1);
}

export function moveStep(ag: ProcessFlowDoc, stepId: string, newIndex: number): void {
  const ctx = findStepWithContext(ag, stepId);
  if (!ctx) throw new Error(`step ${stepId} が見つかりません`);
  const [removed] = ctx.parentArray.splice(ctx.index, 1);
  const clamped = Math.max(0, Math.min(newIndex, ctx.parentArray.length));
  ctx.parentArray.splice(clamped, 0, removed);
}

/**
 * 工程の入れ子を動かす (docs/spec/process-flow-substeps.md)。
 * indent: 直前の兄弟の subSteps の末尾へ。outdent: 親の次の位置へ (後ろの兄弟は、出した工程の配下へ引き継ぎ、実行順を変えない)。
 * 動かせないとき (最初の工程・親が無い) はエラー。分岐の枝・繰り返しの本体の中の工程も動かせる。
 */
export function nestStep(ag: ProcessFlowDoc, stepId: string, direction: "indent" | "outdent"): void {
  const ctx = findStepWithContext(ag, stepId);
  if (!ctx) throw new Error(`step ${stepId} が見つかりません`);
  if (direction === "indent") {
    if (ctx.index === 0) throw new Error(`step ${stepId} は先頭の工程なので、インデントできません (直前の工程がありません)`);
    const [moved] = ctx.parentArray.splice(ctx.index, 1);
    const prev = ctx.parentArray[ctx.index - 1];
    (prev.subSteps ??= []).push(moved);
    return;
  }
  // outdent: この配列 (ctx.parentArray) を subSteps に持つ工程が親
  let owner: Step | null = null;
  for (const a of ag.actions) {
    walkSteps(a.steps, (s) => { if (s.subSteps === ctx.parentArray) { owner = s; return true; } });
    if (owner) break;
  }
  if (!owner) throw new Error(`step ${stepId} は入れ子の中にないので、アウトデントできません`);
  const ownerStep = owner as Step;
  const ownerCtx = findStepWithContext(ag, ownerStep.id);
  if (!ownerCtx) throw new Error(`step ${stepId} の親が見つかりません`);
  const [moved] = ctx.parentArray.splice(ctx.index, 1);
  const followers = ctx.parentArray.splice(ctx.index);
  if (followers.length > 0) moved.subSteps = [...(moved.subSteps ?? []), ...followers];
  if (ctx.parentArray.length === 0) delete ownerStep.subSteps;
  ownerCtx.parentArray.splice(ownerCtx.index + 1, 0, moved);
}

export function setMaturity(
  ag: ProcessFlowDoc,
  target: "group" | "action" | "step",
  targetId: string | undefined,
  maturity: "draft" | "provisional" | "committed",
): void {
  if (target === "group") {
    ag.maturity = maturity;
    return;
  }
  if (!targetId) throw new Error("target=action/step では targetId が必須です");
  if (target === "action") {
    const act = ag.actions.find((a) => a.id === targetId);
    if (!act) throw new Error(`action ${targetId} が見つかりません`);
    (act as Record<string, unknown>).maturity = maturity;
    return;
  }
  // step
  const s = findStep(ag, targetId);
  if (!s) throw new Error(`step ${targetId} が見つかりません`);
  (s as Record<string, unknown>).maturity = maturity;
}

export function addStepNote(
  ag: ProcessFlowDoc,
  stepId: string,
  kind: string,
  body: string,
): { id: string } {
  // #1187 提案 C: common.v3 Note.kind 規約に揃え、field 名を `type` から `kind` に統一
  const s = findStep(ag, stepId);
  if (!s) throw new Error(`step ${stepId} が見つかりません`);
  const note = {
    id: `note-${Date.now()}`,
    kind,
    body,
    createdAt: new Date().toISOString(),
  };
  const notes = s.notes ?? [];
  notes.push(note);
  s.notes = notes;
  return { id: note.id };
}

/** v3 の context.catalogs の種類 (schemas/v3/process-flow.v3.schema.json の $defs/Catalogs)。 */
export const CATALOG_NAMES = ["errors", "externalSystems", "secrets", "envVars", "domains", "functions", "events", "modelEndpoints"] as const;
export type CatalogName = typeof CATALOG_NAMES[number];
/** プロジェクト共通のカタログ (catalogs/external.json、external-catalogs.v3) に置ける種類。 */
export const PROJECT_CATALOG_NAMES = ["modelEndpoints", "secrets", "envVars", "events", "functions", "externalSystems"] as const;
/** 古い名前 (v1/v2 の一番上のキー) → v3 の名前。呼び出し側の互換のために受ける。 */
const LEGACY_CATALOG_NAMES: Record<string, CatalogName> = {
  errorCatalog: "errors",
  secretsCatalog: "secrets",
  externalSystemCatalog: "externalSystems",
};

/** カタログ名を v3 の名前にそろえる。知らない名前は null。 */
export function normalizeCatalogName(name: string): CatalogName | null {
  if ((CATALOG_NAMES as readonly string[]).includes(name)) return name as CatalogName;
  return LEGACY_CATALOG_NAMES[name] ?? null;
}

/** カタログ (`{ <種類>: { <キー>: 値 } }` の形) に 1 件を追加・置き換える。処理フローの context.catalogs と catalogs/external.json で共通。 */
export function setCatalogEntry(
  catalogs: Record<string, unknown>,
  catalog: CatalogName,
  key: string,
  value: Record<string, unknown>,
): void {
  const current = (catalogs[catalog] as Record<string, unknown> | undefined) ?? {};
  current[key] = value;
  catalogs[catalog] = current;
}

/** カタログから 1 件を消す。消して空になった種類は取り除く。消したら true。 */
export function deleteCatalogEntry(
  catalogs: Record<string, unknown>,
  catalog: CatalogName,
  key: string,
): boolean {
  const current = catalogs[catalog] as Record<string, unknown> | undefined;
  if (!current || !(key in current)) return false;
  delete current[key];
  if (Object.keys(current).length === 0) delete catalogs[catalog];
  return true;
}

/** 処理フローの context.catalogs.<種類> に 1 件を追加・置き換える。 */
export function addCatalogEntry(
  ag: ProcessFlowDoc,
  catalog: CatalogName,
  key: string,
  value: Record<string, unknown>,
): void {
  const context = (ag.context ??= {});
  const catalogs = (context.catalogs ??= {}) as Record<string, unknown>;
  setCatalogEntry(catalogs, catalog, key, value);
}

/** 処理フローの context.catalogs.<種類> から 1 件を消す。catalogs が空になれば catalogs ごと取り除く。消したら true。 */
export function removeCatalogEntry(
  ag: ProcessFlowDoc,
  catalog: CatalogName,
  key: string,
): boolean {
  const catalogs = ag.context?.catalogs as Record<string, unknown> | undefined;
  if (!catalogs) return false;
  const removed = deleteCatalogEntry(catalogs, catalog, key);
  if (Object.keys(catalogs).length === 0) delete ag.context!.catalogs;
  return removed;
}

export function insertStepAt(
  ag: ProcessFlowDoc,
  actionId: string,
  step: Step,
  position?: number,
  /** 指定すると、その工程の配下 (subSteps) に入れる (docs/spec/process-flow-substeps.md) */
  parentStepId?: string,
): void {
  const act = ag.actions.find((a) => a.id === actionId);
  if (!act) throw new Error(`action ${actionId} が見つかりません`);
  if (parentStepId) {
    let parent: Step | null = null;
    walkSteps(act.steps ?? [], (s) => { if (s.id === parentStepId) { parent = s; return true; } });
    if (!parent) throw new Error(`親の step ${parentStepId} がアクション ${actionId} に見つかりません`);
    const p = parent as Step;
    const list = p.subSteps ?? [];
    const at = position === undefined || position < 0 || position > list.length ? list.length : position;
    list.splice(at, 0, step);
    p.subSteps = list;
    return;
  }
  const steps = act.steps ?? [];
  const idx = position === undefined || position < 0 || position > steps.length
    ? steps.length
    : position;
  steps.splice(idx, 0, step);
  act.steps = steps;
}

// マーカーの操作は、設計の種類によらない共通の処理 (@harmony/shared の markers.ts) と markerStore.ts へ移した (#1509)
