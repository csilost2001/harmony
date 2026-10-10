/**
 * 処理フロー (1 アクション分のステップ列) を、図と処理記述表で見せるための構造解析。
 * frontend (処理フロー画面の 図 / 表、設計書ビュー) と HTML 設計書出力の両方から使う純関数。
 *
 * - buildOutline: 日本の処理記述書形式の行 (階層番号 / 処理 / 対象 / 条件・備考)
 * - layoutFlow: 構造化フローチャート (順次・分岐・繰り返し・トランザクション) の自動配置
 */

/** ステップの最小形 (schemas/v3/process-flow.v3.schema.json の Step) */
export interface FlowStep {
  id: string;
  kind: string;
  description?: string;
  [key: string]: unknown;
}

export interface FlowActionLike {
  name?: string;
  trigger?: string;
  steps: FlowStep[];
  responses?: Array<{ id: string; status: number }>;
}

/** ステップ種別の日本語名 */
export const STEP_KIND_LABELS: Record<string, string> = {
  validation: "入力チェック",
  dbAccess: "DBアクセス",
  externalSystem: "外部システム",
  componentCall: "コンポーネント呼出",
  commonProcess: "共通処理",
  screenTransition: "画面遷移",
  displayUpdate: "表示更新",
  branch: "分岐",
  loop: "ループ",
  loopBreak: "ループ終了",
  loopContinue: "次の繰り返し",
  jump: "ジャンプ",
  compute: "計算/代入",
  return: "レスポンス返却",
  log: "ログ",
  audit: "監査",
  workflow: "ワークフロー",
  transactionScope: "トランザクション",
  eventPublish: "イベント発行",
  eventSubscribe: "イベント購読",
  closing: "締め処理",
  cdc: "CDC",
  aiCall: "AI 呼出",
  aiAgent: "AI エージェント",
  extension: "拡張",
  other: "その他",
};

/** DB 操作の日本語名 (大文字・小文字を問わない) */
export const DB_OPERATION_LABELS: Record<string, string> = {
  select: "検索",
  insert: "登録",
  update: "更新",
  delete: "削除",
  upsert: "登録または更新",
  call: "呼び出し",
  other: "その他",
};

export function dbOperationLabel(op: string): string {
  return DB_OPERATION_LABELS[op.toLowerCase()] ?? op;
}

/** 分岐条件を人が読める文字列にする */
export function branchConditionText(cond: unknown): string {
  if (!cond || typeof cond !== "object") return "";
  const c = cond as Record<string, unknown>;
  switch (c.kind) {
    case "expression": return String(c.expression ?? "");
    case "tryCatch": return `catch ${String(c.errorCode ?? "")}${c.description ? ` (${String(c.description)})` : ""}`;
    case "affectedRowsZero": return `affectedRowsZero${c.stepId ? ` (@${String(c.stepId)})` : ""}`;
    case "externalOutcome": return `${String(c.outcome ?? "")}${c.stepId ? ` (@${String(c.stepId)})` : ""}`;
    default: return "";
  }
}

export interface FlowContext {
  tableName: (id: string) => string | undefined;
  screenName: (id: string) => string | undefined;
}

const NO_CTX: FlowContext = { tableName: () => undefined, screenName: () => undefined };

type AnyStep = FlowStep;

/** ステップの種別名 (日本語) */
export function kindLabel(step: FlowStep): string {
  return STEP_KIND_LABELS[step.kind] ?? step.kind;
}

/** 対象 (テーブル・外部システム・画面・共通処理など) */
export function stepTarget(step: FlowStep, ctx: FlowContext = NO_CTX): string {
  const s = step as AnyStep;
  switch (step.kind) {
    case "dbAccess": {
      const t = String(s.tableId ?? "");
      const op = String(s.operation ?? "");
      return `${ctx.tableName(t) ?? t} ${dbOperationLabel(op)}`.trim();
    }
    case "externalSystem": return String(s.systemRef ?? "");
    case "screenTransition": {
      const id = String(s.targetScreenId ?? "");
      return ctx.screenName(id) ?? id;
    }
    case "commonProcess": return String(s.refId ?? "");
    case "componentCall": return String(s.componentRef ?? s.component ?? "");
    case "eventPublish":
    case "eventSubscribe": return String(s.topic ?? s.eventRef ?? "");
    case "transactionScope": return String(s.isolationLevel ?? "READ_COMMITTED");
    default: return "";
  }
}

