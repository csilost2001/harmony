import type { MarkerKind } from "../types/v3";

/** マーカーの種類の名前と、アイコン (Bootstrap Icons)。画面のマーカーのパネル・一覧・ダイアログで共通 */
export const MARKER_KIND_LABELS: Record<MarkerKind, string> = {
  chat: "チャット",
  attention: "注目",
  todo: "TODO",
  question: "質問",
  validator: "バリデーター",
};
export const MARKER_KIND_ICONS: Record<MarkerKind, string> = {
  chat: "bi-chat-left-text",
  attention: "bi-eye",
  todo: "bi-check2-square",
  question: "bi-question-circle",
  validator: "bi-shield-exclamation",
};
