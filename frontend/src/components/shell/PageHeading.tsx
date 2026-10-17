/**
 * 画面の見出し (h1) の補い (UI 改善提案 続編 第 10 弾 #186)。スクリーンリーダーで、画面の見出しから画面を巡れるよう、画面ごとに h1 を 1 つにする。
 * 画面が自分で h1 を持つときは、補わない (隠す)。持たない画面だけ、開いているタブの名前を、見えない h1 として出す。
 * 画面は遅れて描かれるので、本文の変化を見張って、そのたびに有無を確かめる (React の状態は使わず、DOM の hidden だけを切り替える)。
 */
import { useEffect, useRef } from "react";
import { useActiveTab } from "../../hooks/useActiveTab";

export function PageHeading() {
  const tab = useActiveTab();
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    const el = ref.current;
    const main = document.getElementById("app-main");
    if (!el || !main) return;
    // 設計の中身 (画面の見本・帳票の紙面・設計書の本文) の見出しは、画面の見出しではない
    const CONTENT = ".sld-paper, .pv-root, .rp-paper, .lv-paper, .hd-doc";
    // 画面の見出し (h1 と、role=heading・aria-level=1 の見出し。エディタのヘッダーなど。本文の外にある場合もあるので、文書全体から探す) が
    // 見えていれば (開いていないタブの中の、隠れたものは数えない)、補わない。最初は隠しておき、見つからないと確かめてから出す
    const sync = () => {
      const own = [...document.querySelectorAll('h1:not(.page-auto-h1), [role="heading"][aria-level="1"]')].some((h) => !h.closest(CONTENT) && (h as HTMLElement).getClientRects().length > 0);
      // 変わるときだけ書く (同じ値でも、属性の書き込みは変化として見張りに届き、きりなく繰り返すため)
      if (el.hidden !== own) el.hidden = own;
    };
    sync();
    // 本文の変化のたびに確かめる (画面の見出しと、一瞬でも、重ならないよう、すぐに)。タブの切り替え (display の変更) も見張る
    const mo = new MutationObserver(sync);
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["style", "hidden"] });
    return () => mo.disconnect();
  }, []);
  return <h1 ref={ref} hidden className="an-sr page-auto-h1" data-testid="page-auto-h1">{tab?.label ?? "Harmony"}</h1>;
}
