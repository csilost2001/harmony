/**
 * カラム・項目の入力補助: 表示名 (日本語) から、物理名・型・長さ・NOT NULL を提案する。
 *
 * 物理名の決め方 (上にあるものを優先):
 *   1. このワークスペースで、同じ表示名の列が既にあれば、その物理名 (いちばん多く使われているもの)
 *   2. 表示名を、同じワークスペースの列の表示名の並び + 組み込みの辞書で、長い一致から区切って英単語にする
 *   3. 英数字だけの表示名は、規約の表記 (snake_case など) に整える
 * 辞書に無い言葉が残るときは「決められなかった」として物理名は出さない (間違った名前を入れるより、空のほうがよい)。
 *
 * 型の決め方は、表示名の末尾・含まれる言葉 (金額・日付・フラグ・コードなど) による規則。
 */

export type NamingConvention = "snake_case" | "camelCase" | "PascalCase" | "UPPER_SNAKE_CASE" | "kebab-case";

/** 組み込みの辞書: 業務の設計書によく出る言葉。長い言葉を優先して区切る。 */
export const BUILTIN_TERMS: Record<string, string> = {
  // 人・組織
  顧客: "customer", お客様: "customer", 会員: "member", 利用者: "user", ユーザー: "user", ユーザ: "user", 社員: "employee", 従業員: "employee",
  担当者: "person_in_charge", 担当: "assignee", 管理者: "admin", 取引先: "partner", 得意先: "customer", 仕入先: "supplier", 仕入: "purchase",
  部門: "department", 部署: "department", 会社: "company", 企業: "company", 店舗: "store", 拠点: "site", 支店: "branch", 倉庫: "warehouse",
  承認者: "approver", 申請者: "applicant", 作成者: "creator", 更新者: "updater", 登録者: "registrant",
  // 取引・商品
  注文: "order", 受注: "sales_order", 発注: "purchase_order", 出荷: "shipment", 配送: "delivery", 配達: "delivery", 納品: "delivery_note", 請求: "invoice", 入金: "payment_received", 支払: "payment", 決済: "payment",
  見積: "estimate", 契約: "contract", 申請: "application", 予約: "reservation", 取引: "transaction", 返品: "return", 在庫: "stock", 商品: "product", 製品: "product", 品目: "item", 品番: "item_code",
  明細: "detail", 伝票: "slip", 帳票: "report", 履歴: "history", 一覧: "list", カート: "cart", 配送先: "shipping_address", 送料: "shipping_fee",
  // 金額・数
  金額: "amount", 単価: "unit_price", 価格: "price", 料金: "fee", 税込: "tax_included", 税抜: "tax_excluded", 消費税: "consumption_tax", 税率: "tax_rate", 税: "tax",
  合計: "total", 小計: "subtotal", 総額: "total_amount", 残高: "balance", 割引: "discount", 数量: "quantity", 件数: "count", 回数: "times", 個数: "count", 日数: "days", 率: "rate", 割合: "ratio", 比率: "ratio", 通貨: "currency", ポイント: "point",
  // 属性
  名称: "name", 氏名: "full_name", 名前: "name", 姓: "last_name", 名: "first_name", カナ: "kana", フリガナ: "kana", ふりがな: "kana", 住所: "address", 郵便番号: "postal_code", 都道府県: "prefecture", 市区町村: "city",
  電話番号: "phone", 電話: "phone", メールアドレス: "email", メール: "email", 生年月日: "birth_date", 年齢: "age", 性別: "gender", 国籍: "nationality", 役職: "position", 備考: "remarks", 説明: "description", 内容: "content", 理由: "reason", 件名: "subject", 本文: "body", メモ: "memo", コメント: "comment", タイトル: "title",
  // 識別・分類
  コード: "code", 番号: "number", 区分: "type", 種別: "type", 種類: "kind", 分類: "category", カテゴリ: "category", 状態: "status", ステータス: "status", 優先度: "priority", 順序: "sort_order", 表示順: "sort_order", 順: "order",
  // 日時
  作成日時: "created_at", 更新日時: "updated_at", 削除日時: "deleted_at", 登録日時: "registered_at", 日時: "datetime", 年月日: "date", 日付: "date", 期日: "due_date", 期限: "deadline", 開始日: "start_date", 終了日: "end_date", 有効期限: "expiry_date",
  開始: "start", 終了: "end", 作成日: "created_date", 更新日: "updated_date", 登録日: "registered_date", 発生日: "occurred_date", 締日: "closing_date", 支払日: "payment_date", 納期: "delivery_date", 時刻: "time", 時間: "time", 期間: "period", 年度: "fiscal_year", 年: "year", 月: "month", 日: "day",
  // フラグ・その他
  フラグ: "flag", 有効: "active", 無効: "inactive", 削除: "deleted", 公開: "public", 必須: "required", 有無: "exists", 可否: "allowed", 要否: "required",
  ID: "id", ＩＤ: "id", パスワード: "password", トークン: "token", 画像: "image", ファイル: "file", 添付: "attachment", URL: "url", バージョン: "version", 版: "version", 親: "parent", 子: "child", 元: "source", 先: "destination", 前: "previous", 後: "next", 最大: "max", 最小: "min", 平均: "average", 合算: "sum",
  の: "",
};

