import { useEffect, useState } from "react";
import { subscribeAnnouncements } from "../../utils/announce";

/**
 * スクリーンリーダー用の、見えない読み上げ領域 (続編 第 10 弾 #187)。announce() の知らせを、控えめに (polite) 伝える。
 * 同じ文が続いても読み直されるよう、文の末尾の見えない印を交互に変える。
 */
export function LiveAnnouncer() {
  const [text, setText] = useState("");
  useEffect(() => {
    let flip = false;
    return subscribeAnnouncements((t) => { flip = !flip; setText(flip ? t : `${t}\u200b`); });
  }, []);
  return <div className="an-sr" role="status" aria-live="polite" aria-atomic="true" data-testid="live-announcer">{text}</div>;
}