/** 説明文が「422 …」「HTTP 422 …」のようにステータスで始まる場合、併記するステータスと重ならないよう除く */
function stripStatus(text: string, status: number | undefined): string {
  return status ? text.replace(new RegExp(`^(HTTP\\s*)?${status}\\s*`), "") : text;
}

/** HTTP ステータス (return ステップが参照する応答定義から) */
export function returnStatus(step: FlowStep, action: Pick<FlowActionLike, "responses"> | null): number | undefined {
  if (step.kind !== "return") return undefined;
  const rid = (step as AnyStep).responseId as string | undefined;
  const r = action?.responses?.find((x) => x.id === rid);
  if (r) return r.status;
  const m = rid?.match(/^(\d{3})/);
  return m ? Number(m[1]) : undefined;
}

/** 条件・備考 */
export function stepNote(step: FlowStep, action: Pick<FlowActionLike, "responses"> | null = null): string {
  const s = step as AnyStep;
  const parts: string[] = [];
  if (s.runIf) parts.push(`実行条件: ${String(s.runIf)}`);
  switch (step.kind) {
    case "loop": {
      const lk = s.loopKind;
      if (lk === "count") parts.push(`回数: ${String(s.countExpression ?? "")}`);
      else if (lk === "condition") parts.push(`${s.conditionMode === "exit" ? "終了条件" : "継続条件"}: ${String(s.conditionExpression ?? "")}`);
      else parts.push(`対象: ${String(s.collectionSource ?? "")}${s.collectionItemName ? ` → ${String(s.collectionItemName)}` : ""}`);
      break;
    }
    case "return": {
      const st = returnStatus(step, action);
      if (st) parts.push(`HTTP ${st}`);
      break;
    }
    case "transactionScope":
      if (s.propagation) parts.push(String(s.propagation));
      break;
    default:
  }
  return parts.join(" / ");
}

/** 1 行の短い表示文 (description を優先) */
export function stepText(step: FlowStep): string {
  const d = (step as AnyStep).description;
  return typeof d === "string" && d ? d : kindLabel(step);
}

// ── 処理記述表 ─────────────────────────────────────────────────────────────

export interface OutlineRow {
  /** 階層番号 (例: 6-1, 4-A-1) */
  no: string;
  depth: number;
  /** step 行 or 分岐の枝見出し */
  type: "step" | "branch-arm";
  step?: FlowStep;
  kind: string;
  text: string;
  target: string;
  note: string;
  /** トランザクション内の行 */
  inTx: boolean;
  /** 異常終了 (4xx / 5xx を返す return) */
  isError: boolean;
}

export function buildOutline(steps: readonly FlowStep[], action: Pick<FlowActionLike, "responses"> | null, ctx: FlowContext = NO_CTX): OutlineRow[] {
  const rows: OutlineRow[] = [];
  const walk = (list: readonly FlowStep[], prefix: string, depth: number, inTx: boolean) => {
    list.forEach((step, i) => {
      const no = prefix ? `${prefix}-${i + 1}` : String(i + 1);
      const st = returnStatus(step, action);
      rows.push({
        no, depth, type: "step", step, kind: kindLabel(step), text: stepText(step), target: stepTarget(step, ctx),
        note: stepNote(step, action), inTx, isError: st !== undefined && st >= 400,
      });
      const s = step as AnyStep;
      if (step.kind === "branch") {
        const arms = [...((s.branches as Array<{ code: string; label?: string; condition: unknown; steps: FlowStep[] }>) ?? [])];
        const els = s.elseBranch as { code: string; label?: string; steps: FlowStep[] } | undefined;
        for (const b of arms) {
          rows.push({
            no: `${no}-${b.code}`, depth: depth + 1, type: "branch-arm", kind: "条件", inTx, isError: false,
            text: b.label ?? b.code, target: "", note: branchConditionText(b.condition) ?? "",
          });
          walk(b.steps ?? [], `${no}-${b.code}`, depth + 2, inTx);
        }
        if (els) {
          rows.push({ no: `${no}-${els.code}`, depth: depth + 1, type: "branch-arm", kind: "上記以外", inTx, isError: false, text: els.label ?? "上記以外", target: "", note: "" });
          walk(els.steps ?? [], `${no}-${els.code}`, depth + 2, inTx);
        }
      } else if (step.kind === "loop") {
        walk((s.steps as FlowStep[]) ?? [], no, depth + 1, inTx);
      } else if (step.kind === "transactionScope") {
        walk((s.steps as FlowStep[]) ?? [], no, depth + 1, true);
        const onCommit = (s.onCommit as FlowStep[] | undefined) ?? [];
        const onRollback = (s.onRollback as FlowStep[] | undefined) ?? [];
        if (onCommit.length) {
          rows.push({ no: `${no}-C`, depth: depth + 1, type: "branch-arm", kind: "コミット後", inTx: false, isError: false, text: "コミット後", target: "", note: "" });
          walk(onCommit, `${no}-C`, depth + 2, false);
        }
        if (onRollback.length) {
          rows.push({ no: `${no}-R`, depth: depth + 1, type: "branch-arm", kind: "ロールバック時", inTx: false, isError: true, text: "ロールバック時", target: "", note: "" });
          walk(onRollback, `${no}-R`, depth + 2, false);
        }
      }
    });
  };
  walk(steps, "", 0, false);
  return rows;
}

