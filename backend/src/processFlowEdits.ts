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

/**
 * stepId を探すアクションを決める (#1603)。actionId があればそのアクションだけ。
 * 無ければ全アクションだが、同じ id の工程が複数のアクションにあるときは、どれに当たるか分からないのでエラーにする
 * (以前は黙って最初のアクションに当たり、別のアクションの工程を書き換える事故が起きた)。
 */
function actionsToSearch(ag: ProcessFlowDoc, stepId: string, actionId?: string): Action[] {
  if (actionId !== undefined) {
    const act = ag.actions.find((x) => x.id === actionId);
    if (!act) throw new Error(`action ${actionId} が見つかりません`);
    return [act];
  }
  const hits = ag.actions.filter((x) => walkSteps(x.steps, (s) => s.id === stepId));
  if (hits.length > 1) {
    throw new Error(`工程の id「${stepId}」は複数のアクション (${hits.map((x) => x.id).join(", ")}) にあります。actionId で指定してください (重複は designer__renumber_step_ids で振り直せます)`);
  }
  return hits.length ? hits : ag.actions;
}

/** stepId で step を探す (見つからなければ null)。actionId を渡すとそのアクションの中だけ */
export function findStep(ag: ProcessFlowDoc, stepId: string, actionId?: string): Step | null {
  let found: Step | null = null;
  for (const a of actionsToSearch(ag, stepId, actionId)) {
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
  actionId?: string,
): { parentArray: Step[]; index: number; action: Action } | null {
  let result: { parentArray: Step[]; index: number; action: Action } | null = null;
  for (const a of actionsToSearch(ag, stepId, actionId)) {
    walkSteps(a.steps, (s, arr, idx) => {
      if (s.id === stepId) { result = { parentArray: arr, index: idx, action: a }; return true; }
    });
    if (result) break;
  }
  return result;
}

export function updateStep(ag: ProcessFlowDoc, stepId: string, patch: Record<string, unknown>, actionId?: string): void {
  const s = findStep(ag, stepId, actionId);
  if (!s) throw new Error(`step ${stepId} が見つかりません`);
  Object.assign(s, patch);
}

export function removeStep(ag: ProcessFlowDoc, stepId: string, actionId?: string): void {
  const ctx = findStepWithContext(ag, stepId, actionId);
  if (!ctx) throw new Error(`step ${stepId} が見つかりません`);
  ctx.parentArray.splice(ctx.index, 1);
}

export function moveStep(ag: ProcessFlowDoc, stepId: string, newIndex: number, actionId?: string): void {
  const ctx = findStepWithContext(ag, stepId, actionId);
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
export function nestStep(ag: ProcessFlowDoc, stepId: string, direction: "indent" | "outdent", actionId?: string): void {
  const ctx = findStepWithContext(ag, stepId, actionId);
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
  walkSteps(ctx.action.steps, (s) => { if (s.subSteps === ctx.parentArray) { owner = s; return true; } });
  if (!owner) throw new Error(`step ${stepId} は入れ子の中にないので、アウトデントできません`);
  const ownerStep = owner as Step;
  const ownerCtx = findStepWithContext(ag, ownerStep.id, ctx.action.id);
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

/** アクションに patch を合わせる (#1603)。id と steps は変えられない (工程は工程のツールで直す)。値が null の項目は消す */
export function updateAction(ag: ProcessFlowDoc, actionId: string, patch: Record<string, unknown>): void {
  const act = ag.actions.find((x) => x.id === actionId);
  if (!act) throw new Error(`action ${actionId} が見つかりません`);
  for (const k of ["id", "steps"]) if (k in patch) throw new Error(`patch で ${k} は変えられません${k === "steps" ? " (工程は edit_steps / update_step などで直してください)" : ""}`);
  mergePatch(act, patch);
}

/** アクションを消す (#1603) */
export function removeAction(ag: ProcessFlowDoc, actionId: string): void {
  const at = ag.actions.findIndex((x) => x.id === actionId);
  if (at < 0) throw new Error(`action ${actionId} が見つかりません`);
  ag.actions.splice(at, 1);
}

/** 処理フロー本体 (meta) に patch を合わせる (#1603)。id は変えられない (改名は designer__rename_entity)。値が null の項目は消す */
export function updateFlowMeta(ag: ProcessFlowDoc, patch: Record<string, unknown>): void {
  if ("id" in patch) throw new Error("patch で id は変えられません (改名は designer__rename_entity)");
  const meta = ((ag as Record<string, unknown>).meta ??= {}) as Record<string, unknown>;
  mergePatch(meta, patch);
}

/** 一番上の項目だけを合わせる (入れ子のオブジェクトは丸ごと置き換え)。null は項目を消す */
function mergePatch(target: Record<string, unknown>, patch: Record<string, unknown>): void {
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) delete target[k];
    else target[k] = v;
  }
}

/** 工程を指す項目: Saga 補償の compensatesFor と、分岐の条件 (affectedRowsZero / externalOutcome) の stepId */
function retargetStepRefs(node: unknown, from: string, to: string): number {
  if (Array.isArray(node)) return node.reduce((n: number, x) => n + retargetStepRefs(x, from, to), 0);
  if (!node || typeof node !== "object") return 0;
  const o = node as Record<string, unknown>;
  let n = 0;
  if (o.compensatesFor === from) { o.compensatesFor = to; n++; }
  if ((o.kind === "affectedRowsZero" || o.kind === "externalOutcome") && o.stepId === from) { o.stepId = to; n++; }
  for (const v of Object.values(o)) if (v && typeof v === "object") n += retargetStepRefs(v, from, to);
  return n;
}

export interface RenumberedStep { actionId: string; from: string; to: string; refs: number }

/**
 * 重複した工程の id を振り直す (#1603)。最初に出てきた工程は元の id のまま、2 つ目以降に新しい id を付ける。
 * 別のアクションで重複していた工程は、そのアクションの中の参照 (compensatesFor・分岐の条件の stepId) も新しい id に付け替える。
 * 同じアクションの中の重複は、参照がどちらを指すか分からないので、参照は付け替えない (refs: 0)。
 */
export function renumberDuplicateStepIds(ag: ProcessFlowDoc, nextId: () => string): RenumberedStep[] {
  const seen = new Set<string>();
  const out: RenumberedStep[] = [];
  for (const act of ag.actions) {
    const renamed = new Map<string, string>();
    const inThisAction = new Set<string>();
    walkSteps(act.steps, (s) => {
      if (seen.has(s.id)) {
        const to = nextId();
        const crossAction = !inThisAction.has(s.id) && !renamed.has(s.id);
        if (crossAction) renamed.set(s.id, to);
        out.push({ actionId: act.id, from: s.id, to, refs: 0 });
        inThisAction.add(s.id);
        s.id = to;
      } else {
        seen.add(s.id);
        inThisAction.add(s.id);
      }
    });
    for (const [from, to] of renamed) {
      const refs = retargetStepRefs(act.steps, from, to);
      const rec = out.find((r) => r.actionId === act.id && r.from === from && r.to === to);
      if (rec) rec.refs = refs;
    }
  }
  return out;
}
