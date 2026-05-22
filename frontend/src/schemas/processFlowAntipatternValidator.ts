/**
 * ProcessFlow JSON の既知アンチパターン + #1263 Phase X2 dispatch rule を機械検出。
 *
 * Check 16-23: retail dogfood (#709、#741) で発見した既知落とし穴 4 件。
 * Check 30-31: RFC #1254 件 3.5 / 件 3.7 verdict の副作用 inline 禁止 + maturity-aware broken ref。
 *
 * Check 16: LITERAL_CONV_REFERENCE
 *   '@conv.X' または "@conv.X" のリテラル化を検出。
 *
 * Check 17: DUPLICATE_KIND_KEY
 *   同 step オブジェクト内で "kind": フィールドが複数出現 (raw scan)。
 *
 * Check 19: INVALID_SEQUENCE_CALL_SYNTAX
 *   @conv.numbering.X.nextSeq() / nextval() 呼び出し風の conv 経由構文を検出。
 *
 * Check 23: MULTIPLE_STATEMENTS_IN_SQL
 *   dbAccess step の sql フィールドに ; で区切られた複数文。
 *
 * Check 30: SIDE_EFFECT_INLINE_BAN (#1254 件 3.7 / #1263 Phase X2)
 *   `${...}` 補間内で `@flow.<id>(...)` / `@action.<id>(...)` / `@step.<id>(...)` /
 *   `@component.<name>.<op>(...)` / `@rule.<name>(...)` を呼び出すのは禁止。
 *   副作用 invocation のため専用 step (commonProcess / componentCall 等) を使うこと。
 *   error severity。
 *
 * Check 31: BROKEN_REFERENCE_MATURITY_AWARE (#1254 件 3.5 / #1263 Phase X2)
 *   `@<prefix>.<key>` 参照のうち、限定 prefix (`@conv` / `@var` / `@msg` / `@const` /
 *   `@validation` / `@event`) のキー後半が既知 catalog / scope に存在しない場合に検出。
 *   meta.maturity === "committed" なら error、それ以外 (draft / provisional) なら warning。
 *   24 prefix 全体の解決は scope 広大なため、本 PR では上記 6 prefix のみ対象 (Phase X3 で拡張)。
 */
import type { ProcessFlow, Step } from "../types/v3";
import { isBuiltinStep } from "./stepGuards";

export interface AntipatternIssue {
  /** 検出した validator 名 */
  validator: "processFlowAntipatternValidator";
  severity: "error" | "warning";
  /** チェックコード */
  code:
    | "LITERAL_CONV_REFERENCE"
    | "DUPLICATE_KIND_KEY"
    | "INVALID_SEQUENCE_CALL_SYNTAX"
    | "MULTIPLE_STATEMENTS_IN_SQL"
    | "SIDE_EFFECT_INLINE_BAN"
    | "BROKEN_REFERENCE_MATURITY_AWARE";
  /** ドットパス (例: actions[0].steps[1].expression) */
  path: string;
  message: string;
}

// ─── Check 16: LITERAL_CONV_REFERENCE ───────────────────────────────────────

/**
 * シングルクォートまたはダブルクォート内に @conv.<path> が含まれる式を検出する。
 * 例 NG: '@conv.msg.productNotFound'.replace(...)
 * 例 OK: @conv.msg.productNotFound.replace(...)
 */
