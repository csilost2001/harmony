/**
 * Entity ID 提案 / 衝突解消 utility (RFC #1284 / メタ #1292 / ISSUE #1297)
 *
 * 7 top-level entity (Screen / Table / ProcessFlow / Sequence / View /
 * ViewDefinition / PageLayout) の創成ダイアログで使う:
 *   - `slugifyToEntityId`: 任意文字列を kebab-case entity id 候補に正規化 (AI 失敗時の fallback)
 *   - `suggestUniqueIdSuffix`: 既存 id 集合と衝突しない suffix 付きの候補を返す
 *   - `generateFallbackEntityId`: 名前すら無い場合の最終 fallback (`<prefix>-<8桁短縮>`)
 *   - `requestAiSuggestedEntityId`: Codex 経由で name から id を提案
 *
 * 形式は `schemas/v3/common.v3.schema.json#EntityId` 準拠:
 *   pattern: ^[a-z][a-z0-9]*(-[a-z0-9]+)*$  minLength: 1  maxLength: 64
 */

import { isValidEntityId } from "./entityIdValidation";
import { generateUUID } from "./uuid";
import type { CodexBrowserClient } from "../codex/codexClient";
import { codexClient as defaultCodexClient } from "../codex/codexClient";
import type { CodexNotification } from "../codex/types";

const MAX_ENTITY_ID_LENGTH = 64;

/**
 * 任意文字列 (日本語 / 英語 mixed) を kebab-case の entity id 候補に正規化する。
 *
 * 動作:
 *   1. 英数字以外を `-` に置換 (Japanese / 記号 / 空白すべて)
 *   2. 連続 `-` を 1 つに圧縮
 *   3. 前後 `-` を削除
 *   4. 全文 lowercase
 *   5. 先頭が英字でない (= 空 or 数字始まり) なら `entity-` prefix を付ける
 *   6. 64 字を超えたら truncate (truncate 後の末尾 `-` も除去)
 *
 * 日本語のまま入力された場合は全部 `-` に変換されてしまうので、ほぼ確実に
 * 空文字 → fallback prefix される。AI suggestion 失敗時にユーザーが手入力で
 * 直す前提の最低限の候補生成。
 */
export function slugifyToEntityId(input: string, fallbackPrefix = "entity"): string {
  if (typeof input !== "string") return generateFallbackEntityId(fallbackPrefix);
  const lowered = input.toLowerCase();
  const replaced = lowered.replace(/[^a-z0-9]+/g, "-");
  const trimmed = replaced.replace(/^-+|-+$/g, "");
  if (trimmed.length === 0) return generateFallbackEntityId(fallbackPrefix);
  // 先頭が数字なら prefix を付ける (EntityId pattern: ^[a-z]...)
  const prefixed = /^[a-z]/.test(trimmed) ? trimmed : `${fallbackPrefix}-${trimmed}`;
  if (prefixed.length <= MAX_ENTITY_ID_LENGTH) return prefixed;
  // truncate 後の末尾 `-` を削除
  return prefixed.slice(0, MAX_ENTITY_ID_LENGTH).replace(/-+$/g, "");
}

/**
 * baseId が existingIds と衝突する場合、`-2`, `-3`, ... の suffix を付与して
 * 一意になる候補を返す。衝突しない場合は baseId をそのまま返す。
 *
 * 64 字を超える場合は baseId 部分を truncate して suffix を付ける。
 */
export function suggestUniqueIdSuffix(
  baseId: string,
  existingIds: readonly string[],
): string {
  const set = new Set(existingIds);
  if (!set.has(baseId)) return baseId;
  for (let n = 2; n <= 9999; n++) {
    const suffix = `-${n}`;
    const maxBaseLen = MAX_ENTITY_ID_LENGTH - suffix.length;
    const base = baseId.length > maxBaseLen
      ? baseId.slice(0, maxBaseLen).replace(/-+$/g, "")
      : baseId;
    const candidate = `${base}${suffix}`;
    if (!set.has(candidate)) return candidate;
  }
  // 衝突が 9999 件超 → baseId 由来 prefix + UUID8 桁の semantic fallback
  // (N-2: baseId と意味的に無関係な "entity-xxx" 化を防ぐ)。
  // 理論上ほぼ起きないが、起きた場合も diff readability を保つ。
  // baseId の先頭 8 字 + `-` + hash 8 字 = 17 字に圧縮し、64 字制約内に収める。
  const semanticPrefix = baseId.slice(0, 8).replace(/-+$/g, "") || "entity";
  return generateFallbackEntityId(semanticPrefix);
}

