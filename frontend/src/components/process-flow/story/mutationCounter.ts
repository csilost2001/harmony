/**
 * 「流れ」表示で直した回数 (画面全体で通し番号)。消したあとの「元に戻す」が、そのあとの別の操作を巻き込まないかの確かめに使う。
 * 画面の状態ではなく、操作の通し番号なので、画面の外に持つ。
 */
let count = 0;
export const bumpMutations = (): number => ++count;
export const currentMutations = (): number => count;
