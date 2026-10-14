/**
 * コマンドパレット (Ctrl+K の「>」、または検索語に合う操作) の操作の一覧。
 * 設計への移動は quickOpen.ts の候補が受け持つので、ここは「実行する操作」だけ:
 * 保存・元に戻す・タブの操作・お気に入り・配色と表示の設定・各パネルを開く。
 * 保存・元に戻す・やり直しは、各編集画面が持つキー (Ctrl+S / Ctrl+Z / Ctrl+Y) をそのまま送る
 * (画面ごとの保存の処理を、パレット側で持たない)。
 */
import type { TabItem } from "../../store/tabStore";
import { closeOtherTabs, setPinned } from "../../store/tabStore";
import { setAppThemePref } from "../../theme/appTheme";
import { setDisplayPrefs } from "../../theme/displayPrefs";
import { isFavorite, tabFavoriteKey, toggleFavorite } from "../../utils/favorites";
import { requestHeaderPanel, pressShortcut } from "../../utils/headerPanels";
import { clearRecentQuickOpen } from "../../utils/quickOpen";
import { clearToastHistory } from "../../utils/toast";
import { tourForTab } from "../../utils/tours";
import { getSplit, setSplit } from "../../store/splitStore";

export interface PaletteCommand {
  id: string;
  label: string;
  /** 検索に使う別名 (読み・英語) */
  keywords: string[];
  /** Bootstrap Icons */
  icon: string;
  /** 補足 (ショートカットなど) */
  hint?: string;
  run: () => void;
}

export interface CommandContext {
  activeTab: TabItem | null;
  wsId: string | undefined;
}

/** パレットが閉じて、フォーカスが元の場所へ戻ってから実行する (キーは、開いたダイアログの外へ届けたい) */
const afterClose = (fn: () => void) => () => { setTimeout(fn, 0); };

