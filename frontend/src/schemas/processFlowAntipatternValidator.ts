/**
 * ProcessFlow JSON の既知アンチパターン 4 件を機械検出 (#741)。
 *
 * retail dogfood (#709) で発見した 8 種の既知落とし穴のうち、
 * 静的解析で機械検出できる 4 件を実装する。
 *
 * Check 16: LITERAL_CONV_REFERENCE
 *   '@conv.X' または "@conv.X" のリテラル化を検出。
 *   クォート内に @conv.<path> があると評価エンジンが文字列扱いし conv 解決されない。
 *
 * Check 17: DUPLICATE_KIND_KEY
 *   同 step オブジェクト内で "kind": フィールドが複数出現。
 *   JSON.parse 後では後者で上書きされ検出不能なため、raw 文字列 scan で検出する。
 *
 * Check 19: INVALID_SEQUENCE_CALL_SYNTAX
 *   @conv.numbering.X.nextSeq() / nextval() 呼び出し風の conv 経由構文を検出。
 *   シーケンスは dbAccess step + SELECT nextval('seq_X') で取得する必要がある。
 *
 * Check 23: MULTIPLE_STATEMENTS_IN_SQL
 *   dbAccess step の sql フィールドに ; で区切られた複数文が含まれる場合に warning。
 *   多くの ORM / DB ライブラリは単一文しか実行しないため step 分割を推奨。
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
    | "MULTIPLE_STATEMENTS_IN_SQL";
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

  // Check 16, 19, 23: ステップ走査
  const actions: unknown[] = Array.isArray(flowAny.actions) ? flowAny.actions : [];
  actions.forEach((action: unknown, ai: number) => {
    const actionAny = action as { steps?: Step[] };
    const steps: Step[] = actionAny.steps ?? [];

    walkSteps(steps, `actions[${ai}].steps`, (step, stepPath) => {
      // Check 16: LITERAL_CONV_REFERENCE — step 内の全文字列値を走査
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
    });
  });

  return issues;
}
