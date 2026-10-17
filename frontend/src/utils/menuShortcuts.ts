/**
 * メニュー項目に併記するショートカットの台帳 (UI 改善提案 続編 第 10 弾 #197)。メニューの項目 → キー。
 * キーは、ショートカット一覧 (utils/shortcuts.ts の SHORTCUT_GROUPS) に載っているものだけ (試験が、台帳とヘルプの食い違いを見張る)。
 * 実際のキー処理は、各フックにある。ここは表示だけ。
 */
export const MENU_SHORTCUTS = {
  "tab.close": "Ctrl+W",
  "tab.moveLeft": "Ctrl+Shift+PageUp",
  "tab.moveRight": "Ctrl+Shift+PageDown",
  "tab.reopen": "Ctrl+Alt+T",
  "list.copy": "Ctrl+C",
  "list.cut": "Ctrl+X",
  "list.paste": "Ctrl+V",
  "list.duplicate": "Ctrl+D",
  "list.delete": "Delete",
  "list.moveUp": "Alt+↑",
  "list.moveDown": "Alt+↓",
  "editor.save": "Ctrl+S",
  "editor.undo": "Ctrl+Z",
  "editor.find": "Ctrl+F",
  "global.quickOpen": "Ctrl+K",
  "global.commandPalette": "Ctrl+Shift+P",
  "global.replace": "Ctrl+Shift+H",
} as const;

export type MenuShortcutId = keyof typeof MENU_SHORTCUTS;
export const menuShortcut = (id: MenuShortcutId): string => MENU_SHORTCUTS[id];
