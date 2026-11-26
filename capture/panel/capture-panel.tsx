import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  CloseButton,
  DisclosureGroup,
  SegmentedControl,
  Slider,
  Switch,
} from '../../src/ui/controls';
import { useAppStore } from '../../src/ui/store';
import {
  clockText,
  formatList,
  formatsOf,
  frameOf,
  parseShot,
  serializeShot,
  simAt,
  simStart,
  sunAt,
  view,
  windowTop,
  type Format,
  type FormatName,
  type Key,
  type Shot,
  type Title,
} from '../core/shot';
import { createStage, fetchFile, type Stage } from '../core/stage';
import { layerDefaults } from '../layers';
import { layerLabels, layerNames, type LayerName } from '../layers/registry';
import './capture-panel.css';

// Capture (cinematic-captures branch only): the Capture panel edits a shot on the running app, in
// place of the inspector. The 3D canvas takes the shot's canvas size (scaled to fit), the frame's
// window and the title draw over it, and the shot plays on a timeline with the traffic following.
// Opened from the toolbar's Capture button or `?capture[=<shot file>]`, in dev and test builds.
// Rendering stays offline: the panel shows the command for the current shot.

const api = () => window.cityflows!;
const store = () => useAppStore.getState();
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round = (n: number, d: number) => Math.round(n * 10 ** d) / 10 ** d;
const parseClock = (text: string) => {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?$/.exec(text.trim());
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3] ?? 0) : undefined;
};
const defaultFormats: Record<FormatName, Format> = {
  landscape: { width: 1920, height: 1080, canvasHeight: 1080, fov: 36, titleX: 960 },
  portrait: { width: 1080, height: 1920, canvasHeight: 1920, fov: 51, titleX: 540 },
};
const defaultTitle: Title = {
  text: 'CityFlows',
  subtitle: '',
  version: 'auto',
  colour: '#fff6ea',
  fade: [1, 2],
  y: 'horizon',
};
let openedProject = '';

export default function CapturePanel() {
  const [open, setOpen] = useState(() => new URLSearchParams(location.search).has('capture'));
  useEffect(() => {
    const toggle = () => setOpen((o) => !o);
    addEventListener('cityflows:capture', toggle);
    return () => removeEventListener('cityflows:capture', toggle);
  }, []);
  const app = document.querySelector('.app');
  if (!open || !app) return null;
  return createPortal(<Panel onClose={() => setOpen(false)} />, app);
}