export function buildPaletteCommands(ctx: CommandContext): PaletteCommand[] {
  const { activeTab, wsId } = ctx;
  const out: PaletteCommand[] = [];
  const add = (c: PaletteCommand) => out.push(c);

  // ── いま開いているタブへの操作 ──
  const editable = !!activeTab && !["dashboard", "workspace-list", "design-document"].includes(activeTab.type);
  if (editable) {
    if (activeTab.isDirty) add({ id: "save", label: "保存", keywords: ["ほぞん", "save", "セーブ"], icon: "bi-save", hint: "Ctrl+S", run: afterClose(() => pressShortcut({ key: "s", ctrlKey: true })) });
    add({ id: "undo", label: "元に戻す", keywords: ["もとにもどす", "undo", "アンドゥ"], icon: "bi-arrow-counterclockwise", hint: "Ctrl+Z", run: afterClose(() => pressShortcut({ key: "z", ctrlKey: true })) });
    add({ id: "redo", label: "やり直す", keywords: ["やりなおす", "redo", "リドゥ"], icon: "bi-arrow-clockwise", hint: "Ctrl+Y", run: afterClose(() => pressShortcut({ key: "y", ctrlKey: true })) });
  }
  if (activeTab) {
    add({ id: "tab-close", label: "いまのタブを閉じる", keywords: ["とじる", "close", "タブ"], icon: "bi-x-lg", hint: "Ctrl+W", run: afterClose(() => pressShortcut({ key: "w", ctrlKey: true })) });
    add({ id: "tab-close-others", label: "ほかのタブをすべて閉じる", keywords: ["とじる", "close", "other", "タブ"], icon: "bi-x-circle", run: () => closeOtherTabs(activeTab.id) });
    add({ id: "tab-pin", label: activeTab.isPinned ? "タブのピン留めを解除" : "タブをピン留め", keywords: ["ぴん", "pin", "固定"], icon: activeTab.isPinned ? "bi-pin-angle" : "bi-pin", run: () => setPinned(activeTab.id, !activeTab.isPinned) });
    const favKey = tabFavoriteKey(activeTab);
    if (favKey) {
      const fav = isFavorite(wsId, favKey);
      add({ id: "favorite", label: fav ? "お気に入りから外す" : "お気に入りに追加", keywords: ["おきにいり", "favorite", "star", "ほし", "固定"], icon: fav ? "bi-star-fill" : "bi-star", run: () => { toggleFavorite(wsId, favKey); } });
    }
  }

  // ── 配色・表示 ──
  add({ id: "theme-light", label: "配色: ライト", keywords: ["はいしょく", "theme", "light", "明るい"], icon: "bi-sun", run: () => setAppThemePref("light") });
  add({ id: "theme-dark", label: "配色: ダーク", keywords: ["はいしょく", "theme", "dark", "暗い"], icon: "bi-moon-stars", run: () => setAppThemePref("dark") });
  add({ id: "theme-system", label: "配色: OS の設定に合わせる", keywords: ["はいしょく", "theme", "system", "自動"], icon: "bi-circle-half", run: () => setAppThemePref("system") });
  add({ id: "font-small", label: "文字サイズ: 小", keywords: ["もじ", "font", "size", "フォント"], icon: "bi-type", run: () => setDisplayPrefs({ fontScale: "small" }) });
  add({ id: "font-standard", label: "文字サイズ: 標準", keywords: ["もじ", "font", "size", "フォント"], icon: "bi-type", run: () => setDisplayPrefs({ fontScale: "standard" }) });
  add({ id: "font-large", label: "文字サイズ: 大", keywords: ["もじ", "font", "size", "フォント"], icon: "bi-type", run: () => setDisplayPrefs({ fontScale: "large" }) });
  add({ id: "font-xlarge", label: "文字サイズ: 特大", keywords: ["もじ", "font", "size", "フォント"], icon: "bi-type", run: () => setDisplayPrefs({ fontScale: "xlarge" }) });
  add({ id: "density-compact", label: "密度: コンパクト (表の行を詰める)", keywords: ["みつど", "density", "compact", "余白"], icon: "bi-distribute-vertical", run: () => setDisplayPrefs({ density: "compact" }) });
  add({ id: "density-standard", label: "密度: 標準", keywords: ["みつど", "density", "余白"], icon: "bi-distribute-vertical", run: () => setDisplayPrefs({ density: "standard" }) });
  add({ id: "contrast-high", label: "コントラスト: 高", keywords: ["こんとらすと", "contrast", "high", "見やすい"], icon: "bi-circle-half", run: () => setDisplayPrefs({ contrast: "high" }) });
  add({ id: "contrast-standard", label: "コントラスト: 標準", keywords: ["こんとらすと", "contrast"], icon: "bi-circle-half", run: () => setDisplayPrefs({ contrast: "standard" }) });
  add({ id: "open-display", label: "表示の設定を開く", keywords: ["ひょうじ", "display", "settings", "設定"], icon: "bi-type", run: afterClose(() => requestHeaderPanel("display")) });

  // ── 並べて表示 ──
  if (getSplit(wsId)) add({ id: "split-close", label: "並べて表示 (右側) を閉じる", keywords: ["ならべて", "split", "分割", "右", "とじる"], icon: "bi-layout-sidebar-inset-reverse", run: () => setSplit(wsId, null) });

  // ── 設計全体の操作 ──
  add({ id: "replace", label: "設計全体で検索・置換", keywords: ["けんさく", "ちかん", "replace", "find", "置き換え", "用語", "一括"], icon: "bi-input-cursor-text", hint: "Ctrl+Shift+H", run: afterClose(() => requestHeaderPanel("replace")) });

  // ── パネル・ヘルプ・履歴 ──
  add({ id: "open-notifications", label: "通知の履歴を開く", keywords: ["つうち", "notification", "toast", "履歴", "失敗"], icon: "bi-bell", run: afterClose(() => requestHeaderPanel("notifications")) });
  if (tourForTab(activeTab?.type)) add({ id: "tour", label: "この画面の操作ツアーを始める", keywords: ["つあー", "tour", "ガイド", "使い方", "はじめかた", "help", "ヘルプ"], icon: "bi-signpost-split", run: afterClose(() => requestHeaderPanel("tour")) });
  add({ id: "open-shortcuts", label: "キーボードショートカット一覧を開く", keywords: ["しょーとかっと", "shortcut", "help", "ヘルプ", "キー"], icon: "bi-keyboard", hint: "?", run: afterClose(() => pressShortcut({ key: "?" })) });
  add({ id: "clear-recent", label: "最近開いたものの履歴を消す", keywords: ["さいきん", "recent", "履歴", "clear"], icon: "bi-clock-history", run: () => clearRecentQuickOpen() });
  add({ id: "clear-notifications", label: "通知の履歴をすべて消す", keywords: ["つうち", "notification", "clear", "履歴"], icon: "bi-bell-slash", run: () => clearToastHistory() });
  return out;
}