// ── フローチャート自動配置 ───────────────────────────────────────────────

export type NodeTone = "normal" | "db" | "decision" | "ok" | "error" | "start" | "jump";

export interface DiagramNode {
  id: string;
  stepId?: string;
  shape: "rect" | "diamond" | "pill";
  x: number; y: number; w: number; h: number;
  caption: string;
  text: string;
  sub?: string;
  tone: NodeTone;
  kind?: string;
  conditional?: boolean;
}

export interface DiagramFrame {
  id: string;
  kind: "loop" | "tx" | "commit" | "rollback";
  stepId?: string;
  x: number; y: number; w: number; h: number;
  label: string;
}

export interface DiagramEdge {
  points: Array<[number, number]>;
  label?: string;
  tone?: "normal" | "error" | "back" | "dashed";
  arrow?: boolean;
}

export interface DiagramLayout {
  width: number;
  height: number;
  nodes: DiagramNode[];
  frames: DiagramFrame[];
  edges: DiagramEdge[];
}

const NODE_W = 240;
const NODE_H = 54;
const DIAMOND_W = 220;
const DIAMOND_H = 64;
const PILL_H = 38;
const GAP_Y = 26;
const GAP_X = 36;
const FRAME_PAD = 16;
const FRAME_HEAD = 24;

interface Block {
  w: number;
  h: number;
  /** 流れの軸 (ブロック左端からの x) */
  cx: number;
  /** 下へ流れが続かない (return / jump 等で終わる) */
  terminates: boolean;
  place: (ox: number, oy: number, out: DiagramLayout) => void;
}

/**
 * 表示幅で省略する。n は全角 1 文字 = 1 とした幅 (半角は 0.55)。
 * 図のノード幅は固定のため、日本語と英数字が混ざっても枠からはみ出さないようにする。
 */
export function truncate(s: string, n: number): string {
  let w = 0;
  for (let i = 0; i < s.length; i++) {
    w += s.charCodeAt(i) < 0x2e80 ? 0.55 : 1;
    if (w > n) return `${s.slice(0, Math.max(i - 1, 1))}…`;
  }
  return s;
}

