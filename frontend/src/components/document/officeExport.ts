/**
 * 設計書の Word (.docx)・Excel (.xlsx) への書き出し。設計書 (HTML) と同じ内容を、見出し・表のブロックにして、OOXML にする。
 * 図 (SVG)・画面の紙面の見本は含めない (HTML で保存・印刷する)。表紙は、体裁 (document-template.json) から別に作る。
 */
import { blocksToSheets, buildDesignDocument, buildDocx, buildXlsx, DEFAULT_DOCUMENT_TITLE, htmlToBlocks, type DesignDocInput, type DocBlock } from "@harmony/shared";

export const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface OfficeParts { blocks: DocBlock[]; cover: Array<[string, string]>; title: string; header: string; footer: string }

export function officeParts(input: DesignDocInput): OfficeParts {
  const doc = buildDesignDocument(input);
  // 表紙は、体裁から作り直す (HTML の表紙は、画面の見た目の要素が多い)
  const body = doc.html.replace(/<section class="hd-cover"[\s\S]*?<\/section>/, "");
  const t = input.template;
  const docTitle = t?.documentTitle || DEFAULT_DOCUMENT_TITLE;
  const date = (input.generatedAt ?? new Date().toISOString()).slice(0, 10);
  const cover: Array<[string, string]> = [["プロジェクト", input.project.name], ["文書", docTitle], ["版", input.version ?? "-"], ["作成日", date]];
  if (t?.docNumber) cover.push(["文書番号", t.docNumber]);
  if (t?.organization) cover.push(["組織", t.organization]);
  if (t?.author) cover.push(["作成者", t.author]);
  if (t?.classification) cover.push(["区分", t.classification]);
  return {
    blocks: htmlToBlocks(body), cover, title: `${input.project.name}\u3000${docTitle}`,
    header: t?.headerText || `${input.project.name}\u3000${docTitle}`, footer: t?.footerText || [t?.classification, t?.organization].filter(Boolean).join("\u3000"),
  };
}

export const designDocx = (input: DesignDocInput): Uint8Array => {
  const p = officeParts(input);
  return buildDocx(p.blocks, { title: p.title, header: p.header, footer: p.footer, cover: p.cover });
};
export const designXlsx = (input: DesignDocInput): Uint8Array => {
  const p = officeParts(input);
  return buildXlsx(blocksToSheets(p.blocks, p.cover));
};

/** ファイル名に使える、英数字のプロジェクト ID (日本語のファイル名は、ブラウザによって無視される) */
export const officeFileStem = (input: DesignDocInput): string => `${(input.project.id ?? "").replace(/[^A-Za-z0-9_-]+/g, "") || "harmony"}-design-document`;
