/**
 * 書き出しの設定の組 (UI 改善提案 続編 第 9 弾 #175)。設計書の「形式」と「載せない章」を、名前をつけて保存して、ワンクリックで出し直す。
 * 保存先は、設計書の体裁 (`<データフォルダ>/document-template.json` の exportPresets) で、プロジェクトの全員が使える。画面に依存しない純関数。
 */
import { MAX_EXPORT_PRESETS, emptyDocTemplate, type DesignDocInput, type ExportFormat, type ExportPreset } from "@harmony/shared";

export const EXPORT_FORMAT_LABELS: Record<ExportFormat, string> = { html: "HTML", docx: "Word", xlsx: "Excel" };

/** 同じ名前があれば置き換え、なければ末尾へ足す。上限を超えるときは足さずに null */
export function upsertPreset(list: readonly ExportPreset[], preset: ExportPreset): ExportPreset[] | null {
  const name = preset.name.trim();
  if (!name || name.length > 40) return null;
  const i = list.findIndex((p) => p.name === name);
  if (i < 0 && list.length >= MAX_EXPORT_PRESETS) return null;
  const next: ExportPreset = { name, format: preset.format, excludeChapters: [...new Set(preset.excludeChapters)] };
  return i < 0 ? [...list, next] : list.map((p, j) => (j === i ? next : p));
}

export function removePreset(list: readonly ExportPreset[], name: string): ExportPreset[] {
  return list.filter((p) => p.name !== name);
}

/** その設定で出すための入力 (載せない章だけ差し替える。体裁・改訂履歴は、いまのものを使う。体裁のファイルは書き換えない) */
export function inputForPreset(input: DesignDocInput, preset: ExportPreset): DesignDocInput {
  return { ...input, template: { ...(input.template ?? emptyDocTemplate()), excludeChapters: [...preset.excludeChapters] } };
}

/** いまの体裁から作る設定 (形式を選んで保存する) */
export function presetFromInput(name: string, format: ExportFormat, input: DesignDocInput): ExportPreset {
  return { name: name.trim(), format, excludeChapters: [...(input.template?.excludeChapters ?? [])] };
}