const LITERAL_CONV_RE = /(['"])@conv\.[a-zA-Z_][\w.]*\1/g;

function hasLiteralConvRef(value: string): boolean {
  LITERAL_CONV_RE.lastIndex = 0;
  return LITERAL_CONV_RE.test(value);
}

// ─── Check 17: DUPLICATE_KIND_KEY ───────────────────────────────────────────

/**
 * raw JSON 文字列を走査し、1 つのオブジェクトの直接フィールドとして
 * `"kind":` が 2 回以上出現する箇所を検出する。
 * JSON.parse 後は後者の値で上書きされるため raw scan が必須。
 *
 * アルゴリズム:
 * 1. JSON 文字列を 1 文字ずつ走査する
 * 2. `{` を見つけたら、そのオブジェクトの直接子 (depth=1) を走査し始める
 * 3. 直接子フィールドとして `"kind":` が出現するたびにカウントを増やす
 *    (ネストしたオブジェクト内は depth>1 なので除外)
 * 4. `}` で depth が 0 に戻ったら集計し、count >= 2 なら検出
 */
function findDuplicateKindObjects(rawJson: string): Array<{ offset: number; count: number }> {
  const results: Array<{ offset: number; count: number }> = [];
  const len = rawJson.length;

  /** 文字列 (ダブルクォート開始直後) をスキップして終了位置を返す */
  function skipString(pos: number): number {
    while (pos < len) {
      if (rawJson[pos] === '\\') { pos += 2; continue; }
      if (rawJson[pos] === '"') { return pos + 1; }
      pos++;
    }
    return pos;
  }

  let i = 0;
  while (i < len) {
    const ch = rawJson[i];

    // 文字列をスキップ (外側スキャン: { を探すだけ)
    if (ch === '"') {
      i = skipString(i + 1);
      continue;
    }

    if (ch === '{') {
      const startOffset = i;
      let depth = 1;
      let j = i + 1;
      let kindCount = 0;

      while (j < len && depth > 0) {
        const c = rawJson[j];

        if (c === '"') {
          // depth=1 の場合: このキーが "kind"\s*: パターンか確認
          if (depth === 1) {
            // j は '"' を指している。"kind" + 任意空白 + ':' にマッチするか
            const sub = rawJson.slice(j);
            const keyMatch = sub.match(/^"kind"\s*:/);
            if (keyMatch) {
              kindCount++;
            }
          }
          j = skipString(j + 1);
          continue;
        }

        if (c === '{' || c === '[') { depth++; j++; continue; }
        if (c === '}' || c === ']') { depth--; j++; continue; }
        j++;
      }

      if (kindCount >= 2) {
        results.push({ offset: startOffset, count: kindCount });
      }

      i++;
      continue;
    }

    i++;
  }

  return results;
}

// ─── Check 19: INVALID_SEQUENCE_CALL_SYNTAX ─────────────────────────────────

/**
 * @conv.numbering.X.nextSeq() または @conv.numbering.X.nextval() のような
 * conv catalog 経由でメソッド呼び出し風の構文を検出する。
 *
 * 例 NG: String(@conv.numbering.orderNumber.nextSeq()).padStart(6, '0')
 * 例 OK: SELECT nextval('seq_order_number') (dbAccess step 内の SQL)
 */
const INVALID_SEQ_RE = /@conv\.numbering\.\w[\w.]*\(?\s*(nextSeq|nextval)\s*\(?/g;

function hasInvalidSequenceSyntax(value: string): boolean {
  INVALID_SEQ_RE.lastIndex = 0;
  return INVALID_SEQ_RE.test(value);
}

// ─── Check 23: MULTIPLE_STATEMENTS_IN_SQL ───────────────────────────────────

/**
 * sql フィールド内にセミコロンで区切られた複数文が含まれるか検出する。
 *
 * 文字列リテラル (`'...'`) / 行コメント (`-- ...`) / ブロックコメント (`/* ... *\/`) /
 * PL/pgSQL ドル引用 (`$$ ... $$` / `$tag$ ... $tag$`) 内の `;` は false positive を
 * 避けるため除外する。末尾のセミコロンのみも許容 (single statement の正常終端)。
 */
function hasMultipleStatements(sql: string): boolean {
  // 末尾の空白 + セミコロンを剥がす
  const trimmed = sql.replace(/[\s;]+$/, "");

  let inString = false;
  let inDollar = false;
  let dollarTag = "";
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i];
    const next = trimmed[i + 1];

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inString) {
      // SQL 標準のエスケープ '' (シングルクォート 2 連続)
      if (ch === "'" && next === "'") {
        i++;
        continue;
      }
      if (ch === "'") inString = false;
      continue;
    }
    if (inDollar) {
      if (ch === "$" && trimmed.slice(i, i + dollarTag.length) === dollarTag) {
        inDollar = false;
        i += dollarTag.length - 1;
        dollarTag = "";
      }
      continue;
    }

    // コメント / 文字列 / ドル引用の開始
    if (ch === "-" && next === "-") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === "'") {
      inString = true;
      continue;
    }
    if (ch === "$") {
      // $$ または $tag$ パターン
      const m = trimmed.slice(i).match(/^\$([a-zA-Z_]\w*)?\$/);
      if (m) {
        dollarTag = m[0];
        inDollar = true;
        i += dollarTag.length - 1;
        continue;
      }
    }

    // クォート / コメント / ドル引用の外側で `;` 検出 → 複数文
    if (ch === ";") return true;
  }

  return false;
}

