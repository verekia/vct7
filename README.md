# VCT7

A focused SVG editor for diagonal, parallel, sharp-corner compositions —
with optional rounding, live mirroring, radial repeats, animation, and
lossless round-tripping through plain SVG files.

The file you save **is** the project file. It opens in any browser, Figma,
or Illustrator as a regular SVG; reopen it in VCT7 and every editable
detail is restored.

---

## Features

### Drawing

- **Line** tool — open polylines, click to add vertices, double-click /
  Enter / right-click to finish.
- **Polygon** tool — closed filled shapes, same click-to-add workflow.
- **Circle** tool — click center, drag the radius. Convert any circle into
  a partial **arc** (wedge / chord / open).
- **Text** — vectorize text in any installed system font (via the Local
  Font Access API on supported browsers) into editable glyph outlines.
- **Free-angle drawing** — hold **Shift** to bypass angle snapping at any
  time.

### Angle snapping

- Per-project **snap angles** in degrees — every line segment locks to an
  allowed direction.
- One-click presets: orthogonal, 45°, 30°, 60°, 15°.
- Visible snap rays project from neighboring vertices so you can see
  exactly where a corner will land.

### Bezier rounding

- **Global slider** — rounds every corner across the whole composition at
  once, from sharp to fully rounded.
- **Per-shape override** — any shape can opt out of the global value and
  use its own.
- **Per-vertex override** — sparse per-corner rounding for fine control.
- **Adaptive curve direction** — obtuse corners bulge outward like a
  classic fillet; acute corners pull inward into a cusp. Heart-shaped
  cusps and side-bumps come for free.

### Grid & guides

- Toggleable **grid** (key **G**) with configurable spacing.
- Optional **grid snap** so vertices land on intersections.
- **Magnetic snap targets** pull vertices toward the grid, neighbor
  vertices, and angle-ray intersections within 16 px on screen.
- **Coordinates HUD** — bottom-right shows live cursor coordinates, zoom
  level, and the active tool.

### Selection & editing

- Click to **select**; Shift-click to add, Cmd/Ctrl-click to toggle.
- **Marquee** — drag on empty canvas to box-select shapes; in vertex mode
  the marquee selects vertices instead.
- **Vertex editing** — drag, multi-select, and delete individual points.
- **Insert vertex** — double-click an edge to add a vertex at its
  midpoint.
- **Alt+drag** to duplicate a shape in place.
- **Click-cycling** — repeated clicks on a grouped shape cycle between
  the group and the individual member.
- **Pan** with Space+drag or middle-mouse; **zoom** with the mouse wheel.
- **Fit** the artboard to the viewport with **F**.

### Shapes & geometry operations

- **Lines, polygons, circles, arcs** (wedge / chord / open), and
  **glyphs** (vectorized text).
- **Merge** two shapes that share a seam — joins polylines and polygons
  along coincident vertices.
- **Flip** horizontally or vertically around the shape's bbox center.
- **Apply transform** — bake live rotation/scale into the geometry and
  reset the handles.

### Transforms

- **Per-shape rotation** and **uniform scale**, applied around the visual
  bbox center, kept live (non-destructive) until you bake them.
- **Per-group rotation** and **scale**, applied to the whole group as a
  rigid body via a single SVG `<g>` transform.

### Live modifiers

- **Mirror** — attach a live reflection to any shape. Drag the green
  axis to reposition; horizontal or vertical orientation; show or hide
  the axis line. The source's rotation/scale pivot moves to the
  combined pair so it behaves as one unit.
  - **Convert to group** — bake the reflection into a real second
    shape inside a fresh group.
  - **Merge mirror** — stitch source and reflection together when they
    meet at the axis.
- **Radial repeat** — attach live rotational clones around a center
  point. Drag the orange center; control the angular increment; show or
  hide the center marker.
  - **Convert to group** — bake every clone into independent shapes
    inside a fresh group.

### Groups & layers

- **Layer panel** — drag to reorder z-stack, rename, lock, hide.
- **Groups** — create, rename, delete, drag shapes in and out. Members
  stay contiguous in z-order so the group is a single `<g>` in the SVG.
- **Group-level rotation, scale, and animation** — apply a transform or
  entrance to every member at once.
- **Lock** any shape or group to keep it out of the way.
- **Hide** shapes without removing them — they stay in the file for
  later.

### Styling

- **Fill** and **stroke** color via picker or hex input; `none` for
  transparent.
- **Stroke width**, **dasharray** (any valid SVG syntax), **linejoin**
  (miter / round / bevel), **linecap** (butt / round / square).
- **Paint order** toggle — swap stroke-over-fill for outlined-text and
  chunky-icon looks.
