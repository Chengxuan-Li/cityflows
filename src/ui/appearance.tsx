import { useAppearance, type AppearanceMode } from './appearance-store';

/** The appearance setting, beside the scene lighting in the Layers section. */
export function AppearanceControls() {
  const { settings, setAppearance } = useAppearance();
  return (
    <>
      <label>
        Appearance
        <select
          aria-label="Appearance"
          value={settings.appearance}
          onChange={(event) =>
            setAppearance({ appearance: event.currentTarget.value as AppearanceMode })
          }
        >
          <option value="system">System</option>
          <option value="light">Light</option>
          <option value="dark">Dark</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={settings.matchLighting}
          onChange={(event) => setAppearance({ matchLighting: event.currentTarget.checked })}
        />
        Match lighting
      </label>
    </>
  );
}
