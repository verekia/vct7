export function Statusbar() {
  return (
    <footer className="statusbar-surface flex gap-3.5 items-center px-3.5 border-t border-line text-[10px] text-muted tracking-[1px] uppercase">
      <span>Shift: free angle</span>
      <span>Esc: cancel</span>
      <span>Enter / dbl-click: finish line</span>
      <span>Space + drag: pan</span>
      <span>Wheel: zoom</span>
      <span>F: fit view</span>
      <span>G: toggle grid</span>
    </footer>
  );
}
