/**
 * ProcessFlow JSON の既知アンチパターン + #1263 Phase X2 dispatch rule を機械検出。
 *
 * Check 16-23: retail dogfood (#709、#741) で発見した既知落とし穴 4 件。
 * Check 30-31: RFC #1254 件 3.5 / 件 3.7 verdict の副作用 inline 禁止 + maturity-aware broken ref。
 * Check 32: RFC #1254 件 2 / #1264 verdict 観点 4 (#1263 Phase X2) の TX inner var leak 検出。
 * Check 33: RFC #1254 件 5 (#1263 Phase X3) の dbAccess SQL maturity-aware 必須化。
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
 *   `@<prefix>.<key>` 参照のうち、本 PR で **実装済みの 2 prefix** (`@var` / `@event`) で
 *   キー後半が既知 catalog / scope に存在しない場合に検出。
 *   meta.maturity === "committed" なら error、それ以外 (draft / provisional) なら warning。
 *
 *   実装範囲 (#1267 adversarial review S-1 で正確化):
 *   - `@var`: 6 値 scope enum + step-id / tx-id の存在確認、暗黙参照は varKeys (action.inputs /
 *     ambient / step.outputBinding.name / loop.collectionItemName / branch.errorVar など) で突合
 *   - `@event`: ProcessFlow.context.catalogs.events のキー突合
 *
 *   本 PR で対象外 (silent pass、validator name に "_VAR_AND_EVENT_" を含めない代わりに
 *   error message で scope を明示する):
 *   - `@conv`: project-level conventionCategories catalog load 未実装のため Phase X2 で disable
 *     (Round 7 Should-fix 2 で convKeys dead-code 構築は削除、#1269 提案 C で再活性化予定)
 *   - `@msg` / `@const` / `@validation`: 横断 generic-definitions/* catalog 参照が必要、
 *     ProcessFlow 単体 validator では対応不可。#1269 提案 C (project-level catalog index) で対応予定
 *   - `@screen` / `@table` / `@view` / `@viewer` / `@layout` / `@contract` / `@type` /
 *     `@exception` / `@rule` / `@behavior` / `@policy` / `@component` / `@fragment` /
 *     `@logEvent` / `@logConfig` / `@seq` / `@system` / `@ext`: 同上、Phase X3 拡張対象
 *
 *   将来 #1269 提案 C で 24 prefix 全体へ拡張時、本コメントを更新すること。
 *
 * Check 32: TX_INNER_VAR_LEAK_OUTSIDE_TX (#1264 verdict 観点 4 / #1267 Round 7 Must-fix 5)
 *   TransactionScopeStep inner step の outputBinding.name が TX 外から `@<varName>.<...>`
 *   shorthand 参照されている場合に検出 (severity は maturity 連動: committed=error / その他=warning)。
 *   #1264 verdict 「TX 内 → TX 外 mutation static 禁止」の validator-level enforcement。
 *   TX 外参照可な値は `transactionScope.outputBinding.expose` で明示宣言した key のみ
 *   (3 予約値 `committed` / `error` / `diagnostics` + 任意 inner var 名、Round 7 option C で拡張)。
 *   例: TX 内 `step-06a` で `outputBinding: { name: "newScore" }`、TX 外 `step-07` で
 *   `@newScore.id` 参照 → 本 Check 32 が違反として報告。
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
    | "BROKEN_REFERENCE_MATURITY_AWARE"
    | "TX_INNER_VAR_LEAK_OUTSIDE_TX"
    | "DB_ACCESS_SQL_REQUIRED_FOR_COMMITTED";
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
 * #1267 Codex review fix: `${someFunc({foo: 1}) + @flow.bar()}` のような nested object literal
 * が `${...}` 内に含まれる場合、単純な regex (`/\$\{([^}]*)\}/`) は最初の `}` で打ち切られて
 * 後続の `@flow.bar()` を見逃す。これを brace-counting parser で正しく対の `}` を捕捉する。
 */
const SIDE_EFFECT_PREFIXES = ["flow", "action", "step", "component", "rule"];

/**
 * `${...}` 補間ブロックを brace-counting で抽出する。nested `{...}` を含む式も対応。
 * 戻り値: 各 `${...}` の inner 内容 (`${` の直後から対の `}` 直前まで) と外側全文 snippet。
 */
