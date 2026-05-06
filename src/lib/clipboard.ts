import type { Point, Shape } from '../types'

/**
 * In-memory shape clipboard backing Cmd+C / Cmd+V. Lives at module scope so
 * the entries survive component re-mounts during a session, but does not
 * persist across reloads — paste only works within the same editor session.
 * (Cross-session paste would need real OS-clipboard / SVG serialization.)
 */
let clipboard: Shape[] = []

export const copyShapes = (shapes: Shape[]): void => {
  // Clone the points array per shape so future store edits to the source
  // don't leak through the shared reference. Other nested fields are
  // treated immutably by the store, so a shallow clone is enough.
  clipboard = shapes.map(sh => ({
    ...sh,
    points: sh.points.map(p => [p[0], p[1]] as Point),
  }))
}

export const getClipboard = (): Shape[] => clipboard