const SORTED_TERMS = Object.keys(BUILTIN_TERMS).sort((a, b) => b.length - a.length);

/** 英単語の並び (すでに英字) を、規約の表記にして返す。 */
export function applyNamingConvention(words: string[], convention: NamingConvention = "snake_case"): string {
  const ws = words.map((w) => w.toLowerCase()).filter(Boolean);
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  switch (convention) {
    case "camelCase": return ws.map((w, i) => (i === 0 ? w : cap(w))).join("");
    case "PascalCase": return ws.map(cap).join("");
    case "UPPER_SNAKE_CASE": return ws.join("_").toUpperCase();
    case "kebab-case": return ws.join("-");
    default: return ws.join("_");
  }
}

/** 英数字の文字列を、単語に分ける (camelCase / snake_case / kebab-case / 空白区切りを区別しない)。 */
export function splitWords(s: string): string[] {
  return s
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
}

/** 規約 (db の namingConvention) の文字列を、扱える表記に直す。分からなければ snake_case。 */
export function parseNamingConvention(s: string | undefined): NamingConvention {
  const known: NamingConvention[] = ["snake_case", "camelCase", "PascalCase", "UPPER_SNAKE_CASE", "kebab-case"];
  return known.find((k) => k === s) ?? "snake_case";
}

/** ワークスペースの既存の列から作る、表示名 → 物理名・型の索引。 */
export interface TermIndex {
  byDisplay: Map<string, { physicalName: string; count: number; dataType?: string; length?: number; scale?: number; notNull?: boolean }>;
}

interface ColumnLike {
  physicalName: string;
  name: string;
  dataType?: string;
  length?: number;
  scale?: number;
  notNull?: boolean;
}

const PLACEHOLDER_NAME = /^new_column(_\d+)?$/;
const PLACEHOLDER_DISPLAY = "新規カラム";

export function isPlaceholderColumn(c: { physicalName: string; name: string }): boolean {
  return PLACEHOLDER_NAME.test(c.physicalName) || c.physicalName === "" || c.name === PLACEHOLDER_DISPLAY;
}

/** 列の一覧 (複数のテーブルのもの) から、表示名ごとに、いちばん多く使われている物理名を集める。 */
export function buildTermIndex(columnLists: ColumnLike[][]): TermIndex {
  const counts = new Map<string, Map<string, { n: number; col: ColumnLike }>>();
  for (const list of columnLists) {
    for (const c of list) {
      if (!c.name || isPlaceholderColumn(c)) continue;
      const byPhys = counts.get(c.name) ?? new Map();
      const prev = byPhys.get(c.physicalName);
      byPhys.set(c.physicalName, { n: (prev?.n ?? 0) + 1, col: prev?.col ?? c });
      counts.set(c.name, byPhys);
    }
  }
  const byDisplay: TermIndex["byDisplay"] = new Map();
  for (const [display, byPhys] of counts) {
    let best: { n: number; col: ColumnLike } | undefined;
    for (const v of byPhys.values()) if (!best || v.n > best.n) best = v;
    if (!best) continue;
    const total = [...byPhys.values()].reduce((s, v) => s + v.n, 0);
    byDisplay.set(display, {
      physicalName: best.col.physicalName,
      count: total,
      dataType: best.col.dataType,
      length: best.col.length,
      scale: best.col.scale,
      notNull: best.col.notNull,
    });
  }
  return { byDisplay };
}