function extractInterpolationBlocks(value: string): Array<{ inner: string; snippet: string }> {
  const blocks: Array<{ inner: string; snippet: string }> = [];
  let i = 0;
  const len = value.length;
  while (i < len) {
    // `${` の出現を探す
    if (value[i] === "$" && value[i + 1] === "{") {
      const startOuter = i;
      const startInner = i + 2;
      let depth = 1;
      let j = startInner;
      // 文字列リテラル内の `{` / `}` は depth に含めない
      let inSingle = false;
      let inDouble = false;
      let inBacktick = false;
      while (j < len && depth > 0) {
        const ch = value[j];
        if (ch === "\\") {
          j += 2;
          continue;
        }
        if (!inDouble && !inBacktick && ch === "'") {
          inSingle = !inSingle;
          j++;
          continue;
        }
        if (!inSingle && !inBacktick && ch === '"') {
          inDouble = !inDouble;
          j++;
          continue;
        }
        if (!inSingle && !inDouble && ch === "`") {
          inBacktick = !inBacktick;
          j++;
          continue;
        }
        if (!inSingle && !inDouble && !inBacktick) {
          if (ch === "{") depth++;
          else if (ch === "}") depth--;
        }
        j++;
      }
      if (depth === 0) {
        const inner = value.slice(startInner, j - 1);
        const snippet = value.slice(startOuter, j).slice(0, 150);
        blocks.push({ inner, snippet });
        i = j;
        continue;
      } else {
        // 対の `}` が見つからない (壊れた式) — 残りを skip
        break;
      }
    }
    i++;
  }
  return blocks;
}

function findSideEffectInlineBans(value: string): Array<{ prefix: string; snippet: string }> {
  const violations: Array<{ prefix: string; snippet: string }> = [];
  const blocks = extractInterpolationBlocks(value);
  for (const { inner, snippet } of blocks) {
    for (const prefix of SIDE_EFFECT_PREFIXES) {
      // `@<prefix>.<...>` または `@<prefix>(...)` (関数呼び出し風)
      const detectRe = new RegExp(`@${prefix}\\b\\s*[.(]`);
      if (detectRe.test(inner)) {
        violations.push({ prefix, snippet });
        break; // 同じ ${...} 内で重複報告しない
      }
    }
  }
  return violations;
}

// ─── Check 31: BROKEN_REFERENCE_MATURITY_AWARE (#1254 件 3.5 / #1263 Phase X2) ─

interface BrokenRefContext {
  /** action 全体で参照可能な変数集合 (action.inputs / ambient / 通常 step の outputBinding.name / loop var / errorVar / TX wrapper の outputBinding.name) */
  varKeys: Set<string>;
  /** ProcessFlow.context.catalogs.events のキー集合 */
  eventKeys: Set<string>;
  /** flow 全体に存在する step.id 集合 (`@var.step.<step-id>` の step-id 検証用) */
  stepIds: Set<string>;
  /** flow 全体に存在する transactionScope step の id 集合 (`@var.tx.<tx-id>` の tx-id 検証用) */
  txIds: Set<string>;
  /**
   * TX inner step の outputBinding.name 集合 (#1267 Round 7 Must-fix 5)。
   * `@<varName>` shorthand 参照 (例: `@newScore.id`) で `varName` が **txInnerVars に存在し
   * varKeys に存在しない** 場合、TX inner var の TX 外 shorthand 参照として違反報告。
   */
  txInnerVars: Set<string>;
  /**
   * TX wrapper の expose 設定 (#1267 Round 7 option C)。
   * key = TX wrapper outputBinding.name (`txResult` 等) OR TX step.id (`step-tx` 等、
   *       `@var.tx.<step-id>.<key>` form 用)、value = expose Set (`committed` / `error` /
   *       `diagnostics` の 3 予約値 + 任意 inner var 名)。
   *
   * `@var.action.<txName>.<key>` / `@<txName>.<key>` shorthand / `@var.tx.<step-id>.<key>` の
   * 全形式で `<key>` が expose Set に含まれない場合、TX 外参照 spec violation として検出する
   * (Check 32 TX_INNER_VAR_LEAK_OUTSIDE_TX)。
   */
  txExposeMap: Map<string, Set<string>>;
  /**
   * Phase X2 で対象外の prefix (msg / const / validation / screen / table / view 等) は
   * silent pass。横断 catalog 参照が必要なため #1269 提案 C (project-level validator) で対応予定。
   */
}