/**
 * 既存 entity の id から duplicate 用の kebab-case id を生成する (RFC #1284 / #1299 I-7 Round 2 F-2 / Round 3 G-1)。
 *
 * 形式: `<srcId>-copy[-<2..>]`
 *
 * 7 entity (Screen / Table / ProcessFlow / Sequence / View / ViewDefinition / PageLayout)
 * の duplicate / copy-paste 経路で使用する canonical pattern。Phase A で `assertEntityId`
 * strict 化された後、UUID 形式の id を流すと handler が reject するため、必ず kebab-case の
 * 派生 id を生成する必要がある。
 *
 * 動作:
 *   - 第 1 候補: `<srcId>-copy`
 *   - 第 1 候補が `existingIds` と衝突する場合: `<srcId>-copy-2`, `<srcId>-copy-3`, ...
 *   - srcId 長 + suffix が 64 字を超える場合は srcId 末尾を切り詰めて 64 字制約に収める。
 *   - 末尾の `-` は切り詰め後に除去 (連続ハイフン回避)。
 *
 * Round 3 G-1 (Antigravity + Codex M-R2-1):
 *   - Date.now() 採番は同一 ms 内連続複製で衝突する + 元 ID 46+ 字で 65 字超 (schema reject)。
 *   - 既存 id 集合を渡して suffix collision avoidance する設計に変更。
 *
 * Codex review M-2 で指摘された 6 entity duplicate 経路の UUID-id surface bug を、
 * 1 関数に集約することで再発防止する。
 */
export function makeDuplicatedEntityId(
  srcId: string,
  existingIds: ReadonlySet<string> | readonly string[] = [],
): string {
  const set: ReadonlySet<string> = existingIds instanceof Set
    ? existingIds
    : new Set(existingIds);

  // base = srcId を 64 - "-copy" 長 (= 59) 以内に切り詰めて末尾 hyphen を除去
  const baseSuffix = "-copy";
  const maxBaseLen = MAX_ENTITY_ID_LENGTH - baseSuffix.length;
  const baseFromSrc = srcId.length > maxBaseLen
    ? srcId.slice(0, maxBaseLen).replace(/-+$/g, "")
    : srcId;
  const firstCandidate = `${baseFromSrc}${baseSuffix}`;
  if (!set.has(firstCandidate)) return firstCandidate;

  // 衝突時は `-2`, `-3`, ... を付与。各 n に対して `-copy-<n>` を確保するため maxBaseLen を再計算
  for (let n = 2; n <= 9999; n++) {
    const numSuffix = `-copy-${n}`;
    const maxBaseLenN = MAX_ENTITY_ID_LENGTH - numSuffix.length;
    const baseN = srcId.length > maxBaseLenN
      ? srcId.slice(0, maxBaseLenN).replace(/-+$/g, "")
      : srcId;
    const candidate = `${baseN}${numSuffix}`;
    if (!set.has(candidate)) return candidate;
  }

  // 9999 件超の衝突 (理論上ほぼ起きない) は semantic fallback で diff readability を保つ
  const semanticPrefix = srcId.slice(0, 8).replace(/-+$/g, "") || "entity";
  return generateFallbackEntityId(`${semanticPrefix}-copy`);
}

/**
 * `<prefix>-<8桁>` 形式の kebab-case fallback id を生成する。
 * 名前が決まっていない programmatic create 経路 (mcpBridge / duplicate 等) で使う。
 */
