import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { useAppStore } from './ui/store';
import './ui/app.css';

if (import.meta.env.DEV || import.meta.env.MODE === 'test') {
  const engine = () => {
    const session = useAppStore.getState().session;
    if (!session) throw new Error('Open a project before querying the engine');
    return session.engine;
  };
  window.cityflows = {
    metrics: () => engine().metrics(),
    hash: () => engine().hash(),
    inspect: (id) => engine().inspect(id),
    // The store drops a command while another runs (`perform`); a scripted step right after a
    // click (Restart, Step) waits for it instead of vanishing (TASK-115 made clicks fast).
    step: async (steps) => {
      while (useAppStore.getState().busy) await new Promise((resolve) => setTimeout(resolve, 10));
      return useAppStore.getState().control('step', steps);
    },
    movementId: (index) => useAppStore.getState().session!.loadedCompiled.movements[index]!.id,
  };
}

void useAppStore.getState().open();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
