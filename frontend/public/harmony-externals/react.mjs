// harmony-externals/react.mjs — 外部 component 用 React shim (#1409 P-1)
//
// host (Harmony frontend) が main.tsx で window.__HARMONY_SHARED_DEPS__ に
// 設置した React namespace を re-export する。これにより外部 component と host が
// 同一 React インスタンスを共有し、二重化 (Invalid hook call 等) を防ぐ。
//
// import map (index.html) で bare specifier "react" → このファイルにマップする。
// host 自身の import は Vite が pre-bundle 段階で具体 path に書き換えるため影響しない。
const m = (window.__HARMONY_SHARED_DEPS__ ?? {})["react"];
if (!m) {
  throw new Error(
    "[harmony-externals] React bridge 未設置 (window.__HARMONY_SHARED_DEPS__['react'])。main.tsx の bridge 設置を確認してください。",
  );
}
export default m;
// React 19 の安定 public surface を網羅する。
// host 実体に存在しない名前は undefined になるが、named export 宣言自体は通るため
// 外部 component の静的 import 解決は成功する (実体は host 19 が供給)。
// 除外: act (test 専用) / unstable_* / experimental_*。
export const {
  // hooks
  useState,
  useEffect,
  useRef,
  useMemo,
  useCallback,
  useContext,
  useReducer,
  useLayoutEffect,
  useId,
  useSyncExternalStore,
  useImperativeHandle,
  useInsertionEffect,
  useTransition,
  useDeferredValue,
  useDebugValue,
  use,
  // element / ref API
  createElement,
  cloneElement,
  isValidElement,
  createRef,
  Children,
  Fragment,
  forwardRef,
  memo,
  createContext,
  lazy,
  Suspense,
  Profiler,
  startTransition,
  // class API
  Component,
  PureComponent,
  StrictMode,
  // misc
  cache,
  version,
} = m;
