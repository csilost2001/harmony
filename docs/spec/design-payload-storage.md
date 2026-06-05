# Design Payload Storage

**Status**: RFC implementation policy for #1448
**Created**: 2026-06-05
**Related**: #1448, edit-session-protocol.md, page-layout.md, screen-items.md

This document defines how GrapesJS design payloads should be stored when large
HTML bodies are split out of `.design.json`.

## 1. Problem

GrapesJS project data currently stores the HTML body in
`pages[0].frames[0].component.components` as a large JSON string.

That format is valid GrapesJS project data, but it is a poor source artifact:

- Git diffs show a large escaped JSON string instead of local HTML changes.
- AI and scripts tend to rewrite the whole string instead of making DOM-local edits.
- Conflict resolution and blame are hard because the HTML is not represented as HTML.

YAML or Markdown would improve the visual wrapping of the string, but would not
solve the core problem. The canonical source representation should store HTML as
HTML.

## 2. Canonical Format

For GrapesJS payloads, `.design.json` may reference an external HTML companion
file:

```json
{
  "pages": [
    {
      "frames": [
        {
          "component": {
            "type": "wrapper",
            "componentsRef": "dashboard.components.html"
          }
        }
      ]
    }
  ]
}
```

The companion file contains raw HTML:

```html
<main>
  <h1>Dashboard</h1>
</main>
```

CSS can follow the same pattern later with `stylesRef`, but #1448 starts with
HTML because that is where the current diff and editing cost is highest.

## 3. Paths

Committed artifacts:

| Resource | Design JSON | HTML companion |
|---|---|---|
| Screen | `<dataDir>/screens/<id>.design.json` | `<dataDir>/screens/<id>.components.html` |
| PageLayout | `<dataDir>/page-layouts/<id>.design.json` | `<dataDir>/page-layouts/<id>.components.html` |

Draft and history artifacts are not Git-tracked:

| Kind | Path |
|---|---|
| Active draft | `<workspaceRoot>/.edit-sessions/<editSessionId>/payload.design.json` + `payload.components.html` |
| Draft history | `<workspaceRoot>/.edit-sessions-history/<resourceType>/<resourceId>/<historyId>/payload.design.json` + `payload.components.html` |

These paths are intentionally workspace-local cache/state. They must remain
outside Git-managed canonical samples unless explicitly exported.

## 4. Adapter Contract

GrapesJS does not resolve `componentsRef` by itself. Harmony owns the adapter.

Load:

1. Read `.design.json`.
2. If `component.componentsRef` is present, read the referenced `.html`.
3. Inflate the in-memory project data by setting `component.components` to the HTML string.
4. Pass the inflated object to `editor.loadProjectData()`.

Save:

1. Read `editor.getProjectData()`.
2. If `component.components` is an HTML string, write it to the companion `.html`.
3. Deflate `.design.json` by replacing the large string with `componentsRef`.
4. Persist the JSON and companion file atomically enough that stale refs are not left behind.

Legacy compatibility:

- Existing `.design.json` files with inline `components` remain readable.
- New writes should prefer `componentsRef` once the adapter is implemented.
- Utilities should call an "effective GrapesJS HTML" resolver instead of reading
  `component.components` directly.

## 5. Draft Policy

Active drafts should be file-backed, not memory-only.

Rationale:

- Users experience drafts as durable editing sessions.
- Backend restart should not silently drop unsaved draft state.
- Multiple edit sessions can exist for the same resource, so draft HTML companions
  must be scoped by `editSessionId`, not by resource ID.
- Drafts are not canonical source artifacts and must not be Git-tracked.

The same inflate/deflate adapter should apply to committed files, active drafts,
and history snapshots so all three representations stay structurally consistent.

## 6. Lifecycle

Every operation that treats `.design.json` as a companion file must include
`.components.html`:

- rename
- duplicate
- delete
- restore / undo
- import / export
- sample validation
- PageLayout design routing

Cleanup must remove draft/history directories after the configured retention
period. UI copy must display the effective retention value instead of hard-coded
days.

## 7. Acceptance Criteria

- Git diff shows local HTML changes in `.components.html`.
- Existing inline `components` files still load.
- GrapesJS editor load/save behavior is unchanged from the user's perspective.
- Backend restart can restore active draft state.
- Multiple drafts for one resource do not collide.
- Draft and history files are Git ignored and cleaned after retention expires.
- Preview, gadget composition, screen item extraction, and rename utilities use
  the same effective HTML resolver.