// ─── Check 30: SIDE_EFFECT_INLINE_BAN (#1254 件 3.7 / #1263 Phase X2) ───────

/**
 * `${...}` 補間内で副作用 invocation prefix (`@flow / @action / @step / @component / @rule`)
 * を呼び出すのは禁止。これらは副作用を伴うため、専用 step (commonProcess / componentCall 等)
 * を使う必要がある。
 *
 * 検出: `${...}` 内 (closing `}` まで) に `@(flow|action|step|component|rule)\.` が現れる
 * または `@(flow|action|step|component|rule)(` (関数呼び出し) パターンを検出。
 */
const SIDE_EFFECT_PREFIXES = ["flow", "action", "step", "component", "rule"];
const INLINE_INTERPOLATION_RE = /\$\{([^}]*)\}/g;

function findSideEffectInlineBans(value: string): Array<{ prefix: string; snippet: string }> {
  const violations: Array<{ prefix: string; snippet: string }> = [];
  INLINE_INTERPOLATION_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_INTERPOLATION_RE.exec(value)) !== null) {
    const inner = match[1];
    for (const prefix of SIDE_EFFECT_PREFIXES) {
      // `@<prefix>.<...>` または `@<prefix>(...)` (関数呼び出し風)
      const detectRe = new RegExp(`@${prefix}\\b\\s*[.(]`);
      if (detectRe.test(inner)) {
        violations.push({ prefix, snippet: match[0].slice(0, 100) });
        break; // 同じ ${...} 内で重複報告しない
      }
    }
  }
  return violations;
}

// ─── Check 31: BROKEN_REFERENCE_MATURITY_AWARE (#1254 件 3.5 / #1263 Phase X2) ─

interface BrokenRefContext {
  /** ProcessFlow.context.catalogs から導出した参照可能 key 集合 */
  convKeys: Set<string>;
  /** action / step / loop / tx で定義された変数 (簡易、scope chain は厳密追跡しない) */
  varKeys: Set<string>;
  /** ProcessFlow.context.catalogs.events のキー集合 */
  eventKeys: Set<string>;
  /**
   * Phase X2 では @msg / @const / @validation の catalog は generic-definitions/* に
   * 置かれるが本 validator は ProcessFlow 単体検証のため横断 catalog の load は行わない。
   * 当該 prefix は「報告しない」(scope-out)、将来 X3 で project 全体 validator に拡張する想定。
   */
}

/**
 * ProcessFlow 全文字列値から `@<prefix>.<key>` 参照を収集し、context catalogs / 変数 scope に
 * 存在しない場合に broken ref として報告する。本 PR では @conv / @var / @event の 3 prefix のみ。
 */
const REF_RE = /@([a-zA-Z][a-zA-Z0-9]*)\.([a-zA-Z_][a-zA-Z0-9_.]*)/g;

