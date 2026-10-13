// redirectGuard が trip した時、画面全体に被せる赤バナー (#750 review S-2)。
// silently block すると見かけ上「画面が固まった」状態でユーザーが原因を理解できない。
export function RedirectGuardBanner({ summary }: { summary: readonly string[] }) {
  return (
    <div style={{
      position: "fixed", top: 0, left: 0, right: 0, zIndex: 9999,
      background: "#b71c1c", color: "var(--hm-on-solid)",
      padding: "12px 16px", fontSize: 13,
      borderBottom: "2px solid color-mix(in srgb, var(--hm-hue-red) 45%, var(--hm-surface))",
      boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
    }}>
      <strong><i className="bi bi-exclamation-octagon-fill" /> リダイレクトループ検出 — 遷移を停止しました</strong>
      <div style={{ marginTop: 4, fontSize: 12, opacity: 0.9 }}>
        サーバ保護のため、これ以降のページ遷移を全てブロックしています。
        ブラウザを手動で再読み込み (F5) してください。
      </div>
      {summary.length > 0 && (
        <details style={{ marginTop: 6, fontSize: 11, fontFamily: "monospace" }}>
          <summary style={{ cursor: "pointer" }}>直近の遷移先 (バグ報告用)</summary>
          <ol style={{ margin: "4px 0 0 16px", padding: 0 }}>
            {summary.map((p, i) => (<li key={i}>{p}</li>))}
          </ol>
        </details>
      )}
    </div>
  );
}
