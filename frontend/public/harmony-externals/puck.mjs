// harmony-externals/puck.mjs — 外部 component 用 @measured/puck shim (#1409 P-1)
//
// host 共有の Puck namespace を re-export。DropZone / Render 等 (slot 連携は P-3 で拡充)。
const m = (window.__HARMONY_SHARED_DEPS__ ?? {})["@measured/puck"];
if (!m) {
  throw new Error(
    "[harmony-externals] @measured/puck bridge 未設置。main.tsx の bridge 設置を確認してください。",
  );
}
export default m;
// @measured/puck の主要 public export を網羅する。
// host 実体に無い名前は undefined になるが named export 宣言は通る (静的 import 解決のため)。
// DropZone は P-3 の slot 連携で必須。
export const {
  DropZone,
  Puck,
  Render,
  FieldLabel,
  usePuck,
  Drawer,
  AutoField,
} = m;