/**
 * ProcessFlow 全文字列値から `@<prefix>.<key>` 参照を収集し、context catalogs / 変数 scope に
 * 存在しない場合に broken ref として報告する。本 PR では @conv / @var / @event の 3 prefix のみ。
 *
 * key 部の charset: LocalId (`-` 含む camelCase / kebab-case) + Uuid (`-` 含む) + Identifier (camelCase)
 * を許容するため `-` を明示的に含める。例: `@var.step.step-06.committed`、`@screen.27e9117-0982-...`
 *
 * #1269 提案 A fix: UUID は数字始まりも有り得るため key 先頭 charset に `0-9` を追加。
 * (例: `@screen.0739c454-45d6-4c99-962a-7b0b9e113a22.item.foo` も match させる)
 * docs/spec/process-flow-prefix-system.md §3 階層参照 (`@screen.<id>.item.<id>` 等) を機械検証で
 * 取り扱うため必須。
 *
 * #1267 Opus review S-1 fix: `user@var.foo` のような email/IRC 風文字列で false positive を出さない
 * よう、`@` の直前が identifier 文字 (`[a-zA-Z0-9_]`) でないことを lookbehind で確認する。
 * Description が TemplateString 統合された影響で description / note 内に email アドレスが
 * 含まれる頻度が高いため重要 (Markdown link `[text](mailto:user@example.com)` 等も safe)。
 */
const REF_RE = /(?<![a-zA-Z0-9_])@([a-zA-Z][a-zA-Z0-9]*)\.([a-zA-Z0-9_][a-zA-Z0-9_.-]*)/g;

/**
 * `@<prefix>.<key>` 参照を 1 件抽出し、Phase X2 で対応する prefix について broken / TX-leak を判定する。
 *
 * @returns
 *  - `{ kind: "broken", prefix, key }` — `@var` / `@event` の参照先未定義 (Phase X3 で全 prefix 拡張予定)
 *  - `{ kind: "txLeak", varName, key }` — `@<varName>` shorthand 参照で `<varName>` が TX inner var
 *    (txInnerVars に存在) かつ action scope var に不在 (varKeys に不在) → TX 外参照 spec violation
 *  - `null` — 問題なし or 対象外 prefix (silent pass)
 */
type RefIssue =
  | { kind: "broken"; prefix: string; key: string }
  | { kind: "txLeak"; varName: string; key: string };

function collectBrokenRefs(value: string, ctx: BrokenRefContext): RefIssue[] {
  const issues: RefIssue[] = [];
  REF_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REF_RE.exec(value)) !== null) {
    const prefix = match[1];
    const key = match[2];
    const segments = key.split(".");
    const head = segments[0];

    if (prefix === "var") {
      // @var.<scope>.<name>.<...> 形式
      if (head === "step") {
        // @var.step.<step-id>.<...>
        const stepId = segments[1];
        if (!stepId || !ctx.stepIds.has(stepId)) {
          issues.push({ kind: "broken", prefix, key });
        }
      } else if (head === "tx") {
        // @var.tx.<tx-step-id>.<accessor>.<...> — #1267 option C: accessor を expose で検証
        const txId = segments[1];
        if (!txId || !ctx.txIds.has(txId)) {
          issues.push({ kind: "broken", prefix, key });
        } else if (segments.length >= 3) {
          const exposeSet = ctx.txExposeMap.get(txId);
          const accessor = segments[2];
          if (exposeSet && !exposeSet.has(accessor)) {
            issues.push({ kind: "txLeak", varName: `${txId}.${accessor}`, key });
          }
        }
      } else if (head === "action" && segments.length >= 2 && ctx.txExposeMap.has(segments[1])) {
        // @var.action.<txName>.<accessor>.<...> — #1267 option C: accessor を expose で検証
        const txName = segments[1];
        const exposeSet = ctx.txExposeMap.get(txName)!;
        const accessor = segments[2];
        if (!accessor || !exposeSet.has(accessor)) {
          issues.push({ kind: "txLeak", varName: `${txName}.${accessor ?? "?"}`, key });
        }
      } else if (!ctx.varKeys.has(head)) {
        // generic loose check (`flowParameter` / `action` / `loop` / `global` scope enum + ambient + 一般 var)
        issues.push({ kind: "broken", prefix, key });
      }
    } else if (prefix === "event") {
      if (!ctx.eventKeys.has(head) && !ctx.eventKeys.has(key)) {
        issues.push({ kind: "broken", prefix, key });
      }
    } else if (ctx.txExposeMap.has(prefix)) {
      // Shorthand `@<txName>.<accessor>.<...>` — #1267 option C: accessor を expose で検証
      const exposeSet = ctx.txExposeMap.get(prefix)!;
      if (!exposeSet.has(head)) {
        issues.push({ kind: "txLeak", varName: `${prefix}.${head}`, key });
      }
    } else if (ctx.txInnerVars.has(prefix) && !ctx.varKeys.has(prefix)) {
      // Shorthand `@<innerVar>.<...>` 直接参照 — TX 内 outputBinding を TX 外から shorthand 参照は
      // 常に禁止 (expose にあっても canonical access form は `@<txName>.<innerVar>` 経由のみ)。
      issues.push({ kind: "txLeak", varName: prefix, key });
    }
    // 他 prefix (conv / msg / const / validation / screen / table / view 等) は本 PR では skip
    // (横断 catalog 検証が必要、#1269 提案 C で project-level validator に拡張予定)
  }
  return issues;
}

