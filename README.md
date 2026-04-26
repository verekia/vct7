# vectorheart

A focused SVG editor for *vectorheart* compositions — diagonals, parallels, sharp
corners, optional rounding. The editor is intentionally minimal:

- **Angle snapping** — every line segment snaps to one of a per-project angle
  set (default `0,45,90,…`). Hold `Shift` for free angle.
- **Global bezier rounding** — one slider rounds every corner across the whole
  composition. Per-shape override is available.
- **Lines and filled shapes** — line tool for open polylines, polygon tool for
  filled closed shapes.
- **SVG-as-project-file** — the SVG you save *is* the project file. Settings and
  control points are stored in `data-vh-*` attributes so the file is still a
  perfectly valid SVG that any browser/Figma/Illustrator can render.
- **File System Access API** — `Cmd/Ctrl+S` writes back to the same file you
  opened. No download dialog on every save.

## Run

```sh
npm run dev
# then open http://localhost:5173
```

`serve` is just a static file server. Any static server works; the File System
Access API needs a secure origin (`localhost` or HTTPS).

## Shortcuts

| Key | Action |
|---|---|
| `V` / `L` / `P` | Select / Line / Polygon tool |
| `Shift` | Disable angle snapping while held |
| `Space` + drag | Pan |
| Wheel | Zoom |
| `Enter` / dbl-click / right-click | Finish current line/polygon |
| `Esc` | Cancel current draw / deselect |
| `Delete` / `Backspace` | Delete selected vertex (or shape) |
| `Cmd/Ctrl+S` | Save (writes back to same file) |
| `Cmd/Ctrl+Shift+S` | Save As |
| `Cmd/Ctrl+O` | Open |
| `Cmd/Ctrl+N` | New project |

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

`d` is the rendered path (with rounding baked in). `data-vh-points` keeps the
editable control polyline so the editor can re-open the file losslessly.
`data-vh-bezier` on a path overrides the project-wide value for that shape.