function collectBrokenRefs(value: string, ctx: BrokenRefContext): Array<{ prefix: string; key: string }> {
  const broken: Array<{ prefix: string; key: string }> = [];
  REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REF_RE.exec(value)) !== null) {
    const prefix = match[1];
    const key = match[2];
    // 簡易判定: 最初のドット区切り segment が catalog key
    const head = key.split(".")[0];
    if (prefix === "conv") {
      // @conv.<category>.<key> 形式、<category> の存在のみ check (key 後半は dynamic)
      if (!ctx.convKeys.has(head)) broken.push({ prefix, key });
    } else if (prefix === "var") {
      // @var.<scope>.<name> または @var.<name>、最初の segment を check
      if (!ctx.varKeys.has(head)) broken.push({ prefix, key });
    } else if (prefix === "event") {
      // @event.<topic> 形式
      if (!ctx.eventKeys.has(head) && !ctx.eventKeys.has(key)) broken.push({ prefix, key });
    }
    // 他 prefix (msg / const / validation / screen / table / view 等) は本 PR では skip
    // (横断 catalog 検証が必要、Phase X3 で project-level validator に拡張)
  }
  return broken;
}

function buildBrokenRefContext(flow: unknown): BrokenRefContext {
  const flowAny = flow as {
    context?: {
      catalogs?: {
        errors?: Record<string, unknown>;
        externalSystems?: Record<string, unknown>;
        secrets?: Record<string, unknown>;
        envVars?: Record<string, unknown>;
        domains?: Record<string, unknown>;
        functions?: Record<string, unknown>;
        events?: Record<string, unknown>;
        modelEndpoints?: Record<string, unknown>;
      };
      ambientVariables?: Array<{ name: string }>;
    };
    actions?: Array<{
      inputs?: Array<{ name: string }>;
      steps?: Array<unknown>;
    }>;
  };
  const catalogs = flowAny.context?.catalogs ?? {};
  // @conv は category 名 (error / msg / regex / limit / role 等) を許容 + 既存 catalog keys
  // 簡易: 既知 conv カテゴリを hard-code (conventions catalog の category list)
  const convKeys = new Set<string>([
    "i18n", "msg", "regex", "limit", "scope", "currency", "tax",
    "auth", "role", "permission", "db", "numbering", "tx",
    "externalOutcomeDefaults", "extensionCategories", "fieldKeys",
  ]);
  // ProcessFlow 内 catalogs にあるキーも追加 (例: errors / externalSystems / events)
  Object.keys(catalogs.errors ?? {}).forEach((k) => convKeys.add(k));
  Object.keys(catalogs.externalSystems ?? {}).forEach((k) => convKeys.add(k));
  Object.keys(catalogs.events ?? {}).forEach((k) => convKeys.add(k));

  const varKeys = new Set<string>();
  // 6 値 scope enum (#1264 verdict)
  ["flowParameter", "action", "step", "tx", "loop", "global"].forEach((s) => varKeys.add(s));
  // action.inputs[].name (flowParameter scope の暗黙 var)
  (flowAny.actions ?? []).forEach((a) => {
    (a.inputs ?? []).forEach((inp) => varKeys.add(inp.name));
  });
  // ambient variables (@requestId / @traceId / @sessionUserId 等)
  (flowAny.context?.ambientVariables ?? []).forEach((av) => varKeys.add(av.name));

  // walk steps to collect outputBinding.name (簡易、scope chain は厳密追跡しない)
  function walkVarBindings(steps: unknown[]) {
    for (const s of steps) {
      const sAny = s as { outputBinding?: { name?: string }; steps?: unknown[]; branches?: Array<{ steps?: unknown[]; condition?: { errorVar?: string } }>; elseBranch?: { steps?: unknown[] }; onCommit?: unknown[]; onRollback?: unknown[]; collectionItemName?: string; collectionIndexName?: string };
      if (sAny.outputBinding?.name) varKeys.add(sAny.outputBinding.name);
      if (sAny.collectionItemName) varKeys.add(sAny.collectionItemName);
      if (sAny.collectionIndexName) varKeys.add(sAny.collectionIndexName);
      (sAny.branches ?? []).forEach((b) => {
        if (b.condition?.errorVar) varKeys.add(b.condition.errorVar);
        if (b.steps) walkVarBindings(b.steps);
      });
      if (sAny.elseBranch?.steps) walkVarBindings(sAny.elseBranch.steps);
      if (sAny.steps) walkVarBindings(sAny.steps);
      if (sAny.onCommit) walkVarBindings(sAny.onCommit);
      if (sAny.onRollback) walkVarBindings(sAny.onRollback);
    }
  }
  (flowAny.actions ?? []).forEach((a) => walkVarBindings(a.steps ?? []));

  const eventKeys = new Set<string>(Object.keys(catalogs.events ?? {}));

  return { convKeys, varKeys, eventKeys };
}

