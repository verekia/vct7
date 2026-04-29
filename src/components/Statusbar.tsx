export function Statusbar() {
  return (
    <footer className="statusbar-surface border-line text-muted flex items-center gap-3.5 border-t px-3.5 text-[10px] tracking-[1px] uppercase">
      <span>Shift: free angle</span>
      <span>Esc: cancel</span>
      <span>Enter / dbl-click: finish line</span>
      <span>Space + drag: pan</span>
      <span>Wheel: zoom</span>
      <span>F: fit view</span>
      <span>G: toggle grid</span>
    </footer>
  )
}