export function generateFallbackEntityId(prefix: string): string {
  // prefix を kebab-case に正規化 (英字 + 数字 + ハイフンのみ)
  const cleanedPrefix = prefix.toLowerCase().replace(/[^a-z0-9-]/g, "").replace(/^-+|-+$/g, "") || "entity";
  // generateUUID は "xxxxxxxx-xxxx-..." 形式、先頭 8 文字を取る (16 進数 = a-f0-9、entity id 形式と互換)
  const shortHash = generateUUID().slice(0, 8);
  return `${cleanedPrefix}-${shortHash}`;
}

// ── AI 提案 (Codex 経由) ───────────────────────────────────────────────────────

const AI_SUGGESTION_TIMEOUT_MS = 30_000;

export interface RequestAiSuggestedEntityIdOptions {
  /** 提案元の論理名 (Japanese) */
  name: string;
  /** entity 種別ラベル (例: "画面", "テーブル定義", "処理フロー") — AI prompt に含める */
  entityLabel: string;
  /** 既存 id 配列 — AI に重複回避を依頼する */
  existingIds?: readonly string[];
  /** Codex client (test 注入用) */
  client?: CodexBrowserClient;
  /** タイムアウト ms */
  timeoutMs?: number;
}

/**
 * Codex 経由で name から kebab-case entity id を提案させる。
 *
 * 動作:
 *   1. Codex thread.start + turn.start で短い prompt を送る
 *   2. turn/completed まで notification を待つ
 *   3. 応答 text から kebab-case 候補を抽出 + validate
 *   4. existingIds と衝突する場合は `suggestUniqueIdSuffix` で suffix を付ける
 *   5. AI 応答が EntityId 形式に合致しない場合は throw (caller が fallback 処理)
 *
 * Codex 未ログイン / network エラー時は throw — caller (EntityIdInput) が UI で error 表示し、
 * 手入力 fallback を案内する。
 */
export async function requestAiSuggestedEntityId(
  opts: RequestAiSuggestedEntityIdOptions,
): Promise<string> {
  const {
    name,
    entityLabel,
    existingIds = [],
    client = defaultCodexClient,
    timeoutMs = AI_SUGGESTION_TIMEOUT_MS,
  } = opts;

  const trimmedName = name.trim();
  if (!trimmedName) throw new Error("提案元の名前が空です");

  const threadResponse = await client.thread.start({
    ephemeral: true,
    experimentalRawEvents: false,
    persistExtendedHistory: false,
    baseInstructions: [
      "You generate short kebab-case English identifiers for Harmony business entities.",
      "Reply with ONLY the identifier (no quotes, no Markdown, no commentary).",
      // Length / pattern は schema common.v3#EntityId と single source of truth で揃える (S-2)。
      `Format rules: lowercase letters (a-z), digits (0-9), and hyphens; must start with a letter; max ${MAX_ENTITY_ID_LENGTH} characters; prefer 1-3 words and under 32 characters; must match /^[a-z][a-z0-9]*(-[a-z0-9]+)*$/.`,
    ].join("\n"),
  });
  const threadId = readThreadId(threadResponse);

  const completion = waitForAgentText(client, threadId, timeoutMs);

  try {
    await client.turn.start({
      threadId,
      input: [{
        type: "text",
        text: buildAiSuggestionPrompt(trimmedName, entityLabel, existingIds),
        text_elements: [],
      }],
    });
  } catch (err) {
    completion.cancel();
    throw err;
  }

  const rawText = await completion.promise;
  const candidate = extractEntityIdCandidate(rawText);
  if (!candidate) {
    throw new Error(`AI 提案結果から有効な ID 候補を抽出できませんでした: "${rawText}"`);
  }
  // 衝突回避は caller 側に委ねるか、ここで自動 suffix 付与するか — UX 上は提案候補が
  // 衝突する場合 caller (EntityIdInput) で「適用」ボタン経由のため、ここでは raw candidate を返す。
  // ただし、AI が衝突を考慮しなかった場合の最低限の補正として suffix 付与は便利なので有効化する。
  return suggestUniqueIdSuffix(candidate, existingIds);
}

