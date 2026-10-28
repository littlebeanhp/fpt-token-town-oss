'use client';
import { useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  ChevronRight,
  Cpu,
  House,
  List,
  Moon,
  Pause,
  Play,
  Sun,
  Sunrise,
  Sunset,
} from 'lucide-react';
import { formatCompact, gpuFarm, hubStop, models, stops, townHost } from '@/data/models';
import { LOAD_STAGES, stageIndex, stageProgress } from '@/data/loading';
import { DEFAULT_SPEED, START_HOURS, formatClock, nextSpeed, phaseAt } from '@/data/clock';
import type { ClockState, DayPhase, DayPreset, StopId } from '@/types/factory';
import type { Experience } from '@/experience/core/Experience';
import { CityDirectory } from './CityDirectory';
import { useTownPresence } from '@/hooks/useTownPresence';
import { useLoadingStages } from '@/hooks/useLoadingStages';

const phaseIcons: Record<DayPhase, typeof Sun> = {
  dawn: Sunrise,
  day: Sun,
  dusk: Sunset,
  night: Moon,
};
const presets: { id: DayPreset; label: string; Icon: typeof Sun }[] = [
  { id: 'day', label: 'Day mode', Icon: Sun },
  { id: 'dusk', label: 'Dusk mode', Icon: Sunset },
  { id: 'night', label: 'Night mode', Icon: Moon },
];
const initialClock: ClockState = {
  hours: START_HOURS,
  phase: phaseAt(START_HOURS),
  night: false,
  paused: false,
  speed: DEFAULT_SPEED,
};

const AUTO_TOUR_MS = 15_000;

