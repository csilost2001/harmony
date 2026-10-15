/**
 * 設計書の体裁 (社内様式) と、改訂履歴。設計の原本ではなく運用の設定 (`<データフォルダ>/document-template.json`)。
 * 形の検証はここ (`parseDocTemplate`)。読み込みのたびに検証し、壊れた項目は捨てて理由を返す (手で書き換えた 1 行の誤りで、設計書全体を止めない)。
 * 仕様: docs/spec/integration-ops.md
 */
export interface Revision {
  /** 版 (例: 1.2.0) */
  version: string;
  /** 日付 (YYYY-MM-DD) */
  date: string;
  /** 変更者 */
  author?: string;
  /** 変更の内容 */
  summary: string;
}

export interface DocTemplate {
  version: 1;
  /** 文書名 (既定: 基本設計書・処理設計書) */
  documentTitle?: string;
  /** 表紙の副題 */
  subtitle?: string;
  /** 文書番号 */
  docNumber?: string;
  /** 組織名 */
  organization?: string;
  /** 作成者 */
  author?: string;
  /** 秘区分 (例: 社外秘) */
  classification?: string;
  /** 表紙の押印欄の見出し (既定: 承認 / 審査 / 作成。空の配列で押印欄を出さない) */
  stamps?: string[];
  /** ヘッダー・フッターの文字 (Word の書き出し) */
  headerText?: string;
  footerText?: string;
  /** 強調の色 (#rrggbb)。表紙の上の線と章の見出しの下線 */
  accentColor?: string;
  /** 設計書に載せない章 (目次の id。例: `crud` `messages`)。章番号は詰めて振り直す */
  excludeChapters: string[];
  /** 改訂履歴 (新しいものが後ろ) */
  revisions: Revision[];
}

export const DEFAULT_DOCUMENT_TITLE = "基本設計書・処理設計書";
export const DEFAULT_STAMPS = ["承認", "審査", "作成"];
export const MAX_REVISIONS = 500;

export const emptyDocTemplate = (): DocTemplate => ({ version: 1, excludeChapters: [], revisions: [] });

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const CHAPTER_ID_RE = /^[a-z][a-z0-9-]{0,63}$/;

export function isIsoDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export interface ParsedDocTemplate { template: DocTemplate; problems: string[] }

/** 検証して整える。読めない項目は捨てて、理由を返す */
export function parseDocTemplate(raw: unknown): ParsedDocTemplate {
  const problems: string[] = [];
  const t = emptyDocTemplate();
  if (raw === undefined || raw === null) return { template: t, problems };
  if (!isRecord(raw)) return { template: t, problems: ["document-template.json の形が正しくありません (オブジェクトではありません)"] };
  const text = (key: keyof DocTemplate, max: number, label: string) => {
    const v = raw[key];
    if (v === undefined || v === null || v === "") return;
    if (typeof v !== "string") { problems.push(`${label}は文字列で書いてください`); return; }
    if (v.length > max) { problems.push(`${label}が長すぎます (${max} 文字まで)`); return; }
    (t as unknown as Record<string, unknown>)[key] = v;
  };
  text("documentTitle", 100, "文書名"); text("subtitle", 200, "副題"); text("docNumber", 60, "文書番号"); text("organization", 100, "組織名");
  text("author", 100, "作成者"); text("classification", 40, "秘区分"); text("headerText", 200, "ヘッダー"); text("footerText", 200, "フッター");
  if (raw.accentColor !== undefined && raw.accentColor !== null && raw.accentColor !== "") {
    if (typeof raw.accentColor === "string" && COLOR_RE.test(raw.accentColor)) t.accentColor = raw.accentColor.toLowerCase();
    else problems.push("強調の色は #rrggbb の形で書いてください");
  }
  if (raw.stamps !== undefined) {
    if (Array.isArray(raw.stamps) && raw.stamps.length <= 6 && raw.stamps.every((s) => typeof s === "string" && s.length <= 20)) t.stamps = raw.stamps as string[];
    else problems.push("押印欄の見出しは、20 文字以内の文字列を 6 つまでで書いてください");
  }
  if (raw.excludeChapters !== undefined) {
    if (Array.isArray(raw.excludeChapters)) {
      const ok = raw.excludeChapters.filter((c): c is string => typeof c === "string" && CHAPTER_ID_RE.test(c));
      if (ok.length !== raw.excludeChapters.length) problems.push("載せない章の指定に、読めないものがあります (捨てました)");
      t.excludeChapters = [...new Set(ok)];
    } else problems.push("載せない章は、章の id の配列で書いてください");
  }
  if (raw.revisions !== undefined) {
    if (!Array.isArray(raw.revisions)) problems.push("改訂履歴は配列で書いてください");
    else {
      raw.revisions.slice(0, MAX_REVISIONS).forEach((r, i) => {
        if (!isRecord(r) || typeof r.version !== "string" || !r.version.trim() || r.version.length > 40) { problems.push(`改訂履歴の ${i + 1} 件目: 版を書いてください (40 文字まで)`); return; }
        if (typeof r.date !== "string" || !isIsoDate(r.date)) { problems.push(`改訂履歴の ${i + 1} 件目: 日付は YYYY-MM-DD で書いてください`); return; }
        if (typeof r.summary !== "string" || !r.summary.trim() || r.summary.length > 2000) { problems.push(`改訂履歴の ${i + 1} 件目: 変更の内容を書いてください (2000 文字まで)`); return; }
        if (r.author !== undefined && r.author !== "" && (typeof r.author !== "string" || r.author.length > 100)) { problems.push(`改訂履歴の ${i + 1} 件目: 変更者が正しくありません`); return; }
        t.revisions.push({ version: r.version.trim(), date: r.date, summary: r.summary.trim(), ...(typeof r.author === "string" && r.author.trim() ? { author: r.author.trim() } : {}) });
      });
      if (raw.revisions.length > MAX_REVISIONS) problems.push(`改訂履歴が多すぎます (${MAX_REVISIONS} 件まで)`);
    }
  }
  return { template: t, problems };
}

/** 章番号 (数字だけのもの) を、載せる章だけで 1 から振り直す。付録などの文字の章番号は、そのまま */
export function renumberChapters(html: string): string {
  let n = 0;
  return html.replace(/(<section class="hd-section hd-level-1"[^>]*><h2 class="hd-title"><span class="hd-chapter">)(\d+)(<\/span>)/g, (_m, a: string, _d: string, c: string) => `${a}${++n}${c}`);
}