function buildBrokenRefContext(flow: unknown): BrokenRefContext {
  const flowAny = flow as {
    context?: {
      catalogs?: { events?: Record<string, unknown> };
      ambientVariables?: Array<{ name: string }>;
    };
    actions?: Array<{
      inputs?: Array<{ name: string }>;
      steps?: Array<unknown>;
    }>;
  };
  const catalogs = flowAny.context?.catalogs ?? {};

  const varKeys = new Set<string>();
  // 6 値 scope enum (#1264 verdict)
  ["flowParameter", "action", "step", "tx", "loop", "global"].forEach((s) => varKeys.add(s));
  // action.inputs[].name (flowParameter scope の暗黙 var)
  (flowAny.actions ?? []).forEach((a) => {
    (a.inputs ?? []).forEach((inp) => varKeys.add(inp.name));
  });
  // ambient variables (@requestId / @traceId / @sessionUserId 等)
  (flowAny.context?.ambientVariables ?? []).forEach((av) => varKeys.add(av.name));

  // walk steps to collect outputBinding.name + step.id + transactionScope.id。
  // Round 7 Must-fix 5: TX scope tracking — TX inner step の outputBinding.name は txInnerVars に
  // 振り分け (varKeys に追加しない)。TX wrapper 自体の outputBinding (txResult 等) は varKeys へ。
  // Round 7 option C: TX wrapper の expose 設定を txExposeMap に記録 (outputBinding.name + step.id
  // 両方を key にして、`@var.action.<name>.<key>` / `@<name>.<key>` / `@var.tx.<step-id>.<key>` の
  // 全形式から lookup 可能にする)。3 予約値 (committed/error/diagnostics) は常に追加。
  const stepIds = new Set<string>();
  const txIds = new Set<string>();
  const txInnerVars = new Set<string>();
  const txExposeMap = new Map<string, Set<string>>();
  function walkVarBindings(steps: unknown[], withinTx: boolean) {
    for (const s of steps) {
      const sAny = s as {
        id?: string;
        kind?: string;
        outputBinding?: { name?: string; expose?: string[] };
        steps?: unknown[];
        branches?: Array<{ steps?: unknown[]; condition?: { errorVar?: string } }>;
        elseBranch?: { steps?: unknown[] };
        onCommit?: unknown[];
        onRollback?: unknown[];
        collectionItemName?: string;
        collectionIndexName?: string;
      };
      if (sAny.id) {
        stepIds.add(sAny.id);
        if (sAny.kind === "transactionScope") txIds.add(sAny.id);
      }
      const isTxStep = sAny.kind === "transactionScope";
      if (isTxStep) {
        // TX wrapper 自体の outputBinding (txResult 等) は action scope の expose 機構として varKeys へ
        if (sAny.outputBinding?.name) varKeys.add(sAny.outputBinding.name);
        // TX wrapper の expose Set を構築: 3 予約値 + 明示 expose 列挙値
        // #1267 Round 8 Codex Must-fix: 同一 action 内で同名 outputBinding.name を持つ
        // 複数 TX がある場合、後出しが前を上書きすると false positive leak になるため
        // 既存 entry があれば union する (safe 側、expose されたものは expose されたまま)。
        const newExpose = new Set<string>(["committed", "error", "diagnostics"]);
        (sAny.outputBinding?.expose ?? []).forEach((k) => newExpose.add(k));
        const mergeIntoExposeMap = (key: string) => {
          const existing = txExposeMap.get(key);
          if (existing) {
            newExpose.forEach((k) => existing.add(k));
          } else {
            txExposeMap.set(key, new Set(newExpose));
          }
        };
        // outputBinding.name と step.id の両方を key にして lookup 可能化
        if (sAny.outputBinding?.name) mergeIntoExposeMap(sAny.outputBinding.name);
        if (sAny.id) mergeIntoExposeMap(sAny.id);
        // TX inner steps[] は withinTx=true で再帰
        if (sAny.steps) walkVarBindings(sAny.steps, true);
        // onCommit / onRollback は TX 外で実行 (process-flow-transaction.md §4 規約 2)
        if (sAny.onCommit) walkVarBindings(sAny.onCommit, false);
        if (sAny.onRollback) walkVarBindings(sAny.onRollback, false);
      } else {
        // 通常 step: withinTx に応じて targetSet を切替
        const targetSet = withinTx ? txInnerVars : varKeys;
        if (sAny.outputBinding?.name) targetSet.add(sAny.outputBinding.name);
        if (sAny.collectionItemName) targetSet.add(sAny.collectionItemName);
        if (sAny.collectionIndexName) targetSet.add(sAny.collectionIndexName);
        (sAny.branches ?? []).forEach((b) => {
          if (b.condition?.errorVar) targetSet.add(b.condition.errorVar);
          if (b.steps) walkVarBindings(b.steps, withinTx);
        });
        if (sAny.elseBranch?.steps) walkVarBindings(sAny.elseBranch.steps, withinTx);
        if (sAny.steps) walkVarBindings(sAny.steps, withinTx);
      }
    }
  }
  (flowAny.actions ?? []).forEach((a) => walkVarBindings(a.steps ?? [], false));

  const eventKeys = new Set<string>(Object.keys(catalogs.events ?? {}));

  return { varKeys, eventKeys, stepIds, txIds, txInnerVars, txExposeMap };
}