export interface PhysicalNameSuggestion {
  /** 提案する物理名。決められなければ null */
  name: string | null;
  /** 全部を英語にできたか */
  complete: boolean;
  source: "既存の列" | "辞書" | "英数字";
}

/** 表示名から物理名を提案する。提案できなければ null。 */
export function suggestPhysicalName(display: string, index?: TermIndex, convention: NamingConvention = "snake_case"): PhysicalNameSuggestion | null {
  const text = display.normalize("NFKC").trim();
  if (!text) return null;
  const exact = index?.byDisplay.get(display.trim()) ?? index?.byDisplay.get(text);
  if (exact) return { name: exact.physicalName, complete: true, source: "既存の列" };

  // 英数字 (と記号) だけ
  if (/^[\x20-\x7e]+$/.test(text)) {
    const words = splitWords(text);
    return words.length ? { name: applyNamingConvention(words, convention), complete: true, source: "英数字" } : null;
  }

  // 日本語: 既存の列の表示名 (長いもの優先) + 辞書で区切る
  const known = new Map<string, string>();
  if (index) for (const [d, v] of index.byDisplay) if (d.length >= 2 && d.length <= 8) known.set(d.normalize("NFKC"), v.physicalName);
  const knownSorted = [...known.keys()].sort((a, b) => b.length - a.length);

  const words: string[] = [];
  let usedIndex = false;
  let unresolved = false;
  let i = 0;
  while (i < text.length) {
    const rest = text.slice(i);
    const fromIndex = knownSorted.find((k) => rest.startsWith(k));
    if (fromIndex) {
      words.push(...splitWords(known.get(fromIndex)!));
      usedIndex = true;
      i += fromIndex.length;
      continue;
    }
    const fromDict = SORTED_TERMS.find((k) => rest.startsWith(k));
    if (fromDict) {
      // 「顧客名」のように、語の末尾の「名」は名前 (単独の「名」だけが first_name)
      const en = fromDict === "名" && i > 0 ? "name" : BUILTIN_TERMS[fromDict];
      if (en) words.push(...splitWords(en));
      i += fromDict.length;
      continue;
    }
    if (/[A-Za-z0-9]/.test(rest[0])) {
      const m = rest.match(/^[A-Za-z0-9]+/)!;
      words.push(...splitWords(m[0]));
      i += m[0].length;
      continue;
    }
    // 区切り・記号は読み飛ばす。それ以外 (辞書に無い言葉) は決められない
    if (/[\s・_\-／/（）()]/.test(rest[0])) { i += 1; continue; }
    unresolved = true;
    i += 1;
  }
  if (unresolved || words.length === 0) return { name: null, complete: false, source: usedIndex ? "既存の列" : "辞書" };
  // 同じ単語の連続 (「注文の注文」など) は 1 つにする
  const dedup = words.filter((w, k) => w !== words[k - 1]);
  return { name: applyNamingConvention(dedup, convention), complete: true, source: usedIndex ? "既存の列" : "辞書" };
}

export interface ColumnTypeSuggestion {
  dataType: string;
  length?: number;
  scale?: number;
  notNull?: boolean;
  reason: string;
}

interface Rule {
  test: RegExp;
  out: Omit<ColumnTypeSuggestion, "reason">;
  reason: string;
}