export function TokenTown() {
  const panel = useRef<HTMLElement>(null);
  const [panelHeight, setPanelHeight] = useState(250);
  const host = useRef<HTMLDivElement>(null),
    labels = useRef<HTMLDivElement>(null),
    experience = useRef<Experience | null>(null);
  const [selected, setSelected] = useState<StopId>(hubStop.id);
  const [clock, setClock] = useState<ClockState>(initialClock);
  const [preview, setPreview] = useState(false);
  const [ready, setReady] = useState(false),
    [error, setError] = useState('');
  const [directory, setDirectory] = useState(false),
    [retry, setRetry] = useState(0);
  const stopIndex = Math.max(
    stops.findIndex((stop) => stop.id === selected),
    0,
  );
  // Every stop is a model district now, so the panel always has a full definition to read.
  const stop = stops[stopIndex];
  const people = useTownPresence();
  const PhaseIcon = phaseIcons[clock.phase];
  const loading = useLoadingStages(ready);
  const chapter = loading.stage ? LOAD_STAGES[stageIndex(loading.stage)] : null;

  useEffect(() => {
    if (!panel.current) return;
    const observer = new ResizeObserver(([entry]) =>
      setPanelHeight(entry.target.getBoundingClientRect().height),
    );
    observer.observe(panel.current);
    return () => observer.disconnect();
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    let instance: Experience | undefined;
    setReady(false);
    setPreview(false);
    setSelected(hubStop.id);
    setError('');
    loading.reset();
    import('@/experience/core/Experience')
      .then(({ Experience }) => {
        if (cancelled || !host.current || !labels.current) return;
        instance = new Experience(host.current, labels.current, {
          onPreview: () => setPreview(true),
          onStage: loading.push,
          onSelect: setSelected,
          onClock: setClock,
          onReady: () => setReady(true),
          onError: (message) => {
            setReady(false);
            setError(message);
          },
        });
        experience.current = instance;
        void instance.init();
      })
      .catch(() => {
        if (!cancelled) setError('The city could not load. Please try again.');
      });
    return () => {
      cancelled = true;
      instance?.dispose();
      experience.current = null;
    };
  }, [retry]);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (directory || event.altKey || event.ctrlKey || event.metaKey) return;
      if (
        (event.target as HTMLElement | null)?.closest('input, textarea, select, [contenteditable]')
      )
        return;
      if (event.key === 'ArrowRight') experience.current?.step(1);
      else if (event.key === 'ArrowLeft') experience.current?.step(-1);
      else if (event.key === 'Escape' || event.key === 'Home')
        experience.current?.select(hubStop.id);
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [directory]);
  // Idle tour: if nobody changes the stop for 15s, move on to the next district. Any selection
  // (manual or automatic) changes `selected`, which restarts the timer.
  useEffect(() => {
    if (!ready || directory) return;
    const timer = window.setTimeout(() => experience.current?.step(1), AUTO_TOUR_MS);
    return () => window.clearTimeout(timer);
  }, [selected, ready, directory]);
  const select = (id: StopId) => experience.current?.select(id);
  const step = (direction: 1 | -1) => experience.current?.step(direction);

  return (
    <main
      className={`town ${clock.night ? 'night' : ''}`}
      style={{ '--panel-height': `${panelHeight}px` } as React.CSSProperties}
    >
      <section className="city-stage" aria-label="AI factory city">
        <div className="scene-host" ref={host} />
        <div className="scene-scrim" aria-hidden />
        <div className="scene-labels" ref={labels} aria-hidden={!ready}>
          {models.map((item, index) => (
            <button
              key={item.id}
              data-stop={item.id}
              className="factory-label"
              onClick={() => select(item.id)}
              tabIndex={selected === item.id || !ready ? -1 : 0}
              style={{ '--model-color': item.color } as React.CSSProperties}
            >
              <img className="label-mark" src={`/logos/${item.logo}-mono.svg`} alt="" />
              {item.name}
              <ChevronRight size={11} />
              <small>0{index + 1}</small>
            </button>
          ))}
          {/* Hangs over the guide outside the speech studio; the city places it every frame. */}
          <a
            className="host-badge"
            data-host-link
            href={townHost.link}
            target="_blank"
            rel="noreferrer"
            title={townHost.label}
            aria-label={townHost.label}
            tabIndex={ready ? 0 : -1}
          >
            <strong aria-hidden>!</strong>
            <span aria-hidden>{townHost.text}</span>
          </a>
        </div>

        <div className="town-brand" data-overlay>
          <span className="town-emblem">✦</span>
          <div>
            <h1>FPT Token Town</h1>
            <p>We visualize the user and usage in FPT Token Factory.</p>
          </div>
        </div>
        <a
          className="platform-link"
          href="https://neo.fpt.ai/dng-org/dng-workspace/serverless-inference/models"
          target="_blank"
          rel="noreferrer"
          data-overlay
        >
          Access our platform <ArrowUpRight size={12} />
        </a>
        <nav className="tour-nav" aria-label="City tour" data-overlay>
          <button
            className="tour-step"
            aria-label="Previous stop"
            disabled={!ready}
            onClick={() => step(-1)}
          >
            <ArrowLeft size={16} /> <span>Previous</span>
          </button>
          <span className="tour-count" aria-label={`Stop ${stopIndex + 1} of ${stops.length}`}>
            <strong>{stopIndex + 1}</strong> / {stops.length}
          </span>
          <button
            className="tour-step"
            aria-label="Next stop"
            disabled={!ready}
            onClick={() => step(1)}
          >
            <span>Next</span> <ArrowRight size={16} />
          </button>
          <button
            className="home-button"
            title={`Return to the hub, ${hubStop.name}`}
            aria-label="Return to the hub"
            disabled={!ready || selected === hubStop.id}
            onClick={() => select(hubStop.id)}
          >
            <House size={16} />
          </button>
        </nav>

        <aside
          ref={panel}
          className="model-panel"
          key={stop.id}
          aria-label={`${stop.name} details`}
          data-overlay
        >
          <div className="panel-heading">
            <span className="model-emblem" style={{ borderColor: stop.color }}>
              <img src={`/logos/${stop.logo}.svg`} alt="" width={24} height={24} />
            </span>
            <div>
              <span className="model-category">{stop.category}</span>
              <h2>{stop.name}</h2>
            </div>
            {stop.cachedRate !== undefined && (
              <span className="cached-badge" title="Illustrative cached rate">
                Cached rate: {stop.cachedRate}%
              </span>
            )}
          </div>
          <div className="usage-summary">
            <strong>{formatCompact(stop.usage)}</strong>
            <span>{stop.unit} this week</span>
          </div>
          <dl className="model-stats">
            <div>
              <dt>Context length</dt>
              <dd>{stop.contextLength ?? 'None'}</dd>
            </div>
            <div>
              <dt>Price</dt>
              <dd>
                {stop.price ?? 'Not available'}
                {stop.priceUnit && <small className="price-unit">{stop.priceUnit}</small>}
              </dd>
            </div>
          </dl>
          <div className="panel-footer">
            <span>
              <span className={`status-dot${people === null ? ' status-pending' : ''}`} />
              People in town: {people === null ? '—' : people.toLocaleString('en-US')}
            </span>
            <span className="panel-actions">
              <button onClick={() => setDirectory(true)} aria-label="Open city directory">
                <List size={14} /> Directory
              </button>
              <a href={gpuFarm.link} target="_blank" rel="noreferrer">
                {gpuFarm.label} <ArrowUpRight size={14} />
              </a>
            </span>
          </div>
        </aside>
        <div className="clock" role="group" aria-label="City time-lapse" data-overlay>
          <span className="clock-readout" title="City time">
            <PhaseIcon size={15} />
            <strong>{formatClock(clock.hours)}</strong>
            <span className="clock-phase">{clock.phase}</span>
          </span>
          <span className="clock-divider" />
          <div className="clock-presets">
            {presets.map(({ id, label, Icon }) => (
              <button
                key={id}
                className={clock.phase === id ? 'active' : ''}
                aria-label={label}
                aria-pressed={clock.phase === id}
                title={label}
                disabled={!ready}
                onClick={() => experience.current?.jumpTo(id)}
              >
                <Icon size={15} />
              </button>
            ))}
          </div>
          <span className="clock-divider" />
          <button
            className="clock-play"
            aria-label={clock.paused ? 'Play time-lapse' : 'Pause time-lapse'}
            title={clock.paused ? 'Play time-lapse' : 'Pause time-lapse'}
            disabled={!ready}
            onClick={() => experience.current?.setClockPaused(!clock.paused)}
          >
            {clock.paused ? <Play size={15} /> : <Pause size={15} />}
          </button>
          <button
            className="clock-speed"
            aria-label={`Time-lapse speed ${clock.speed}x`}
            title="Change time-lapse speed"
            disabled={!ready}
            onClick={() => experience.current?.setClockSpeed(nextSpeed(clock.speed))}
          >
            {clock.speed}x
          </button>
        </div>

        {(loading.visible || error) && (
          <div
            className="loading-screen"
            role="status"
            aria-busy={!error}
            data-preview={preview ? 'ready' : undefined}
            data-stage={loading.stage ?? undefined}
          >
            {error ? (
              <>
                <Cpu size={28} />
                <h2>City temporarily offline</h2>
                <p>{error}</p>
                <button className="primary-button" onClick={() => setRetry((value) => value + 1)}>
                  Retry connection
                </button>
              </>
            ) : (
              <>
                <div className="loading-cube" />
                <strong className="loading-title">Loading FPT Token Town</strong>
                <span className="loading-stage" key={loading.stage ?? 'start'}>
                  {chapter?.label ?? 'Starting up'}
                </span>
                <div
                  className="loading-bar"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={LOAD_STAGES.length + 1}
                  aria-valuenow={loading.stage ? stageIndex(loading.stage) + 1 : 0}
                  aria-label="City loading progress"
                >
                  <span style={{ width: `${stageProgress(loading.stage) * 100}%` }} />
                </div>
                <small>{chapter?.note ?? 'FPT AI TOKEN FACTORY'}</small>
              </>
            )}
          </div>
        )}

        <div className="orbit-hint">Drag to look around · ← → to change buildings</div>
      </section>
      <div className="sr-only" aria-live="polite">
        {`${stop.name} in focus, stop ${stopIndex + 1} of ${stops.length}`}
      </div>
      {directory && (
        <CityDirectory
          selected={selected}
          onSelect={(id) => select(id)}
          onClose={() => setDirectory(false)}
        />
      )}
    </main>
  );
}
