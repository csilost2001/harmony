// harmony-externals/react-dom-client.mjs — 外部 component 用 react-dom/client shim (#1409 P-1)
//
// React 19 では createRoot / hydrateRoot は "react-dom/client" に存在する。
// host が main.tsx で window.__HARMONY_SHARED_DEPS__["react-dom/client"] に設置する。
// 外部 component が自前で root を作ることは稀だが、import 解決失敗を避けるため shim を用意する。
const m = (window.__HARMONY_SHARED_DEPS__ ?? {})["react-dom/client"];
if (!m) {
  throw new Error(
    "[harmony-externals] react-dom/client bridge 未設置。main.tsx の bridge 設置を確認してください。",
  );
}
export default m;
export const { createRoot, hydrateRoot, version } = m;
