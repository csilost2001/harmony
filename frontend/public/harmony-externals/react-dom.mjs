// harmony-externals/react-dom.mjs — 外部 component 用 react-dom shim (#1409 P-1)
//
// host 共有の react-dom namespace を re-export。createPortal / flushSync 等。
const m = (window.__HARMONY_SHARED_DEPS__ ?? {})["react-dom"];
if (!m) {
  throw new Error(
    "[harmony-externals] react-dom bridge 未設置。main.tsx の bridge 設置を確認してください。",
  );
}
export default m;
// react-dom の安定 public surface を網羅する。
// host 実体に無い名前は undefined になるが named export 宣言は通る (静的 import 解決のため)。
export const {
  createPortal,
  flushSync,
  useFormStatus,
  version,
  preload,
  preconnect,
  prefetchDNS,
  preinit,
  preinitModule,
  preloadModule,
  requestFormReset,
} = m;
