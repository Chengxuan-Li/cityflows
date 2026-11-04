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
    step: (steps) => useAppStore.getState().control('step', steps),
    movementId: (index) => useAppStore.getState().session!.loadedCompiled.movements[index]!.id,
  };
}

void useAppStore.getState().open();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
