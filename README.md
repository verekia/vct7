# vectorheart

A focused SVG editor for _vectorheart_ compositions — diagonals, parallels,
sharp corners, optional rounding. The editor is intentionally minimal:

- **Angle snapping** — every line segment snaps to one of a per-project angle
  set (default `0,45,90,…`). Hold `Shift` for a free angle.
- **Global bezier rounding** — one slider rounds every corner across the whole
  composition. Per-shape override is also available.
- **Adaptive curve direction** — at each interior vertex the rounding direction
  is chosen by the angle: obtuse / right corners (≥ 90°) bulge outward like a
  classic fillet, while acute corners (< 90°) pull inward to form a cusp. Heart
  shapes get their top-cusp + side-bumps for free.
- **Lines and filled shapes** — `Line` for open polylines, `Polygon` for filled
  closed shapes.
- **SVG-as-project-file** — the SVG you save _is_ the project file. Settings
  and control points are stored in `data-vh-*` attributes so the file is still
  a perfectly valid SVG that any browser/Figma/Illustrator can render.
- **File System Access API** — `Cmd/Ctrl+S` writes back to the same file you
  opened. No download dialog on every save.

## Stack

Vite 8 · React 19 · TypeScript 6 · Zustand 5 · Vitest 4 · oxlint 1 · oxfmt 0.46

## Run

```sh
npm install
npm run dev      # http://localhost:5173
```

## Scripts

| Script                 | Action                                  |
| ---------------------- | --------------------------------------- |
| `npm run dev`          | Vite dev server                         |
| `npm run build`        | Type-check + production build           |
| `npm run preview`      | Preview the built bundle                |
| `npm run typecheck`    | `tsc -b --noEmit`                       |
| `npm run lint`         | oxlint                                  |
| `npm run format`       | oxfmt (write)                           |
| `npm run format:check` | oxfmt (check only)                      |
| `npm run test`         | Vitest run                              |
| `npm run test:watch`   | Vitest watch mode                       |
| `npm run check`        | typecheck + lint + format check + tests |

## Shortcuts

| Key                               | Action                            |
| --------------------------------- | --------------------------------- |
| `V` / `L` / `P`                   | Select / Line / Polygon tool      |
| `Shift`                           | Disable angle snapping while held |
| `Space` + drag                    | Pan                               |
| Wheel                             | Zoom                              |
| `Enter` / dbl-click / right-click | Finish current line/polygon       |
| `Esc`                             | Cancel current draw / deselect    |
| `Delete` / `Backspace`            | Delete selected vertex (or shape) |
| `Cmd/Ctrl+S`                      | Save (writes back to same file)   |
| `Cmd/Ctrl+Shift+S`                | Save As                           |
| `Cmd/Ctrl+O`                      | Open                              |
| `Cmd/Ctrl+N`                      | New project                       |
| `Cmd/Ctrl+Z`                      | Undo                              |
| `Cmd/Ctrl+Shift+Z` / `Cmd/Ctrl+Y` | Redo                              |

## File format

A saved file is a normal SVG with a few extra attributes:

```xml
<svg viewBox="0 0 800 800"
     data-vh-snap-angles="0,45,90,135,180,225,270,315"
     data-vh-bezier="0.25"
     data-vh-bg="#ffffff">
  <rect width="800" height="800" fill="#ffffff"/>
  <path d="M 100 100 L 200 100 L 200 200 Z"
        fill="#000" stroke="none"
        data-vh-points="100,100 200,100 200,200"
        data-vh-closed="true"/>
</svg>
```

`d` is the rendered path with rounding baked in. `data-vh-points` keeps the
editable control polyline so the editor can re-open the file losslessly.
`data-vh-bezier` on a path overrides the project-wide value for that shape.