// ─── walkSteps ──────────────────────────────────────────────────────────────

type StepVisitor = (step: Step, path: string) => void;

function walkSteps(steps: Step[], basePath: string, visit: StepVisitor): void {
  steps.forEach((step, i) => {
    const path = `${basePath}[${i}]`;
    visit(step, path);
    if (!isBuiltinStep(step)) return;
    if (step.kind === "branch") {
      (step.branches ?? []).forEach((b: { steps?: Step[] }, bi: number) =>
        walkSteps(b.steps ?? [], `${path}.branches[${bi}].steps`, visit),
      );
      if (step.elseBranch) walkSteps(step.elseBranch.steps ?? [], `${path}.elseBranch.steps`, visit);
    }
    if (step.kind === "loop") walkSteps(step.steps ?? [], `${path}.steps`, visit);
    if (step.kind === "transactionScope") {
      walkSteps(step.steps ?? [], `${path}.steps`, visit);
      if (step.onCommit) walkSteps(step.onCommit, `${path}.onCommit`, visit);
      if (step.onRollback) walkSteps(step.onRollback, `${path}.onRollback`, visit);
    }
    if (step.kind === "externalSystem") {
      Object.entries(step.outcomes ?? {}).forEach(([k, spec]: [string, unknown]) => {
        const specAny = spec as { sideEffects?: Step[] } | undefined;
        if (specAny?.sideEffects) walkSteps(specAny.sideEffects, `${path}.outcomes.${k}.sideEffects`, visit);
      });
    }
  });
}

// ─── 文字列値を再帰走査するヘルパー ─────────────────────────────────────────

/**
 * step オブジェクト内の文字列値を再帰的に走査して、述語に一致する値を収集する。
 * expression / condition / sql 等の任意フィールドを対象にする。
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectStringValues(obj: any, basePath: string, out: Array<{ path: string; value: string }>): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectStringValues(item, `${basePath}[${i}]`, out));
    return;
  }
  for (const [key, value] of Object.entries(obj)) {
    const childPath = `${basePath}.${key}`;
    if (typeof value === "string") {
      out.push({ path: childPath, value });
    } else if (value && typeof value === "object") {
      collectStringValues(value, childPath, out);
    }
  }
}

// ─── メイン: checkAntipatterns ───────────────────────────────────────────────

/**
 * ProcessFlow 内の 4 種アンチパターンを検出する。
 *
 * @param flow JSON.parse 済みの ProcessFlow オブジェクト
 * @param rawJson readFileSync で得たファイルの生文字列 (Check 17 用)
 */