// ─── walkSteps ──────────────────────────────────────────────────────────────

/**
 * Step visitor. #1267 Round 7 Must-fix 5: `withinTx` 引数を追加し、TransactionScopeStep の
 * `steps[]` 内を visit する際 true を渡す。`onCommit` / `onRollback` は TX 外で実行されるため false。
 */
type StepVisitor = (step: Step, path: string, withinTx: boolean) => void;

function walkSteps(steps: Step[], basePath: string, visit: StepVisitor, withinTx: boolean = false): void {
  steps.forEach((step, i) => {
    const path = `${basePath}[${i}]`;
    visit(step, path, withinTx);
    if (!isBuiltinStep(step)) return;
    if (step.kind === "branch") {
      (step.branches ?? []).forEach((b: { steps?: Step[] }, bi: number) =>
        walkSteps(b.steps ?? [], `${path}.branches[${bi}].steps`, visit, withinTx),
      );
      if (step.elseBranch) walkSteps(step.elseBranch.steps ?? [], `${path}.elseBranch.steps`, visit, withinTx);
    }
    if (step.kind === "loop") walkSteps(step.steps ?? [], `${path}.steps`, visit, withinTx);
    if (step.kind === "transactionScope") {
      // TX inner: withinTx=true で再帰
      walkSteps(step.steps ?? [], `${path}.steps`, visit, true);
      // onCommit / onRollback は TX 外で実行 (process-flow-transaction.md §4 規約 2)
      if (step.onCommit) walkSteps(step.onCommit, `${path}.onCommit`, visit, false);
      if (step.onRollback) walkSteps(step.onRollback, `${path}.onRollback`, visit, false);
    }
    if (step.kind === "externalSystem") {
      Object.entries(step.errorHandling?.outcomes ?? {}).forEach(([k, spec]: [string, unknown]) => {
        const specAny = spec as { sideEffects?: Step[] } | undefined;
        if (specAny?.sideEffects) walkSteps(specAny.sideEffects, `${path}.errorHandling.outcomes.${k}.sideEffects`, visit, withinTx);
      });
    }
  });
}

// ─── 文字列値を再帰走査するヘルパー ─────────────────────────────────────────

/**
 * step オブジェクト内の文字列値を再帰的に走査して、述語に一致する値を収集する。
 * expression / condition / sql 等の任意フィールドを対象にする。
 *
 * #1267 Round 7 Must-fix 5 fix: ネスト sub-step 構造 (`steps` / `branches` / `elseBranch` /
 * `onCommit` / `onRollback` / `sideEffects`) は walkSteps が個別 visit するため、本関数では skip
 * する。これにより TransactionScopeStep wrapper の visit で TX inner step の string value を
 * 重複検出 (withinTx context が不正確になる問題) を防ぐ。
 */
