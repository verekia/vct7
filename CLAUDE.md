# CLAUDE.md

## Project

**vectorheart** is a focused SVG editor for diagonal/parallel/sharp-corner
compositions: angle snapping, global bezier rounding (with per-shape override),
arc + glyph + animation primitives, and "SVG-as-project-file" round-tripping
via `data-vh-*` attributes. The saved file is a perfectly valid SVG any
browser/Figma/Illustrator can render — opening it in vectorheart restores the
full editable project losslessly.

Stack: Vite 8 · React 19 · TypeScript 6 · Zustand 5 · Vitest 4 · oxlint · oxfmt.

## Package manager: Bun

This project uses **Bun**. The committed lockfile is `bun.lock` — do **not**
generate or commit a `package-lock.json` or `yarn.lock`.

```sh
bun install
bun run dev          # http://localhost:5173
bun run all          # format:check + lint + typecheck + test (run before committing)
```

Other scripts (all defined in `package.json`): `build`, `preview`, `typecheck`,
`lint`, `format`, `format:check`, `test`, `test:watch`.

## Layout

- `src/types.ts` — `Shape`, `ProjectSettings`, animation/arc/glyph types.
- `src/store.ts` — Zustand store; single source of truth for shapes + settings + history.
- `src/components/` — React UI (`Canvas`, `ShapePanel`, `LayerPanel`, `Toolbar`, …).
- `src/lib/` — pure helpers: `geometry`, `svg-io`, `transform`, `blend`, `animation`, `snap`, …
- `src/hooks/` — interaction + keyboard hooks.
- Tests live next to their subject (`*.test.ts`), run via Vitest + happy-dom.

---

## Behavioral guidelines

Behavioral guidelines to reduce common LLM coding mistakes. Merge with the
project-specific notes above.

**Tradeoff:** these guidelines bias toward caution over speed. For trivial
tasks, use judgment.

### 1. Think before coding

**Don't assume. Don't hide confusion. Surface tradeoffs.**

Before implementing:

- State your assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them — don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

### 2. Simplicity first

**Minimum code that solves the problem. Nothing speculative.**

- No features beyond what was asked.
- No abstractions for single-use code.
- No "flexibility" or "configurability" that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.

Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes,
simplify.

### 3. Surgical changes

**Touch only what you must. Clean up only your own mess.**

When editing existing code:

- Don't "improve" adjacent code, comments, or formatting.
- Don't refactor things that aren't broken.
- Match existing style, even if you'd do it differently.
- If you notice unrelated dead code, mention it — don't delete it.

When your changes create orphans:

- Remove imports/variables/functions that **your** changes made unused.
- Don't remove pre-existing dead code unless asked.

The test: every changed line should trace directly to the user's request.

### 4. Goal-driven execution

**Define success criteria. Loop until verified.**

Transform tasks into verifiable goals:

- "Add validation" → "Write tests for invalid inputs, then make them pass."
- "Fix the bug" → "Write a test that reproduces it, then make it pass."
- "Refactor X" → "Ensure tests pass before and after."

For multi-step tasks, state a brief plan:

```
1. [step] → verify: [check]
2. [step] → verify: [check]
3. [step] → verify: [check]
```

In this repo the standard final verification is `bun run all` — it must pass
before a change is considered done.

Strong success criteria let you loop independently. Weak criteria ("make it
work") require constant clarification.

---

**These guidelines are working if:** fewer unnecessary changes in diffs, fewer
rewrites due to overcomplication, and clarifying questions come before
implementation rather than after mistakes.