// 上にあるものを優先する
const TYPE_RULES: Rule[] = [
  { test: /(日時|タイムスタンプ|更新日時|作成日時|登録日時)$/, out: { dataType: "TIMESTAMP" }, reason: "「日時」は日時の型" },
  { test: /(時刻)$/, out: { dataType: "TIME" }, reason: "「時刻」は時刻の型" },
  { test: /(生年月日|年月日|日付|期日|期限|開始日|終了日|締日|納期|支払日|発生日|作成日|更新日|登録日|(?<=[^数曜])日$)/, out: { dataType: "DATE" }, reason: "日付を表す言葉" },
  { test: /(フラグ|有無|可否|要否|要不要|^is_|^has_)/, out: { dataType: "BOOLEAN", notNull: true }, reason: "「フラグ」「有無」は真偽値" },
  { test: /(率|割合|比率)$/, out: { dataType: "DECIMAL", length: 5, scale: 2 }, reason: "「率」は小数" },
  { test: /(金額|単価|価格|料金|送料|税額|残高|合計|小計|総額|手数料|割引額|原価|売上|利益)$|^(金額|価格|単価)/, out: { dataType: "DECIMAL", length: 12, scale: 2 }, reason: "金額を表す言葉" },
  { test: /(数量|件数|回数|個数|日数|人数|枚数|在庫数|順序|表示順|順$|[^A-Za-z]数$)/, out: { dataType: "INTEGER" }, reason: "数えるものは整数" },
  { test: /(ID|ＩＤ|Id)$/, out: { dataType: "BIGINT" }, reason: "「ID」は整数のキー" },
  { test: /(メールアドレス|メール|email|Email)/, out: { dataType: "VARCHAR", length: 254 }, reason: "メールアドレスは 254 文字まで" },
  { test: /(電話|FAX|ファックス)/, out: { dataType: "VARCHAR", length: 20 }, reason: "電話番号" },
  { test: /(郵便番号)/, out: { dataType: "VARCHAR", length: 8 }, reason: "郵便番号" },
  { test: /(URL|ＵＲＬ)/, out: { dataType: "VARCHAR", length: 2048 }, reason: "URL" },
  { test: /(パスワード|ハッシュ|トークン)/, out: { dataType: "VARCHAR", length: 255 }, reason: "ハッシュ・トークン" },
  { test: /(備考|説明|コメント|メモ|内容|本文|理由|詳細|摘要)$/, out: { dataType: "TEXT" }, reason: "長い文章" },
  { test: /(住所|所在地)/, out: { dataType: "VARCHAR", length: 200 }, reason: "住所" },
  { test: /(氏名|名称|名前|件名|タイトル|カナ|フリガナ|ふりがな|(?<=.)名$)/, out: { dataType: "VARCHAR", length: 100 }, reason: "名称" },
  { test: /(コード|区分|種別|種類|分類|状態|ステータス|番号|品番)$/, out: { dataType: "VARCHAR", length: 20 }, reason: "コード・区分・番号" },
];

/** 表示名から、型・長さ・NOT NULL を提案する。規則に当たらなければ null。 */
export function suggestColumnType(display: string): ColumnTypeSuggestion | null {
  const text = display.normalize("NFKC").trim();
  if (!text) return null;
  for (const rule of TYPE_RULES) {
    if (rule.test.test(text)) return { ...rule.out, reason: rule.reason };
  }
  return null;
}

export interface ColumnAutofill {
  patch: { physicalName?: string; dataType?: string; length?: number; scale?: number; notNull?: boolean };
  /** 利用者に知らせる文 (何を入れたか) */
  message: string;
}

/**
 * 新しく足したままの列 (物理名が new_column・型が初期値) に表示名が入ったとき、物理名・型・長さを埋める案。
 * すでに利用者が決めた値 (物理名・型) は変えない。埋めるものが無ければ null。
 */
export function planColumnAutofill(
  col: { physicalName: string; dataType?: string; length?: number },
  displayName: string,
  siblings: { physicalName: string }[],
  index?: TermIndex,
  convention: NamingConvention = "snake_case",
): ColumnAutofill | null {
  const display = displayName.trim();
  if (!display || display === PLACEHOLDER_DISPLAY) return null;
  const patch: ColumnAutofill["patch"] = {};
  const notes: string[] = [];

  if (PLACEHOLDER_NAME.test(col.physicalName) || col.physicalName === "") {
    const s = suggestPhysicalName(display, index, convention);
    if (s?.name && !siblings.some((x) => x.physicalName === s.name)) {
      patch.physicalName = s.name;
      notes.push(s.name);
    }
  }

  const typeIsInitial = (col.dataType ?? "VARCHAR") === "VARCHAR" && col.length === undefined;
  if (typeIsInitial) {
    const known = index?.byDisplay.get(display);
    const t = known?.dataType
      ? { dataType: known.dataType, length: known.length, scale: known.scale, notNull: known.notNull }
      : suggestColumnType(display);
    if (t) {
      patch.dataType = t.dataType;
      if (t.length !== undefined) patch.length = t.length;
      if (t.scale !== undefined) patch.scale = t.scale;
      if (t.notNull) patch.notNull = true;
      notes.push(`${t.dataType}${t.length !== undefined ? `(${t.length}${t.scale !== undefined ? `,${t.scale}` : ""})` : ""}`);
    }
  }
  if (notes.length === 0) return null;
  return { patch, message: `「${display}」から ${notes.join("・")} を入れました (Ctrl+Z で元に戻せます)` };
}