const NESTED_STEP_KEYS = new Set([
  "steps", "branches", "elseBranch", "onCommit", "onRollback", "sideEffects",
]);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function collectStringValues(obj: any, basePath: string, out: Array<{ path: string; value: string }>): void {
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    obj.forEach((item, i) => collectStringValues(item, `${basePath}[${i}]`, out));
    return;
  }
  for (const [key, value] of Object.entries(obj)) {
    // ネスト sub-step 構造は walkSteps が個別 visit する (Round 7 fix)
    if (NESTED_STEP_KEYS.has(key)) continue;
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
    const actionAny = action as { steps?: Step[]; maturity?: string };
    const steps: Step[] = actionAny.steps ?? [];
    // Action-level maturity が指定されていれば flow-level よりそちらを優先 (step < action < flow の継承)
    const actionMaturity: string = actionAny.maturity ?? maturity;

    walkSteps(steps, `actions[${ai}].steps`, (step, stepPath, withinTx) => {
      // Check 16, 30, 31, 32: step 内の全文字列値を走査
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

      // Check 33: DB_ACCESS_SQL_REQUIRED_FOR_COMMITTED (#1263 Phase X3 / #1254 件 5)
      // maturity-aware: dbAccess step は maturity=committed 時に sql 必須、draft は naturalQuery のみで可。
      // 継承順: step.maturity > action.maturity > flow.meta.maturity (Round 2 SF-3 で action-level 対応)。
      if (isBuiltinStep(step) && step.kind === "dbAccess") {
        const dbStep = step as unknown as { sql?: string; naturalQuery?: string; maturity?: string };
        const stepMaturity = dbStep.maturity ?? actionMaturity;
        if (stepMaturity === "committed" && !dbStep.sql) {
          issues.push({
            validator: "processFlowAntipatternValidator",
            severity: "error",
            code: "DB_ACCESS_SQL_REQUIRED_FOR_COMMITTED",
            path: `${stepPath}.sql`,
            message: `\`dbAccess\` step は \`maturity: "committed"\` の場合 \`sql\` 必須です${dbStep.naturalQuery ? ` (現状 \`naturalQuery\` のみで sql 未設定)` : ""}。draft 期間で \`naturalQuery\` を AI が実 SQL に変換してから committed 昇格してください (#1263 Phase X3 / #1254 件 5)。`,
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
      // Check 32: TX_INNER_VAR_LEAK_OUTSIDE_TX (#1264 verdict 観点 4 / #1267 Round 7 Must-fix 5)
      for (const { path, value } of stringValues) {
        const refs = collectBrokenRefs(value, refCtx);
        for (const ref of refs) {
          if (ref.kind === "broken") {
            issues.push({
              validator: "processFlowAntipatternValidator",
              severity: brokenRefSeverity,
              code: "BROKEN_REFERENCE_MATURITY_AWARE",
              path,
              // Round 7 Should-fix 1: scope を message で明示 (validator は @var / @event のみ対応、
              // 他 prefix は #1269 提案 C で実装予定)
              message: `\`@${ref.prefix}.${ref.key}\` の参照先が ProcessFlow.context / 変数 scope に存在しません (maturity=${maturity}、対象 prefix: @var / @event のみ)。${maturity === "committed" ? "committed では error として扱います" : "draft / provisional では warning として扱います"}`,
            });
          } else {
            // ref.kind === "txLeak" (Check 32):
            // 現在の参照が TX 外から発生している場合のみ違反として報告 (TX 内 step が同 TX 内
            // outputBinding を参照するのは valid pattern)。
            if (!withinTx) {
              issues.push({
                validator: "processFlowAntipatternValidator",
                severity: brokenRefSeverity,
                code: "TX_INNER_VAR_LEAK_OUTSIDE_TX",
                path,
                message: `\`@${ref.varName}.${ref.key}\` は TransactionScopeStep inner step の outputBinding を TX 外から参照していますが、#1264 verdict 観点 4「TX 内 → TX 外 mutation static 禁止」違反です (maturity=${maturity})。TX 外参照は \`transactionScope.outputBinding.expose\` で宣言した key のみ許可されます (3 予約値 \`committed\` / \`error\` / \`diagnostics\` + 任意 inner var 名、Round 7 option C)。${maturity === "committed" ? "committed では error として扱います" : "draft / provisional では warning として扱います"}`,
              });
            }
          }
        }
      }
    });
  });

  return issues;
}
