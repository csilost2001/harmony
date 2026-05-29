// harmony-externals/react-jsx-runtime.mjs — 外部 component 用 react/jsx-runtime shim (#1409 P-1)
//
// jsx transform (automatic runtime) が import する "react/jsx-runtime" を host 共有にマップ。
const m = (window.__HARMONY_SHARED_DEPS__ ?? {})["react/jsx-runtime"];
if (!m) {
  throw new Error(
    "[harmony-externals] react/jsx-runtime bridge 未設置。main.tsx の bridge 設置を確認してください。",
  );
}
export const { jsx, jsxs, Fragment } = m;
export default m;