export function layoutFlow(action: FlowActionLike, ctx: FlowContext = NO_CTX): DiagramLayout {
  let seq = 0;
  const uid = (p: string) => `${p}-${seq++}`;

  const stepBlock = (step: FlowStep): Block => {
    const s = step as AnyStep;
    if (step.kind === "branch") return branchBlock(step);
    if (step.kind === "loop") return frameBlock(step, "loop", `↻ ${truncate(stepText(step), 16)}`, (s.steps as FlowStep[]) ?? []);
    if (step.kind === "transactionScope") return txBlock(step);

    if (step.kind === "return") {
      const st = returnStatus(step, action);
      const isErr = st !== undefined && st >= 400;
      return {
        w: NODE_W, h: PILL_H, cx: NODE_W / 2, terminates: true,
        place: (ox, oy, out) => out.nodes.push({
          id: uid("n"), stepId: step.id, shape: "pill", x: ox, y: oy, w: NODE_W, h: PILL_H,
          caption: st ? `HTTP ${st}` : "終了", text: truncate(stripStatus(stepText(step), st), 14), tone: isErr ? "error" : "ok", kind: step.kind,
        }),
      };
    }
    const terminal = step.kind === "jump" || step.kind === "loopBreak" || step.kind === "loopContinue";
    const target = stepTarget(step, ctx);
    return {
      w: NODE_W, h: NODE_H, cx: NODE_W / 2, terminates: terminal,
      place: (ox, oy, out) => out.nodes.push({
        id: uid("n"), stepId: step.id, shape: "rect", x: ox, y: oy, w: NODE_W, h: NODE_H,
        caption: kindLabel(step), text: truncate(stepText(step), 17.5), sub: target ? truncate(target, 20) : undefined,
        tone: terminal ? "jump" : step.kind === "dbAccess" ? "db" : "normal", kind: step.kind, conditional: !!s.runIf,
      }),
    };
  };

  const seqBlock = (steps: readonly FlowStep[]): Block => {
    if (steps.length === 0) {
      return { w: 40, h: 12, cx: 20, terminates: false, place: () => undefined };
    }
    const blocks = steps.map(stepBlock);
    const left = Math.max(...blocks.map((b) => b.cx));
    const right = Math.max(...blocks.map((b) => b.w - b.cx));
    const h = blocks.reduce((a, b) => a + b.h, 0) + GAP_Y * (blocks.length - 1);
    // 途中で終わるブロックの後ろは到達しない (それ以降は描くが線でつながない)
    const terminates = blocks.some((b) => b.terminates);
    return {
      w: left + right, h, cx: left, terminates,
      place: (ox, oy, out) => {
        let y = oy;
        blocks.forEach((b, i) => {
          b.place(ox + left - b.cx, y, out);
          if (i < blocks.length - 1 && !b.terminates) {
            out.edges.push({ points: [[ox + left, y + b.h], [ox + left, y + b.h + GAP_Y]], arrow: true });
          }
          y += b.h + GAP_Y;
        });
      },
    };
  };

  const branchBlock = (step: FlowStep): Block => {
    const s = step as AnyStep;
    const arms = ((s.branches as Array<{ code: string; label?: string; condition: unknown; steps: FlowStep[] }>) ?? []).map((b) => ({
      label: `${b.code}: ${truncate(b.label ?? branchConditionText(b.condition) ?? "", 10)}`,
      block: seqBlock(b.steps ?? []),
    }));
    const els = s.elseBranch as { code: string; label?: string; steps: FlowStep[] } | undefined;
    arms.push({ label: els ? `${els.code}: ${truncate(els.label ?? "上記以外", 10)}` : "上記以外", block: seqBlock(els?.steps ?? []) });
    const colsW = arms.reduce((a, c) => a + c.block.w, 0) + GAP_X * (arms.length - 1);
    const w = Math.max(colsW, DIAMOND_W);
    const colsH = Math.max(...arms.map((c) => c.block.h));
    const armTop = DIAMOND_H + 40;
    const mergeY = armTop + colsH + 22;
    const terminates = arms.every((c) => c.block.terminates);
    const cx = w / 2;
    return {
      w, h: terminates ? armTop + colsH : mergeY, cx, terminates,
      place: (ox, oy, out) => {
        out.nodes.push({
          id: uid("d"), stepId: step.id, shape: "diamond", x: ox + cx - DIAMOND_W / 2, y: oy, w: DIAMOND_W, h: DIAMOND_H,
          caption: "分岐", text: truncate(stepText(step), 11), tone: "decision", kind: "branch", conditional: !!s.runIf,
        });
        let x = ox + (w - colsW) / 2;
        arms.forEach((c) => {
          const axis = x + c.block.cx;
          const splitY = oy + DIAMOND_H + 12;
          const leadsToError = c.block.terminates && c.block.h <= PILL_H + 2;
          out.edges.push({
            points: [[ox + cx, oy + DIAMOND_H], [ox + cx, splitY], [axis, splitY], [axis, oy + armTop]],
            label: c.label, arrow: true, tone: leadsToError ? "error" : "normal",
          });
          c.block.place(x, oy + armTop, out);
          if (!c.block.terminates && !terminates) {
            out.edges.push({ points: [[axis, oy + armTop + c.block.h], [axis, oy + mergeY], [ox + cx, oy + mergeY]], arrow: false });
          }
          x += c.block.w + GAP_X;
        });
      },
    };
  };

  const frameBlock = (step: FlowStep, kind: DiagramFrame["kind"], label: string, inner: readonly FlowStep[]): Block => {
    const body = seqBlock(inner);
    const w = Math.max(body.w + FRAME_PAD * 2 + 24, NODE_W + FRAME_PAD * 2);
    const h = body.h + FRAME_PAD * 2 + FRAME_HEAD;
    const cx = w / 2;
    return {
      w, h, cx, terminates: false,
      place: (ox, oy, out) => {
        out.frames.push({ id: uid("f"), kind, stepId: step.id, x: ox, y: oy, w, h, label });
        const bx = ox + cx - body.cx;
        const by = oy + FRAME_HEAD + FRAME_PAD;
        body.place(bx, by, out);
        if (kind === "loop" && body.h > 12) {
          // 繰り返しの戻り線 (左側)
          const lx = ox + 10;
          out.edges.push({ points: [[ox + cx, by + body.h + 4], [lx, by + body.h + 4], [lx, by - 6], [ox + cx - 8, by - 6]], tone: "back", arrow: true });
        }
      },
    };
  };

  const txBlock = (step: FlowStep): Block => {
    const s = step as AnyStep;
    const main = frameBlock(step, "tx", `TX ${String(s.isolationLevel ?? "READ_COMMITTED")}`, (s.steps as FlowStep[]) ?? []);
    const rollback = (s.onRollback as FlowStep[] | undefined) ?? [];
    const commit = (s.onCommit as FlowStep[] | undefined) ?? [];
    const side = [
      ...(rollback.length ? [{ kind: "rollback" as const, label: "ロールバック時", block: seqBlock(rollback) }] : []),
      ...(commit.length ? [{ kind: "commit" as const, label: "コミット後", block: seqBlock(commit) }] : []),
    ];
    if (side.length === 0) return main;
    const sideW = Math.max(...side.map((x) => x.block.w)) + FRAME_PAD * 2;
    const sideH = side.reduce((a, x) => a + x.block.h + FRAME_PAD * 2 + FRAME_HEAD, 0) + 12 * (side.length - 1);
    const w = main.w + GAP_X + sideW;
    return {
      w, h: Math.max(main.h, sideH), cx: main.cx, terminates: false,
      place: (ox, oy, out) => {
        main.place(ox, oy, out);
        let y = oy;
        const sx = ox + main.w + GAP_X;
        side.forEach((sd) => {
          const fh = sd.block.h + FRAME_PAD * 2 + FRAME_HEAD;
          out.frames.push({ id: uid("f"), kind: sd.kind, x: sx, y, w: sideW, h: fh, label: sd.label });
          sd.block.place(sx + FRAME_PAD + (sideW - FRAME_PAD * 2 - sd.block.w) / 2, y + FRAME_HEAD + FRAME_PAD, out);
          out.edges.push({ points: [[ox + main.w, y + FRAME_HEAD / 2 + 4], [sx, y + FRAME_HEAD / 2 + 4]], tone: sd.kind === "rollback" ? "error" : "dashed", arrow: true });
          y += fh + 12;
        });
      },
    };
  };

  const body = seqBlock(action.steps ?? []);
  const MARGIN = 24;
  const startW = NODE_W;
  const left = Math.max(body.cx, startW / 2);
  const right = Math.max(body.w - body.cx, startW / 2);
  const out: DiagramLayout = { width: 0, height: 0, nodes: [], frames: [], edges: [] };
  const axis = MARGIN + left;
  out.nodes.push({ id: "start", shape: "pill", x: axis - startW / 2, y: MARGIN, w: startW, h: PILL_H, caption: "開始", text: truncate(action.name ?? "", 14), tone: "start" });
  const bodyTop = MARGIN + PILL_H + GAP_Y;
  out.edges.push({ points: [[axis, MARGIN + PILL_H], [axis, bodyTop]], arrow: true });
  body.place(axis - body.cx, bodyTop, out);
  let bottom = bodyTop + body.h;
  if (!body.terminates && (action.steps ?? []).length > 0) {
    out.edges.push({ points: [[axis, bottom], [axis, bottom + GAP_Y]], arrow: true });
    out.nodes.push({ id: "end", shape: "pill", x: axis - startW / 2, y: bottom + GAP_Y, w: startW, h: PILL_H, caption: "終了", text: "", tone: "ok" });
    bottom += GAP_Y + PILL_H;
  }
  out.width = MARGIN * 2 + left + right;
  out.height = bottom + MARGIN;
  return out;
}

