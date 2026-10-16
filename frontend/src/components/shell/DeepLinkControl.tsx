/**
 * 工程・項目・カラム・部品・マーカーへ直接飛べる URL (UI 改善提案 第 5 弾 #95)。
 * - 開いた URL の `#step=s3` などの要素を、画面が読み込まれたら探して、スクロール・フォーカス・強調する (最大 8 秒、要素が出るのを待つ)
 * - Ctrl+Alt+L: フォーカス / 選択のある要素へのリンクをコピーする (レビューや AI への指示に貼れる)
 */
import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { DEEP_LINK_LABELS, buildDeepLinkUrl, findDeepLinkElement, linkFromKey, parseDeepLink, type DeepLink } from "../../utils/deepLink";
import { focusIssue } from "../../utils/pageIssues";
import { showToast } from "../../utils/toast";
import { writeClipboardText } from "../../utils/tableExport";
import { getActiveTabId, setActiveTab } from "../../store/tabStore";
import { nextEditSpot, recordEdit } from "../../store/lastEdit";

/** 起動時の URL の末尾 (画面の切り替えで URL が書き換わっても残す) */
let pending: DeepLink | null = typeof window !== "undefined" ? parseDeepLink(window.location.hash) : null;

/** コピーするリンクの元になる要素: フォーカスのある要素 → 選択中の要素 */
function currentTarget(): HTMLElement | null {
  const active = document.activeElement as HTMLElement | null;
  const near = active?.closest<HTMLElement>("[data-deeplink]");
  if (near) return near;
  return document.querySelector<HTMLElement>("#app-main [data-deeplink].selected, #app-main [data-deeplink].is-selected, #app-main [data-deeplink][aria-selected='true'], #app-main .step-card.selected [data-deeplink]") ?? document.querySelector<HTMLElement>("#app-main .selected [data-deeplink]");
}

export function DeepLinkControl() {
  const location = useLocation();

  // 入力した場所を覚える (最後に編集した場所へ戻るため。続編 第 8 弾 #158)。Ctrl+Alt+Backspace で戻る
  useEffect(() => {
    const onEdit = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (!t?.closest || !t.closest("#app-main")) return;
      const key = t.closest<HTMLElement>("[data-deeplink]")?.getAttribute("data-deeplink");
      if (key && linkFromKey(key)) recordEdit(getActiveTabId(), key);
    };
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && e.key === "Backspace")) return;
      e.preventDefault();
      const spot = nextEditSpot();
      const link = spot ? linkFromKey(spot.key) : null;
      if (!spot || !link) { showToast("まだ、編集した場所がありません (入力すると、その場所を覚えます)", "info"); return; }
      if (spot.tabId !== getActiveTabId()) {
        pending = link; // 切り替え後の画面で探す
        setActiveTab(spot.tabId);
        return;
      }
      const root = document.getElementById("app-main");
      const el = root ? findDeepLinkElement(root, link) : null;
      if (el) focusIssue(el);
      else showToast(`${DEEP_LINK_LABELS[link.kind]}「${link.id}」は、見つかりませんでした (削除された・畳まれている可能性があります)`, "info");
    };
    document.addEventListener("input", onEdit, true);
    document.addEventListener("change", onEdit, true);
    window.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("input", onEdit, true); document.removeEventListener("change", onEdit, true); window.removeEventListener("keydown", onKey); };
  }, []);

  // 開いたときと、画面の中でリンクの末尾が変わったとき
  useEffect(() => {
    const fromHash = parseDeepLink(location.hash);
    if (fromHash) pending = fromHash;
  }, [location.hash]);

  useEffect(() => {
    if (!pending) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries++;
      const link = pending;
      if (!link) { clearInterval(timer); return; }
      const root = document.getElementById("app-main");
      const el = root ? findDeepLinkElement(root, link) : null;
      if (el) { focusIssue(el); pending = null; clearInterval(timer); }
      else if (tries >= 32) { pending = null; clearInterval(timer); } // 8 秒待っても出なければ、あきらめる
    }, 250);
    return () => clearInterval(timer);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey && e.altKey && !e.shiftKey && !e.metaKey && (e.key === "l" || e.key === "L"))) return;
      e.preventDefault();
      const el = currentTarget();
      const link = el ? linkFromKey(el.getAttribute("data-deeplink") ?? "") : null;
      if (!link) { showToast("リンクにしたい工程・項目・カラム・部品・マーカーを、先に選んでください (フォーカスを置く)", "info"); return; }
      const url = buildDeepLinkUrl({ origin: window.location.origin, pathname: window.location.pathname, search: window.location.search }, link);
      void writeClipboardText(url).then((ok) => showToast(ok ? `${DEEP_LINK_LABELS[link.kind]}「${link.id}」へのリンクをコピーしました` : "コピーできませんでした (ブラウザがクリップボードを許可していません)", ok ? "info" : "error"));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return null;
}