- **Opacity** per shape.
- **Blend modes** — all 16 CSS mix-blend-mode values (multiply, screen,
  overlay, darken, lighten, color-dodge / -burn, hard / soft light,
  difference, exclusion, hue, saturation, color, luminosity).
- **Bake blending** and **bake opacity** — composite the effect into the
  fill / stroke colors so viewers without blend-mode support still see
  the right result.

### Color palette

- Project-level **named palette**. Add, rename, recolor, remove.
- Bind any shape's **fill**, **stroke**, or the project **background** to
  a palette entry. Updating the entry updates every linked shape.
- Refs are metadata only — exported SVGs always carry resolved hex
  values, so files render identically outside the editor.

### Animation & timeline

- **Master toggle** — turn animations on for the project, or strip them
  on export for a pure static SVG.
- **Entrance animation** per shape — duration, delay, easing, plus
  offsets at t=0 for opacity, rotation, scale, translation, fill color,
  and stroke color.
- **Easings** — linear, ease, ease-in, ease-out, ease-in-out, and a
  custom **snap** curve tuned for a fast-out / firm-stop landing.
- **Spin** modifier — constant-speed rotation that engages after the
  entrance and runs forever, with an optional offset to start during the
  entrance.
- **Group entrance** animation runs on the whole group as one unit.
- **Timeline panel** — scrubber, play / pause / stop, per-shape entrance
  clips you can drag to retime, and a separate spin-segment marker.
- **Onion skin** — toggle a ghosted preview of the from-state while you
  scrub.
- Animations export as standard CSS keyframes — they play in any
  browser.

### Project & artboard

- **Artboard size** (output `width` / `height`) is independent from the
  **viewBox**, so you can hold high-precision coordinates while
  rendering at any size.
- **Background** color, with optional palette ref. `null` means
  transparent — the canvas shows a checkerboard for contrast and the
  exported SVG omits the background.
- **Clip to artboard** toggle — clip every rendered shape to the
  artboard rectangle.

### File handling

- **Round-tripping** — a saved SVG keeps every editable detail (snap
  angles, palette, groups, animations, mirror / radial specs, per-vertex
  rounding, glyph data) inside `data-v7-*` attributes the editor reads
  on reopen. Stripped to a clean SVG when you export.
- **Save back to the same file** — `Cmd/Ctrl+S` writes to the file you
  opened (via the File System Access API, on supported browsers). No
  download dialog every time.
- **Drag & drop** — drop an SVG onto the canvas to open it.
- **Plain SVG import** — open any SVG and edit it. Native `<path>`,
  `<circle>`, `<ellipse>`, `<polygon>`, and `<line>` elements come in
  with their fills, strokes, transforms, blend modes, opacity, and dash
  patterns intact. Curves collapse to polylines you can re-edit.
- **Export** — strip the editor metadata for a clean, minimal SVG.
- **Code viewer** — open a dialog to inspect the live SVG source and
  copy it to the clipboard.
- **Dirty indicator** in the title bar; **discard prompt** before
  destructive actions (new / open / quit) when changes are unsaved.

### Undo / redo

- 100 levels of history.
- Continuous gestures (slider drags, vertex drags) coalesce into a
  single undo step.

### Clipboard

- **Copy / paste** shapes between projects via Cmd/Ctrl+C / V — the
  clipboard persists across sessions in your browser.
- **Duplicate** in place with Cmd/Ctrl+D.

---

## Shortcuts

| Key                               | Action                            |
| --------------------------------- | --------------------------------- |
| `V`                               | Select tool                       |
| `L`                               | Line tool                         |
| `P`                               | Polygon tool                      |
| `C`                               | Circle tool                       |
| `T`                               | Text dialog                       |
| `F`                               | Fit artboard to viewport          |
| `G`                               | Toggle grid                       |
| `Shift` (held)                    | Disable angle snapping            |
| `Space` + drag                    | Pan canvas                        |
| Wheel                             | Zoom                              |
| `Enter` / dbl-click / right-click | Finish current line / polygon     |
| `Esc`                             | Cancel current draw / deselect    |
| `Delete` / `Backspace`            | Delete selected vertex (or shape) |
| `Cmd/Ctrl+D`                      | Duplicate selected shapes         |
| `Cmd/Ctrl+C` / `Cmd/Ctrl+V`       | Copy / paste shapes               |
| `Cmd/Ctrl+S`                      | Save (writes back to same file)   |
| `Cmd/Ctrl+Shift+S`                | Save As                           |
| `Cmd/Ctrl+O`                      | Open                              |
| `Cmd/Ctrl+N`                      | New project                       |
| `Cmd/Ctrl+Z`                      | Undo                              |
| `Cmd/Ctrl+Shift+Z` / `Cmd/Ctrl+Y` | Redo                              |