function Panel({ onClose }: { onClose: () => void }) {
  // The panel stands in the inspector's place while it is open.
  useLayoutEffect(() => {
    const app = document.querySelector('.app')!;
    app.classList.add('capture-open');
    return () => app.classList.remove('capture-open');
  }, []);
  const [path, setPath] = useState<string | undefined>();
  const [shot, setShot] = useState<Shot | undefined>();
  const [saved, setSaved] = useState('');
  const [format, setFormat] = useState<FormatName>('landscape');
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [follow, setFollow] = useState(true);
  const [whole, setWhole] = useState(false);
  const [layersOn, setLayersOn] = useState(true);
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [simS, setSimS] = useState(0);
  const [shots, setShots] = useState<string[]>([]);
  const stage = useRef<Stage | undefined>(undefined);
  // The stage the preview draws with, once one is set up.
  const [live, setLive] = useState<Stage | undefined>();
  const timeRef = useRef(0);
  useEffect(() => {
    timeRef.current = t;
  }, [t]);
  const stepping = useRef<Promise<void>>(Promise.resolve());
  // One load at a time: two stages on one scene would patch its materials twice (and React's
  // strict mode mounts the panel twice in development).
  const loading = useRef<Promise<void>>(Promise.resolve());
  const loaded = useRef<string | File | undefined>(undefined);

  useEffect(() => {
    void fetch('/__capture/shots')
      .then((r) => r.json() as Promise<string[]>)
      .then(setShots);
    const flag = new URLSearchParams(location.search).get('capture');
    if (flag) void load(flag);
    return () => {
      stage.current?.dispose();
      stage.current = undefined;
    };
    // Mount only: the panel loads its first shot once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- traffic: the sim only steps forward; Rewind restarts the run and steps back.
  // The run's clock: the store reads it from the engine after every step.
  const readSim = async () => {
    while (store().busy) await wait(10);
    const now = store().run?.timeS ?? 0;
    setSimS(now);
    return now;
  };
  const stepTo = useCallback(async (target: number, report = false) => {
    let now = await readSim();
    while (target - now > 0.05) {
      await api().step(Math.min(6000, Math.round((target - now) * 10)));
      now = await readSim();
      if (report) setStatus(`Running traffic to ${clockText(target)}… ${clockText(now)}`);
    }
  }, []);
  const followSim = useCallback(
    (s: Shot, at: number) => {
      const target = simAt(s, at);
      stepping.current = stepping.current.then(async () => {
        if (target > (await readSim()) + 0.05) await stepTo(target);
      });
      return stepping.current;
    },
    [stepTo],
  );

  async function loadNow(source: string | File) {
    setBusy(true);
    try {
      const text =
        typeof source === 'string'
          ? new TextDecoder().decode(await fetchFile(source))
          : await source.text();
      const next = parseShot(JSON.parse(text));
      if (next.project !== openedProject) {
        setStatus(`Opening ${next.project}…`);
        const bundled = next.project.startsWith('bundled:') ? next.project.slice(8) : undefined;
        const source =
          bundled ??
          new File([await fetchFile(next.project)], 'capture.cityflows.json', {
            type: 'application/json',
          });
        // The store drops a command while another runs (the app's own first city, say).
        while (store().busy || !store().session) await wait(100);
        const before = store().session!.project;
        await store().open(source);
        for (let i = 0; store().busy || store().session?.project === before; i++) {
          if (store().error || i > 3000)
            throw new Error(store().error ?? 'The project did not open');
          await wait(100);
        }
        openedProject = next.project;
      }
      if (store().run?.status === 'playing') await store().control('pause');
      const nextFormat = formatsOf(next)[0]!;
      setStatus('Setting up the shot…');
      stage.current?.dispose();
      stage.current = await createStage(next, nextFormat);
      setLive(stage.current);
      loaded.current = source;
      setPath(typeof source === 'string' ? source : undefined);
      setShot(next);
      setSaved(serializeShot(next));
      setFormat(nextFormat);
      setT(0);
      stage.current.show(0);
      if (follow) {
        if ((await readSim()) > simStart(next) + 0.2) {
          await store().control('restart');
          while (store().busy) await wait(50);
        }
        await stepTo(simStart(next), true);
      }
      setStatus(`Loaded ${typeof source === 'string' ? source : source.name}.`);
    } catch (error) {
      setStatus(`Not loaded: ${error instanceof Error ? error.message : error}`);
    } finally {
      setBusy(false);
    }
  }
  function load(source: string | File) {
    loading.current = loading.current.then(() =>
      // Strict mode's second mount asks for the shot just loaded.
      source === loaded.current && stage.current ? undefined : loadNow(source),
    );
    return loading.current;
  }

  // ---- the shot follows edits: light and camera at once, layers and title after a pause.
  useEffect(() => {
    if (!shot || !stage.current) return;
    const timer = setTimeout(async () => {
      await stage.current?.setShot(shot, format);
      stage.current?.show(timeRef.current);
    }, 250);
    stage.current.show(timeRef.current);
    return () => clearTimeout(timer);
  }, [shot, format]);

  const seek = useCallback(
    (next: number, run = follow) => {
      if (!shot) return;
      const at = Math.min(shot.duration, Math.max(0, next));
      setT(at);
      stage.current?.show(at);
      if (run) void followSim(shot, at);
    },
    [shot, follow, followSim],
  );

  useEffect(() => {
    if (!playing || !shot) return;
    let stop = false;
    void (async () => {
      let at = timeRef.current >= shot.duration - 1e-6 ? 0 : timeRef.current;
      let last = performance.now();
      while (!stop && at < shot.duration) {
        await new Promise(requestAnimationFrame);
        const now = performance.now();
        at = Math.min(shot.duration, at + (now - last) / 1000);
        last = now;
        setT(at);
        stage.current?.show(at);
        if (follow) await followSim(shot, at);
      }
      if (!stop) setPlaying(false);
    })();
    return () => {
      stop = true;
    };
  }, [playing, shot, follow, followSim]);

  async function rewind() {
    if (!shot) return;
    setBusy(true);
    await store().control('restart');
    while (store().busy) await wait(50);
    await stepTo(simAt(shot, t), true);
    setStatus('Traffic rewound.');
    setBusy(false);
  }

  async function save(to = path) {
    if (!shot || !to) return;
    const text = serializeShot(shot);
    const response = await fetch(`/__capture/shot?path=${encodeURIComponent(to)}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: text,
    });
    if (!response.ok) return setStatus(`Not saved: ${await response.text()}`);
    setPath(to);
    setSaved(text);
    setStatus(`Saved ${to}.`);
    if (!shots.includes(to)) setShots([...shots, to].sort());
  }

  async function grab() {
    if (!stage.current || !shot) return;
    const data = await stage.current.grab(t);
    const link = Object.assign(document.createElement('a'), {
      href: data,
      download: `${shot.location}-${format}-${t.toFixed(2)}.png`,
    });
    link.click();
  }

  const edit = (change: (s: Shot) => Shot) => setShot((s) => (s ? change(s) : s));

  return (
    <aside className="capture-panel" aria-label="Capture">
      <header className="capture-head">
        <h2>Capture</h2>
        <CloseButton label="Close capture" onClick={onClose} />
      </header>
      <div className="capture-row">
        <select
          aria-label="Shot file"
          value={path ?? ''}
          disabled={busy}
          onChange={(e) => e.currentTarget.value && void load(e.currentTarget.value)}
        >
          {!path && <option value="">{shot ? 'Unsaved shot' : 'Load a shot…'}</option>}
          {shots.map((s) => (
            <option key={s} value={s}>
              {s.replace('capture/locations/', '')}
            </option>
          ))}
        </select>
        <label className="capture-file">
          <input
            type="file"
            accept=".json,application/json"
            disabled={busy}
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              e.currentTarget.value = '';
              if (file) void load(file);
            }}
          />
          Open…
        </label>
      </div>
      {status && (
        <p className="capture-status" role="status">
          {status}
        </p>
      )}
      {shot && (
        <ShotEditor
          shot={shot}
          path={path}
          dirty={serializeShot(shot) !== saved}
          format={format}
          t={t}
          simS={simS}
          busy={busy}
          playing={playing}
          follow={follow}
          whole={whole}
          layersOn={layersOn}
          edit={edit}
          setFormat={setFormat}
          seek={seek}
          setPlaying={setPlaying}
          setFollow={setFollow}
          setWhole={setWhole}
          setLayersOn={(on) => {
            setLayersOn(on);
            stage.current?.setLayersEnabled(on);
          }}
          rewind={() => void rewind()}
          save={(to) => void save(to)}
          revert={() => setShot(parseShot(JSON.parse(saved)))}
          grab={() => void grab()}
        />
      )}
      {shot && live && <Preview shot={shot} format={format} t={t} whole={whole} stage={live} />}
    </aside>
  );
}

interface EditorProps {
  shot: Shot;
  path: string | undefined;
  dirty: boolean;
  format: FormatName;
  t: number;
  simS: number;
  busy: boolean;
  playing: boolean;
  follow: boolean;
  whole: boolean;
  layersOn: boolean;
  edit: (change: (s: Shot) => Shot) => void;
  setFormat: (f: FormatName) => void;
  seek: (t: number, run?: boolean) => void;
  setPlaying: (p: boolean) => void;
  setFollow: (f: boolean) => void;
  setWhole: (w: boolean) => void;
  setLayersOn: (on: boolean) => void;
  rewind: () => void;
  save: (to?: string) => void;
  revert: () => void;
  grab: () => void;
}

function ShotEditor(props: EditorProps) {
  const { shot, format, t, edit } = props;
  const frame = frameOf(shot, format);
  const [saveAs, setSaveAs] = useState(`capture/locations/${shot.location}/shot.json`);
  const target = simAt(shot, t);
  const sun = sunAt(shot, t);
  const keyIndex = frame.keys.findIndex(
    (k, i) => t >= k.t && t < (frame.keys[i + 1]?.t ?? Infinity),
  );
  const setKeys = (keys: Key[]) =>
    edit((s) => {
      const sorted = [...keys].sort((a, b) => a.t - b.t);
      const own = s.formats[format]?.keys;
      return own
        ? { ...s, formats: { ...s.formats, [format]: { ...s.formats[format]!, keys: sorted } } }
        : { ...s, keys: sorted };
    });
  const fromView = (at: number): Key => {
    const v = api().view3D!()!;
    const near = view(frame.keys, at).bearing;
    return {
      t: round(at, 3),
      x: round(v.centre.x, 2),
      y: round(v.centre.y, 2),
      zoom: round(v.zoom, 3),
      pitch: round(v.pitch, 2),
      bearing: round(v.bearing + 360 * Math.round((near - v.bearing) / 360), 2),
    };
  };
  const setFrame = (change: Partial<Format> | null, name = format) =>
    edit((s) => ({
      ...s,
      formats: {
        ...s.formats,
        [name]:
          change === null ? undefined : { ...(s.formats[name] ?? defaultFormats[name]), ...change },
      },
    }));
  const command = props.path ?? `capture/locations/${shot.location}/shot.json`;
  const commands = [
    `npm run capture -- ${command} --format=${format} --mock=${t.toFixed(2)}`,
    `npm run capture -- ${command} --format=${format} --still=${t.toFixed(2)}`,
    `npm run capture -- ${command} --format=all --mp4`,
  ];

  return (
    <div className="capture-body">
      <div className="capture-row">
        <button
          className="primary"
          disabled={!props.dirty && !!props.path}
          onClick={() => props.save(props.path ?? saveAs)}
        >
          Save
        </button>
        <button disabled={!props.dirty || !props.path} onClick={props.revert}>
          Revert
        </button>
        <button onClick={props.grab}>Grab frame</button>
      </div>
      {!props.path && (
        <label className="edit-field">
          Save as
          <input value={saveAs} onChange={(e) => setSaveAs(e.currentTarget.value)} />
        </label>
      )}

      <DisclosureGroup title="Timeline">
        <Slider
          aria-label="Video time"
          min={0}
          max={shot.duration}
          step={1 / shot.fps}
          value={t}
          disabled={props.busy}
          onChange={(e) => props.seek(e.currentTarget.valueAsNumber)}
        />
        <p className="capture-readout">
          {t.toFixed(2)} s · frame {Math.round(t * shot.fps)} · sim {clockText(target)}
          {props.follow && props.simS > target + 0.2 ? ' · traffic ahead' : ''}
        </p>
        <div className="capture-row">
          <button disabled={props.busy} onClick={() => props.setPlaying(!props.playing)}>
            {props.playing ? 'Stop' : 'Play'}
          </button>
          <button
            disabled={props.busy || props.playing}
            onClick={() => props.seek(t - 1 / shot.fps)}
          >
            Back
          </button>
          <button
            disabled={props.busy || props.playing}
            onClick={() => props.seek(t + 1 / shot.fps)}
          >
            Forward
          </button>
          <button disabled={props.busy || props.playing} onClick={props.rewind}>
            Rewind traffic
          </button>
        </div>
        <Switch
          label="Traffic follows"
          checked={props.follow}
          onChange={(e) => props.setFollow(e.currentTarget.checked)}
        />
        <NumberField
          label="Duration (s)"
          value={shot.duration}
          min={0.5}
          step={0.5}
          onChange={(duration) => edit((s) => ({ ...s, duration }))}
        />
        <NumberField
          label="Frames per second"
          value={shot.fps}
          min={1}
          step={1}
          onChange={(fps) => edit((s) => ({ ...s, fps: Math.round(fps) }))}
        />
      </DisclosureGroup>

      <DisclosureGroup title="Camera keys">
        <table className="capture-keys">
          <thead>
            <tr>
              <th>t</th>
              <th>zoom</th>
              <th>pitch</th>
              <th>bearing</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {frame.keys.map((key, i) => (
              <tr key={JSON.stringify(key)} className={i === keyIndex ? 'current' : undefined}>
                {(['t', 'zoom', 'pitch', 'bearing'] as const).map((field) => (
                  <td key={field}>
                    <input
                      type="number"
                      aria-label={`Key ${i + 1} ${field}`}
                      step={field === 't' ? 0.1 : field === 'zoom' ? 0.1 : 1}
                      defaultValue={key[field]}
                      onBlur={(e) => {
                        const value = e.currentTarget.valueAsNumber;
                        if (!Number.isFinite(value) || (field === 'zoom' && value <= 0)) return;
                        setKeys(frame.keys.map((k, j) => (j === i ? { ...k, [field]: value } : k)));
                      }}
                    />
                  </td>
                ))}
                <td className="capture-key-actions">
                  <button onClick={() => props.seek(key.t)}>Go</button>
                  <button
                    onClick={() => setKeys(frame.keys.map((k, j) => (j === i ? fromView(k.t) : k)))}
                  >
                    Set
                  </button>
                  <button
                    disabled={frame.keys.length <= 2}
                    onClick={() => setKeys(frame.keys.filter((_, j) => j !== i))}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="capture-row">
          <button
            onClick={() => {
              const key = fromView(t);
              setKeys([...frame.keys.filter((k) => Math.abs(k.t - key.t) > 0.02), key]);
            }}
          >
            Key from view
          </button>
          <button onClick={() => props.seek(t, false)}>Camera to path</button>
        </div>
        <p className="capture-hint">
          Drag to pan, right-drag to orbit, scroll to zoom; Set and Key from view store the view.
        </p>
      </DisclosureGroup>

      <DisclosureGroup title="Sim timing" defaultOpen={false}>
        <SegmentedControl
          label="Sim start"
          value={shot.sim.cue ? 'cue' : 'start'}
          options={[
            { value: 'start', label: 'Start clock' },
            { value: 'cue', label: 'Cue', tooltip: 'The clock reached at a video time' },
          ]}
          onChange={(mode) =>
            edit((s) => ({
              ...s,
              sim:
                mode === 'cue'
                  ? { rate: s.sim.rate, cue: { t: 0, clock: simStart(s) } }
                  : { rate: s.sim.rate, start: simStart(s) },
            }))
          }
        />
        {shot.sim.cue ? (
          <>
            <NumberField
              label="Cue at (s)"
              value={shot.sim.cue.t}
              min={0}
              step={0.1}
              onChange={(at) =>
                edit((s) => ({ ...s, sim: { ...s.sim, cue: { ...s.sim.cue!, t: at } } }))
              }
            />
            <ClockField
              label="Cue clock"
              value={shot.sim.cue.clock}
              onChange={(clock) =>
                edit((s) => ({ ...s, sim: { ...s.sim, cue: { ...s.sim.cue!, clock } } }))
              }
            />
          </>
        ) : (
          <ClockField
            label="Start clock"
            value={shot.sim.start ?? 0}
            onChange={(start) => edit((s) => ({ ...s, sim: { ...s.sim, start } }))}
          />
        )}
        <p className="capture-readout">
          {clockText(simStart(shot))} to {clockText(simAt(shot, shot.duration))}
        </p>
        <table className="capture-keys">
          <thead>
            <tr>
              <th>t</th>
              <th>rate</th>
              <th>
                <span className="visually-hidden">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {shot.sim.rate.map((r, i) => (
              <tr key={`${i}-${r.t}-${r.rate}`}>
                {(['t', 'rate'] as const).map((field) => (
                  <td key={field}>
                    <input
                      type="number"
                      aria-label={`Rate key ${i + 1} ${field}`}
                      step={0.1}
                      min={0}
                      defaultValue={r[field]}
                      onBlur={(e) => {
                        const value = e.currentTarget.valueAsNumber;
                        if (!Number.isFinite(value) || value < 0) return;
                        edit((s) => ({
                          ...s,
                          sim: {
                            ...s.sim,
                            rate: s.sim.rate
                              .map((k, j) => (j === i ? { ...k, [field]: value } : k))
                              .sort((a, b) => a.t - b.t),
                          },
                        }));
                      }}
                    />
                  </td>
                ))}
                <td className="capture-key-actions">
                  <button
                    onClick={() =>
                      edit((s) => ({
                        ...s,
                        sim: { ...s.sim, rate: s.sim.rate.filter((_, j) => j !== i) },
                      }))
                    }
                  >
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          onClick={() =>
            edit((s) => ({
              ...s,
              sim: {
                ...s.sim,
                rate: [
                  ...s.sim.rate.filter((k) => Math.abs(k.t - t) > 0.02),
                  { t: round(t, 2), rate: 1 },
                ].sort((a, b) => a.t - b.t),
              },
            }))
          }
        >
          Rate key here
        </button>
      </DisclosureGroup>

      <DisclosureGroup title="Light" defaultOpen={false}>
        <label className="edit-field">
          Exposure
          <span className="capture-row">
            <Slider
              aria-label="Exposure"
              min={0.5}
              max={4}
              step={0.05}
              value={shot.light.exposure}
              onChange={(e) => {
                const exposure = e.currentTarget.valueAsNumber;
                edit((s) => ({ ...s, light: { ...s.light, exposure } }));
              }}
            />
            <span className="capture-readout">{shot.light.exposure.toFixed(2)}</span>
          </span>
        </label>
        <label className="edit-field">
          Date
          <input
            type="date"
            value={shot.light.date ?? ''}
            onChange={(e) => {
              const date = e.currentTarget.value || undefined;
              edit((s) => ({ ...s, light: { ...s.light, date } }));
            }}
          />
        </label>
        <SegmentedControl
          label="Sun"
          value={
            shot.light.sun === 'sim' ? 'sim' : shot.light.sun.to === undefined ? 'held' : 'eased'
          }
          options={[
            { value: 'sim', label: 'Sim clock' },
            { value: 'held', label: 'Held' },
            { value: 'eased', label: 'Eased' },
          ]}
          onChange={(mode) =>
            edit((s) => {
              const from = sunAt(s, 0) ?? simStart(s);
              const sun =
                mode === 'sim'
                  ? ('sim' as const)
                  : mode === 'held'
                    ? { from }
                    : { from, to: from - 3600, start: 0, end: s.duration };
              return { ...s, light: { ...s.light, sun } };
            })
          }
        />
        {shot.light.sun !== 'sim' && (
          <>
            <ClockField
              label={shot.light.sun.to === undefined ? 'Sun at' : 'From'}
              value={shot.light.sun.from}
              onChange={(from) =>
                edit((s) => ({
                  ...s,
                  light: { ...s.light, sun: { ...(s.light.sun as object), from } },
                }))
              }
            />
            {shot.light.sun.to !== undefined && (
              <>
                <ClockField
                  label="To"
                  value={shot.light.sun.to}
                  onChange={(to) =>
                    edit((s) => ({
                      ...s,
                      light: { ...s.light, sun: { ...(s.light.sun as { from: number }), to } },
                    }))
                  }
                />
                <NumberField
                  label="Easing from (s)"
                  value={shot.light.sun.start ?? 0}
                  min={0}
                  step={0.1}
                  onChange={(start) =>
                    edit((s) => ({
                      ...s,
                      light: { ...s.light, sun: { ...(s.light.sun as { from: number }), start } },
                    }))
                  }
                />
                <NumberField
                  label="Easing to (s)"
                  value={shot.light.sun.end ?? shot.duration}
                  min={0}
                  step={0.1}
                  onChange={(end) =>
                    edit((s) => ({
                      ...s,
                      light: { ...s.light, sun: { ...(s.light.sun as { from: number }), end } },
                    }))
                  }
                />
              </>
            )}
          </>
        )}
        <p className="capture-readout">
          Sun now {sun === null ? 'with the sim' : clockText(sun).slice(0, 5)}
        </p>
        <JsonField
          label="Visual settings"
          value={shot.light.visual}
          onChange={(visual) =>
            edit((s) => ({
              ...s,
              light: { ...s.light, visual: visual as Record<string, unknown> },
            }))
          }
        />
      </DisclosureGroup>

      <DisclosureGroup title="Format" defaultOpen={false}>
        <SegmentedControl
          label="Format"
          value={format}
          options={formatsOf(shot).map((f) => ({
            value: f,
            label: f === 'landscape' ? '16:9' : '9:16',
          }))}
          onChange={props.setFormat}
        />
        {formatList.map((f) => (
          <Switch
            key={f}
            label={f === 'landscape' ? 'Render 16:9' : 'Render 9:16'}
            checked={!!shot.formats[f]}
            disabled={!!shot.formats[f] && formatsOf(shot).length === 1}
            onChange={(e) => {
              const on = e.currentTarget.checked;
              setFrame(on ? {} : null, f);
              if (!on && f === format) props.setFormat(formatsOf(shot).find((o) => o !== f)!);
            }}
          />
        ))}
        <p className="capture-readout">
          {frame.width} × {frame.height} from a {frame.width} × {frame.canvasHeight} canvas
        </p>
        <NumberField
          label="Canvas height"
          value={frame.canvasHeight}
          min={frame.height}
          step={10}
          onChange={(canvasHeight) => setFrame({ canvasHeight: Math.round(canvasHeight) })}
        />
        <NumberField
          label="Field of view (°)"
          value={frame.fov}
          min={5}
          step={1}
          onChange={(fov) => setFrame({ fov })}
        />
        <NumberField
          label="Title centre (px)"
          value={frame.titleX}
          min={0}
          step={10}
          onChange={(titleX) => setFrame({ titleX })}
        />
        {frame.canvasHeight > frame.height && (
          <>
            <NumberField
              label="Window from (0 top, 1 bottom)"
              value={frame.window?.from ?? 0.5}
              min={0}
              step={0.05}
              onChange={(from) =>
                setFrame({
                  window: { ...(frame.window ?? { from: 0.5, to: 0.5, start: 0, end: 1 }), from },
                })
              }
            />
            <NumberField
              label="Window to"
              value={frame.window?.to ?? 0.5}
              min={0}
              step={0.05}
              onChange={(to) =>
                setFrame({
                  window: { ...(frame.window ?? { from: 0.5, to: 0.5, start: 0, end: 1 }), to },
                })
              }
            />
            <NumberField
              label="Moving from (s)"
              value={frame.window?.start ?? 0}
              min={0}
              step={0.1}
              onChange={(start) =>
                setFrame({
                  window: { ...(frame.window ?? { from: 0.5, to: 0.5, start: 0, end: 1 }), start },
                })
              }
            />
            <NumberField
              label="Moving to (s)"
              value={frame.window?.end ?? 1}
              min={0}
              step={0.1}
              onChange={(end) =>
                setFrame({
                  window: { ...(frame.window ?? { from: 0.5, to: 0.5, start: 0, end: 1 }), end },
                })
              }
            />
          </>
        )}
        <Switch
          label="Own camera keys"
          checked={!!shot.formats[format]?.keys}
          onChange={(e) => setFrame({ keys: e.currentTarget.checked ? shot.keys : undefined })}
        />
        <Switch
          label="Whole canvas"
          checked={props.whole}
          onChange={(e) => props.setWhole(e.currentTarget.checked)}
        />
      </DisclosureGroup>

      <DisclosureGroup title="Title" defaultOpen={false}>
        <Switch
          label="Title"
          checked={!!shot.title}
          onChange={(e) =>
            edit((s) => ({ ...s, title: e.currentTarget.checked ? defaultTitle : null }))
          }
        />
        {shot.title && (
          <TitleFields
            title={shot.title}
            onChange={(change) => edit((s) => ({ ...s, title: { ...s.title!, ...change } }))}
          />
        )}
      </DisclosureGroup>

      <DisclosureGroup title="Layers" defaultOpen={false}>
        <Switch
          label="Show layers"
          checked={props.layersOn}
          onChange={(e) => props.setLayersOn(e.currentTarget.checked)}
        />
        {layerNames.map((name) => (
          <LayerFields key={name} name={name} shot={shot} edit={edit} />
        ))}
      </DisclosureGroup>

      <DisclosureGroup title="Render" defaultOpen={false}>
        <p className="capture-hint">Renders run offline, frame by frame. Save first.</p>
        {commands.map((c) => (
          <div key={c} className="capture-command">
            <code>{c}</code>
            <button onClick={() => void navigator.clipboard.writeText(c)}>Copy</button>
          </div>
        ))}
      </DisclosureGroup>
    </div>
  );
}

function TitleFields({
  title,
  onChange,
}: {
  title: Title;
  onChange: (change: Partial<Title>) => void;
}) {
  return (
    <>
      {(['text', 'subtitle', 'version'] as const).map((field) => (
        <label key={field} className="edit-field">
          {field === 'text' ? 'Title' : field === 'subtitle' ? 'Subtitle' : 'Version'}
          <input
            value={title[field]}
            onChange={(e) => onChange({ [field]: e.currentTarget.value })}
          />
        </label>
      ))}
      <label className="edit-field">
        Colour
        <input
          type="color"
          value={title.colour}
          onChange={(e) => onChange({ colour: e.currentTarget.value })}
        />
      </label>
      <NumberField
        label="Fade in from (s)"
        value={title.fade[0]}
        min={0}
        step={0.1}
        onChange={(a) => onChange({ fade: [a, title.fade[1]] })}
      />
      <NumberField
        label="Fade in to (s)"
        value={title.fade[1]}
        min={0}
        step={0.1}
        onChange={(b) => onChange({ fade: [title.fade[0], b] })}
      />
      <Switch
        label="On the horizon"
        checked={title.y === 'horizon'}
        onChange={(e) => onChange({ y: e.currentTarget.checked ? 'horizon' : 540 })}
      />
      {title.y !== 'horizon' && (
        <NumberField
          label="Baseline (px)"
          value={title.y}
          min={0}
          step={10}
          onChange={(y) => onChange({ y })}
        />
      )}
    </>
  );
}

function LayerFields({
  name,
  shot,
  edit,
}: {
  name: LayerName;
  shot: Shot;
  edit: EditorProps['edit'];
}) {
  const given = shot.layers[name] as Record<string, unknown> | undefined;
  const on = !!given && given.on !== false;
  const defaults = layerDefaults[name] as Record<string, unknown>;
  const set = (next: Record<string, unknown> | undefined) =>
    edit((s) => {
      const layers = { ...s.layers } as Record<string, unknown>;
      if (next) layers[name] = next;
      else delete layers[name];
      return { ...s, layers: layers as Shot['layers'] };
    });
  return (
    <div className="capture-layer">
      <Switch
        label={layerLabels[name]}
        checked={on}
        onChange={(e) => set(e.currentTarget.checked ? { ...given, on: undefined } : undefined)}
      />
      {on && Object.keys(defaults).length > 0 && (
        <div className="capture-params">
          {Object.entries(defaults).map(([key, fallback]) => {
            const value = given?.[key] ?? fallback;
            const change = (v: unknown) => set({ ...given, [key]: v });
            if (typeof fallback === 'boolean')
              return (
                <Switch
                  key={key}
                  label={key}
                  checked={value as boolean}
                  onChange={(e) => change(e.currentTarget.checked)}
                />
              );
            if (typeof fallback === 'number')
              return (
                <NumberField
                  key={key}
                  label={key}
                  value={value as number}
                  step={0.1}
                  onChange={change}
                />
              );
            return <JsonField key={key} label={key} value={value} onChange={change} />;
          })}
        </div>
      )}
    </div>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  step,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  step?: number;
}) {
  return (
    <label className="edit-field">
      {label}
      <input
        type="number"
        key={value}
        defaultValue={value}
        min={min}
        step={step}
        onBlur={(e) => {
          const next = e.currentTarget.valueAsNumber;
          if (Number.isFinite(next) && next !== value && (min === undefined || next >= min))
            onChange(next);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  );
}

function ClockField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (s: number) => void;
}) {
  return (
    <TextField
      label={label}
      value={clockText(value, true)}
      check={(text) => parseClock(text) !== undefined}
      onChange={(text) => onChange(parseClock(text)!)}
    />
  );
}

function JsonField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  return (
    <TextField
      label={label}
      value={JSON.stringify(value)}
      check={(text) => {
        try {
          JSON.parse(text);
          return true;
        } catch {
          return false;
        }
      }}
      onChange={(text) => onChange(JSON.parse(text))}
    />
  );
}

/** A text field that commits on blur or Enter when `check` passes, and marks a bad entry. */
function TextField({
  label,
  value,
  check,
  onChange,
}: {
  label: string;
  value: string;
  check: (text: string) => boolean;
  onChange: (text: string) => void;
}) {
  const [bad, setBad] = useState(false);
  return (
    <label className="edit-field">
      {label}
      <input
        key={value}
        defaultValue={value}
        aria-invalid={bad || undefined}
        onBlur={(e) => {
          const text = e.currentTarget.value;
          const ok = check(text);
          setBad(!ok);
          if (ok && text !== value) onChange(text);
        }}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  );
}

/** The 3D canvas at the shot's canvas size, scaled into the map view, with the frame's window
 * and the title drawn over it. */
function Preview({
  shot,
  format,
  t,
  whole,
  stage,
}: {
  shot: Shot;
  format: FormatName;
  t: number;
  whole: boolean;
  stage: Stage;
}): ReactNode {
  const overlay = useRef<HTMLCanvasElement>(null);
  const host = document.querySelector<HTMLElement>('.map-view');
  const [size, setSize] = useState({ w: 1, h: 1 });
  useLayoutEffect(() => {
    if (!host) return;
    const observer = new ResizeObserver(() =>
      setSize({ w: host.clientWidth, h: host.clientHeight }),
    );
    observer.observe(host);
    const app = host.closest('.app')!;
    app.classList.add('capture-framed');
    return () => {
      observer.disconnect();
      app.classList.remove('capture-framed');
      for (const v of [
        '--capture-w',
        '--capture-h',
        '--capture-left',
        '--capture-top',
        '--capture-scale',
      ])
        host.style.removeProperty(v);
    };
  }, [host]);
  const frame = frameOf(shot, format);
  const top = Math.round(windowTop(frame, t));
  const rows = whole ? frame.canvasHeight : frame.height;
  const pad = 16;
  const scale = Math.min((size.w - pad * 2) / frame.width, (size.h - pad * 2) / rows);
  const left = (size.w - frame.width * scale) / 2;
  const frameTop = (size.h - rows * scale) / 2;
  const canvasTop = frameTop - (whole ? 0 : top * scale);
  useLayoutEffect(() => {
    if (!host) return;
    host.style.setProperty('--capture-w', `${frame.width}px`);
    host.style.setProperty('--capture-h', `${frame.canvasHeight}px`);
    host.style.setProperty('--capture-left', `${left}px`);
    host.style.setProperty('--capture-top', `${canvasTop}px`);
    host.style.setProperty('--capture-scale', String(scale));
  }, [host, frame.width, frame.canvasHeight, left, canvasTop, scale]);
  useEffect(() => {
    const canvas = overlay.current;
    if (!canvas) return;
    const dpr = devicePixelRatio;
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    const g = canvas.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    // The matte: everything outside the video's window.
    const windowY = canvasTop + top * scale;
    const windowH = frame.height * scale;
    g.fillStyle = whole ? 'rgba(20, 22, 26, 0.55)' : 'rgb(20, 22, 26)';
    g.fillRect(0, 0, size.w, windowY);
    g.fillRect(0, windowY + windowH, size.w, size.h - windowY - windowH);
    g.fillRect(0, windowY, left, windowH);
    g.fillRect(left + frame.width * scale, windowY, size.w, windowH);
    g.strokeStyle = 'rgba(255, 255, 255, 0.7)';
    g.lineWidth = 1;
    g.strokeRect(left - 0.5, windowY - 0.5, frame.width * scale + 1, windowH + 1);
    g.save();
    g.beginPath();
    g.rect(left, windowY, frame.width * scale, windowH);
    g.clip();
    g.setTransform(dpr * scale, 0, 0, dpr * scale, left * dpr, windowY * dpr);
    stage.drawTitle(g, t);
    g.restore();
  });
  if (!host) return null;
  return createPortal(
    <canvas ref={overlay} className="capture-overlay" aria-hidden="true" />,
    host,
  );
}
