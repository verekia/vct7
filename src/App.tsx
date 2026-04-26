import { useEffect } from 'react';
import { Topbar } from './components/Topbar';
import { Toolbar } from './components/Toolbar';
import { ProjectPanel } from './components/ProjectPanel';
import { ShapePanel } from './components/ShapePanel';
import { Canvas } from './components/Canvas';
import { Statusbar } from './components/Statusbar';
import { useKeyboard } from './hooks/useKeyboard';
import { useStore } from './store';

export function App() {
  useKeyboard();

  // Warn before leaving if there are unsaved changes.
  const dirty = useStore((s) => s.dirty);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (!dirty) return;
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', handler);
    return () => window.removeEventListener('beforeunload', handler);
  }, [dirty]);

  return (
    <>
      <Topbar />
      <main className="workspace">
        <aside className="left-panel">
          <Toolbar />
          <ProjectPanel />
          <ShapePanel />
        </aside>
        <Canvas />
      </main>
      <Statusbar />
    </>
  );
}