function buildAiSuggestionPrompt(
  name: string,
  entityLabel: string,
  existingIds: readonly string[],
): string {
  const conflictNote = existingIds.length > 0
    ? `\n\nAvoid these existing ids (case-sensitive):\n${existingIds.slice(0, 50).map((id) => `- ${id}`).join("\n")}`
    : "";
  return [
    `Suggest a kebab-case English identifier for the following Japanese ${entityLabel} name.`,
    "",
    `Name: ${name}`,
    "",
    "Examples (for reference):",
    "  本日売上 → today-sales",
    "  顧客マスタ → customer-master",
    "  月次集計バッチ → monthly-aggregation",
    "  ログイン画面 → login",
    "",
    "Reply with ONLY the identifier — no quotes, no period, no explanation.",
    conflictNote,
  ].join("\n");
}

function extractEntityIdCandidate(text: string): string | null {
  if (typeof text !== "string") return null;
  // 改行 / コードフェンス / quote を剥がし、最初に出現する EntityId 形式の token を取り出す
  const stripped = text
    .replace(/```[a-z]*\n?/gi, "")
    .replace(/```/g, "")
    .replace(/[`"'`]/g, "")
    .trim();
  // 行ごとに走査して、最初に EntityId pattern に合う行 / token を返す
  // `.filter(Boolean)` だと TypeScript の制御フロー分析が `never` に絞り込んでしまうため、
  // 明示的な type predicate で string narrowing する。
  const lines = stripped
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l): l is string => l.length > 0);
  for (const line of lines) {
    // 行全体が EntityId か? (note: `isValidEntityId` の `s is string` predicate に narrow
    // されると TS 5.x が false branch を `never` 推論するため、predicate 結果を local 変数に
    // 受けて narrow 拡張を遮断する)
    const lineIsValid = isValidEntityId(line);
    if (lineIsValid) return line;
    // 行内の最初の kebab-case token を抽出
    const match = (line as string).match(/[a-z][a-z0-9]*(?:-[a-z0-9]+)*/);
    if (match && isValidEntityId(match[0])) return match[0];
  }
  return null;
}

function readThreadId(response: unknown): string {
  const r = response as { thread?: { id?: unknown } };
  if (typeof r.thread?.id === "string" && r.thread.id) return r.thread.id;
  throw new Error("Codex thread.start の応答から thread.id を取得できませんでした");
}

function waitForAgentText(
  client: CodexBrowserClient,
  threadId: string,
  timeoutMs: number,
): { promise: Promise<string>; cancel: () => void } {
  let deltaText = "";
  let completedText = "";
  let unsubscribe: (() => void) | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe?.();
    unsubscribe = null;
  };

  const promise = new Promise<string>((resolve, reject) => {
    timer = setTimeout(() => {
      cleanup();
      reject(new Error("AI 提案がタイムアウトしました"));
    }, timeoutMs);

    unsubscribe = client.subscribeNotification((n: CodexNotification) => {
      const params = n.params as Record<string, unknown>;
      if (params.threadId !== threadId) return;

      if (n.method === "item/agentMessage/delta" && typeof params.delta === "string") {
        deltaText += params.delta;
        return;
      }

      if (n.method === "item/completed") {
        const item = params.item as { type?: unknown; text?: unknown } | undefined;
        if (item?.type === "agentMessage" && typeof item.text === "string") {
          completedText = item.text;
        }
        return;
      }

      if (n.method === "turn/completed") {
        const turn = params.turn as { status?: unknown; error?: { message?: string } | null } | undefined;
        cleanup();
        if (turn?.status === "failed") {
          reject(new Error(turn.error?.message ?? "AI 提案に失敗しました"));
          return;
        }
        const text = (completedText || deltaText).trim();
        if (!text) {
          reject(new Error("AI 提案結果が空です"));
          return;
        }
        resolve(text);
      }
    });
  });

  return {
    promise,
    cancel: () => {
      cleanup();
    },
  };
}