export function checkAntipatterns(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  flow: ProcessFlow | Record<string, any>,
  rawJson: string,
): AntipatternIssue[] {
  const issues: AntipatternIssue[] = [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const flowAny = flow as any;

  // Check 17: DUPLICATE_KIND_KEY — raw JSON scan
  const dupKindObjects = findDuplicateKindObjects(rawJson);
  if (dupKindObjects.length > 0) {
    // ファイル全体に 1 件報告 (offset 情報をメッセージに含める)
    for (const { offset, count } of dupKindObjects) {
      issues.push({
        validator: "processFlowAntipatternValidator",
        severity: "error",
        code: "DUPLICATE_KIND_KEY",
        path: `<raw offset ${offset}>`,
        message: `step オブジェクト内に \`kind\` フィールドが ${count} 個あります。schemas/v3 が許容する 1 形式に統一してください`,
      });
    }
  }

  // #1263 Phase X2: Check 31 のための context 構築
  const refCtx = buildBrokenRefContext(flowAny);
  // maturity 判定 (meta.maturity = "committed" → broken ref は error、それ以外 → warning)
  const maturity = (flowAny.meta as { maturity?: string })?.maturity ?? "draft";
  const brokenRefSeverity: "error" | "warning" = maturity === "committed" ? "error" : "warning";

  // Check 16, 19, 23, 30, 31: ステップ走査
  const actions: unknown[] = Array.isArray(flowAny.actions) ? flowAny.actions : [];
  actions.forEach((action: unknown, ai: number) => {
    const actionAny = action as { steps?: Step[] };
    const steps: Step[] = actionAny.steps ?? [];

    walkSteps(steps, `actions[${ai}].steps`, (step, stepPath) => {
      // Check 16, 30, 31: step 内の全文字列値を走査
      const stringValues: Array<{ path: string; value: string }> = [];
      collectStringValues(step, stepPath, stringValues);

      for (const { path, value } of stringValues) {
        if (hasLiteralConvRef(value)) {
          issues.push({
            validator: "processFlowAntipatternValidator",
            severity: "error",
            code: "LITERAL_CONV_REFERENCE",
            path,
            message: `\`@conv.<key>\` をシングルクォート/ダブルクォート文字列内に書くと評価されません。クォートを除去してください (検出値: ${value.slice(0, 80)})`,
          });
        }
      }

      // Check 19: INVALID_SEQUENCE_CALL_SYNTAX — step 内の全文字列値を走査
      for (const { path, value } of stringValues) {
        if (hasInvalidSequenceSyntax(value)) {
          issues.push({
            validator: "processFlowAntipatternValidator",
            severity: "error",
            code: "INVALID_SEQUENCE_CALL_SYNTAX",
            path,
            message: `\`@conv.numbering.X.nextSeq()\` は実行不能です。シーケンスは \`dbAccess\` step + \`SELECT nextval('seq_X')\` で取得してください`,
          });
        }
      }

      // Check 23: MULTIPLE_STATEMENTS_IN_SQL — dbAccess.sql のみ対象
      if (isBuiltinStep(step) && step.kind === "dbAccess") {
        const sql = (step as unknown as { sql?: string }).sql;
        if (typeof sql === "string" && hasMultipleStatements(sql)) {
          issues.push({
            validator: "processFlowAntipatternValidator",
            severity: "warning",
            code: "MULTIPLE_STATEMENTS_IN_SQL",
            path: `${stepPath}.sql`,
            message: `\`dbAccess.sql\` に複数文が含まれています (\`;\` で区切り)。多くの ORM / DB ライブラリは単一文しか実行しないため、step を分割してください`,
          });
        }
      }

      // Check 30: SIDE_EFFECT_INLINE_BAN (#1254 件 3.7 / #1263 Phase X2)
      for (const { path, value } of stringValues) {
        const bans = findSideEffectInlineBans(value);
        for (const { prefix, snippet } of bans) {
          issues.push({
            validator: "processFlowAntipatternValidator",
            severity: "error",
            code: "SIDE_EFFECT_INLINE_BAN",
            path,
            message: `\`\${...}\` 内で \`@${prefix}.<...>\` を呼び出すのは副作用 invocation のため禁止です (#1254 件 3.7)。専用 step (commonProcess / componentCall / eventPublish 等) を使ってください (検出: ${snippet})`,
          });
        }
      }

      // Check 31: BROKEN_REFERENCE_MATURITY_AWARE (#1254 件 3.5 / #1263 Phase X2)
      for (const { path, value } of stringValues) {
        const refs = collectBrokenRefs(value, refCtx);
        for (const { prefix, key } of refs) {
          issues.push({
            validator: "processFlowAntipatternValidator",
            severity: brokenRefSeverity,
            code: "BROKEN_REFERENCE_MATURITY_AWARE",
            path,
            message: `\`@${prefix}.${key}\` の参照先が ProcessFlow.context / 変数 scope に存在しません (maturity=${maturity})。${maturity === "committed" ? "committed では error として扱います" : "draft / provisional では warning として扱います"}`,
          });
        }
      }
    });
  });

  return issues;
}