// ── テスト観点 (分岐と終了から導出) ─────────────────────────────────────────

export interface TestViewpoint {
  no: number;
  /** 正常系 / 異常系 */
  category: "正常系" | "異常系";
  /** 到達条件 (分岐の枝の条件・実行条件・TX 失敗など) */
  conditions: string[];
  /** 期待結果 (HTTP ステータスと説明) */
  expected: string;
  status?: number;
  /** 終了するステップの階層番号 (処理記述表の No) */
  stepNo: string;
}

/**
 * アクションの処理フローから、終了 (return) ごとに 1 つのテスト観点を導出する。
 * 到達条件は、その終了を囲む分岐の枝の条件と実行条件 (runIf) を外側から順に並べたもの。
 * return を持たない最後まで到達する経路は「正常終了」とする。
 */
export function deriveTestViewpoints(action: FlowActionLike): TestViewpoint[] {
  const out: Omit<TestViewpoint, "no">[] = [];
  const walk = (steps: readonly FlowStep[], prefix: string, conds: string[], inRollback: boolean): boolean => {
    let terminated = false;
    steps.forEach((step, i) => {
      if (terminated) return;
      const no = prefix ? `${prefix}-${i + 1}` : String(i + 1);
      const s = step as Record<string, unknown>;
      const here = s.runIf ? [...conds, `実行条件: ${String(s.runIf)}`] : conds;
      if (step.kind === "return") {
        const st = returnStatus(step, action);
        out.push({
          category: st !== undefined && st >= 400 ? "異常系" : inRollback ? "異常系" : "正常系",
          conditions: here.length ? here : ["すべての入力が正しい"],
          expected: st ? `HTTP ${st} ${stripStatus(stepText(step), st)}`.trim() : stepText(step),
          status: st,
          stepNo: no,
        });
        if (!s.runIf) terminated = true;
        return;
      }
      if (step.kind === "branch") {
        const arms = (s.branches as Array<{ code: string; label?: string; condition: unknown; steps: FlowStep[] }>) ?? [];
        const allEnd: boolean[] = [];
        for (const b of arms) {
          const label = b.label ?? b.code;
          const c = branchConditionText(b.condition);
          allEnd.push(walk(b.steps ?? [], `${no}-${b.code}`, [...here, c ? `${label} (${c})` : label], inRollback));
        }
        const els = s.elseBranch as { code: string; label?: string; steps: FlowStep[] } | undefined;
        if (els) allEnd.push(walk(els.steps ?? [], `${no}-${els.code}`, [...here, els.label ?? "上記以外"], inRollback));
        if (els && allEnd.length > 0 && allEnd.every(Boolean)) terminated = true;
        return;
      }
      if (step.kind === "loop") {
        walk((s.steps as FlowStep[]) ?? [], no, [...here, `繰り返し中: ${stepText(step)}`], inRollback);
        return;
      }
      if (step.kind === "transactionScope") {
        walk((s.steps as FlowStep[]) ?? [], no, here, inRollback);
        const rb = (s.onRollback as FlowStep[] | undefined) ?? [];
        if (rb.length) walk(rb, `${no}-R`, [...here, "トランザクションが失敗しロールバック"], true);
        const cm = (s.onCommit as FlowStep[] | undefined) ?? [];
        if (cm.length) walk(cm, `${no}-C`, here, inRollback);
        return;
      }
      if (step.kind === "validation") {
        out.push({ category: "異常系", conditions: [...here, `入力チェックに違反 (${stepText(step)})`], expected: "入力チェックエラー (HTTP 400 想定)", status: 400, stepNo: no });
      }
    });
    return terminated;
  };
  const ended = walk(action.steps ?? [], "", [], false);
  if (!ended && (action.steps ?? []).length > 0) {
    out.push({ category: "正常系", conditions: ["すべての入力が正しい"], expected: "最後まで処理して正常終了", stepNo: "-" });
  }
  // 正常系を先頭に、異常系は出現順
  const sorted = [...out.filter((v) => v.category === "正常系"), ...out.filter((v) => v.category === "異常系")];
  return sorted.map((v, i) => ({ no: i + 1, ...v }));
}
