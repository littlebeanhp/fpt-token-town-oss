import {
  ACESFilmicToneMapping,
  Box3,
  Raycaster,
  Scene,
  Sphere,
  Vector2,
  Vector3,
  WebGPURenderer,
  type Object3D,
} from 'three/webgpu';
import { gsap } from 'gsap';
import { PRESET_HOURS, formatClock, hoursUntil, phaseAt, wrapHours } from '@/data/clock';
import { crowdLoad, hubStop, models, stops as stopDefinitions, townHost } from '@/data/models';
import type {
  DayPreset,
  ExperienceCallbacks,
  FactoryAsset,
  FactoryId,
  LoadStage,
  ModelDefinition,
  StopId,
} from '@/types/factory';
import { CameraRig, createShot, type Shot } from '../camera/CameraRig';
import { FocusEffect } from '../effects/FocusEffect';
import type { TokenSimulation } from '../simulation/TokenSimulation';
import { City } from '../world/City';
import { CityClock, createLightingSample, sampleLighting } from '../world/CityClock';
import type { Crowd } from '../world/Crowd';
import type { QueueBarriers } from '../world/QueueBarriers';
import { Factory } from '../world/Factory';
import { Lighting } from '../world/Lighting';
import type { Traffic } from '../world/Traffic';
import { blockKeyAt } from '../world/layout';
import { BACKGROUND_EMPHASIS } from './emphasis';
import { AdaptiveResolution, renderPixelRatio } from './RenderQuality';

interface Stop {
  definition: ModelDefinition;
  asset: FactoryAsset;
  shot: Shot;
  label: HTMLElement | null;
  /** Rendered tag size in pixels, refreshed with the overlay boxes. */
  labelSize: [number, number];
}

const EMPHASIS_SECONDS = 1.45;
/** Minimum space, in pixels, between a neighbour tag and the frame edge or an overlay. */
const LABEL_GAP = 12;
/** Yield after startup work so the browser can present the preview and handle input. */
const yieldToBrowser = () =>
  new Promise<void>((resolve) => {
    if (document.hidden) setTimeout(resolve, 0);
    else requestAnimationFrame(() => setTimeout(resolve, 0));
  });

export class Experience {
  private readonly scene = new Scene();
  private readonly renderer = new WebGPURenderer({
    antialias: true,
    powerPreference: 'high-performance',
  });
  private readonly rig: CameraRig;
  private readonly lighting: Lighting;
  private city?: City;
  private crowd?: Crowd;
  private queueBarriers?: QueueBarriers;
  private traffic?: Traffic;
  private effects?: FocusEffect;
  private simulation?: TokenSimulation;
  private factories: Factory[] = [];
  private stops: Stop[] = [];
  private colliders: Object3D[] = [];
  private owners = new Map<Object3D, StopId>();
  private keyToStop = new Map<number, StopId>();
  private emphasis = Object.fromEntries(stopDefinitions.map((stop) => [stop.id, 1])) as Record<
    StopId,
    number
  >;
  private emphasisDirty = true;
  private emphasisTween?: gsap.core.Tween;
  private raycaster = new Raycaster();
  private pointer = new Vector2();
  private pointerDown = new Vector2();
  private dragPointer: number | null = null;
  private dragX = 0;
  private dragged = false;
  private projected = new Vector3();
  private hostBadge: HTMLElement | null;
  private hostSize: [number, number] = [0, 0];
  private overlays: [number, number, number, number][] = [];
  private selectedIndex = 0;
  private disposed = false;
  private ready = false;
  private previewReady = false;
  private rendererInitialized = false;
  private width = 1;
  private height = 1;
  private previous = 0;
  private elapsed = 0;
  private crowdElapsed = 0;
  private crowdRenderedAt = -1;
  private frame = 0;
  private quality = new AdaptiveResolution();
  private reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  private clock = new CityClock(undefined, this.reduced);
  private clockTween?: gsap.core.Tween;
  private sample = createLightingSample();
  private appliedNight = -1;
  private reported = { step: -1, night: false, paused: false, speed: 0 };
  private observer: ResizeObserver;

  constructor(
    private container: HTMLElement,
    private labelContainer: HTMLElement,
    private callbacks: ExperienceCallbacks,
  ) {
    const canvas = this.renderer.domElement;
    canvas.setAttribute('aria-label', 'Interactive FPT AI city');
    canvas.setAttribute('role', 'img');
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
    this.renderer.onDeviceLost = () => {
      if (!this.disposed) {
        this.renderer.setAnimationLoop(null);
        this.callbacks.onError(
          'The graphics device was disconnected. Retry to reconnect the city.',
        );
      }
    };
    container.appendChild(canvas);
    this.rig = new CameraRig(canvas);
    this.hostBadge = labelContainer.querySelector<HTMLElement>('[data-host-link]');
    this.lighting = new Lighting(this.scene, this.renderer);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(container);
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointercancel', this.onPointerCancel);
    canvas.addEventListener('lostpointercapture', this.onPointerCancel);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** Announces a startup chapter to the loading overlay and to the browser checks. */
  private stage(stage: LoadStage) {
    this.renderer.domElement.dataset.stage = stage;
    this.callbacks.onStage?.(stage);
  }

  async init() {
    try {
      // Downloads start before the graphics device is ready: the optional modules, the five
      // district houses and the two character files all travel while the renderer initialises,
      // instead of queueing up behind the first city view.
      const crowdModule = import('../world/Crowd');
      void crowdModule.then(({ Crowd }) => Crowd.preload()).catch(() => {});
      const houses = new Set(models.flatMap((model) => (model.assetUrl ? [model.assetUrl] : [])));
      if (houses.size)
        void import('../loaders/GLTFFactoryAsset')
          .then(({ preloadHouses }) => preloadHouses(houses))
          .catch(() => {});
      const modules = Promise.all([
        crowdModule,
        import('../world/QueueBarriers'),
        import('../world/Traffic'),
        import('../simulation/CPUTokenSimulation'),
      ]);
      this.stage('renderer');
      await this.renderer.init();
      this.rendererInitialized = true;
      if (this.disposed) {
        this.renderer.dispose();
        this.rendererInitialized = false;
        return;
      }
      this.stage('city');
      // The hub district is built before the preview so the first frame already shows the
      // centre of the city; the six outer districts stream in afterwards.
      const hub = await Factory.create(hubStop);
      if (this.disposed) {
        hub.dispose();
        return;
      }
      this.factories.push(hub);
      this.addStop(hubStop, hub.asset);
      this.city = new City();
      this.scene.add(this.city.root);
      this.resize();
      this.rig.focus(this.stops[0].shot, true);
      this.updateLighting(true);
      this.city.applyEmphasis((key) =>
        key === blockKeyAt(hubStop.position[0], hubStop.position[2]) ? 1 : BACKGROUND_EMPHASIS,
      );
      this.effects = new FocusEffect(this.renderer, this.scene, this.rig.camera);
      this.effects.update(this.rig.target, this.stops[0].shot.radius, 0);
      this.effects.render();
      this.previewReady = true;
      this.renderer.domElement.dataset.preview = 'ready';
      // Keep the preview responsive while optional chunks, objects, and shaders are prepared.
      this.renderer.setAnimationLoop(document.hidden ? null : this.animate);
      this.callbacks.onPreview?.();
      // Let the first city view paint before preparing animated props and the other stops.
      await yieldToBrowser();
      if (this.disposed) return;
      const backdropReady = Promise.all([this.city.loadTrees(), this.city.loadStreetProps()]);
      const [{ Crowd }, { QueueBarriers }, { Traffic }, { CPUTokenSimulation }] = await modules;
      if (this.disposed) return;
      this.stage('districts');
      for (const model of models) {
        if (model === hubStop) continue;
        const factory = await Factory.create(model);
        if (this.disposed) {
          factory.dispose();
          return;
        }
        this.factories.push(factory);
        this.addStop(model, factory.asset);
        await yieldToBrowser();
        if (this.disposed) return;
      }
      this.stage('backdrop');
      await backdropReady;
      if (this.disposed) return;
      this.stage('crowd');
      const crowdSites = this.stops.map(({ definition, asset }) => {
        const door = asset.getAnchor('Doorway', new Vector3());
        return {
          x: definition.position[0],
          z: definition.position[2],
          front: new Box3().setFromObject(asset.root).max.z,
          door: { x: door.x, z: door.z },
          // Busier models draw longer lines and keep more runners on the circuit.
          load: crowdLoad(definition.usage),
          color: definition.color,
          host: definition.id === townHost.stop,
        };
      });
      this.crowd = await Crowd.create(crowdSites);
      this.queueBarriers = new QueueBarriers(crowdSites);
      await yieldToBrowser();
      if (this.disposed) return;
      this.simulation = new CPUTokenSimulation(this.factories);
      this.traffic = new Traffic(undefined, this.crowd.createGrabRiderParts());
      this.traffic.update(0, this.reduced);
      this.scene.add(
        this.crowd.root,
        this.queueBarriers.root,
        this.simulation.root,
        this.traffic.root,
      );
      this.ready = true;
      this.resize();
      this.select(hubStop.id, true);
      this.updateLighting(true);
      this.applyEmphasis();
      this.crowd.update(0);
      this.stage('shaders');
      await this.renderer.compileAsync(this.scene, this.rig.camera);
      if (this.disposed) return;
      const backend = 'isWebGPUBackend' in this.renderer.backend ? 'WebGPU' : 'WebGL2';
      this.renderer.domElement.dataset.backend = backend;
      this.callbacks.onReady(backend);
    } catch (error) {
      if (!this.disposed) {
        console.error(error);
        this.callbacks.onError(
          'The 3D city could not start. Try a browser with WebGPU or WebGL2 enabled.',
        );
      }
    }
  }

  private addStop(definition: ModelDefinition, asset: FactoryAsset) {
    asset.root.updateMatrixWorld(true);
    const [x, , z] = definition.position;
    const anchor = asset.getAnchor('CameraTarget', new Vector3());
    const bounds = new Box3().setFromObject(asset.root).getBoundingSphere(new Sphere());
    const key = blockKeyAt(x, z);
    this.stops.push({
      definition,
      asset,
      label: this.labelContainer.querySelector<HTMLElement>(`[data-stop="${definition.id}"]`),
      labelSize: [0, 0],
      shot: createShot(definition.position, anchor.y, bounds.radius),
    });
    this.keyToStop.set(key, definition.id);
    this.scene.add(asset.root);
    for (const collider of asset.colliders) {
      this.colliders.push(collider);
      this.owners.set(collider, definition.id);
    }
  }

  get selected() {
    return this.stops[this.selectedIndex]?.definition.id ?? hubStop.id;
  }
  select(id: StopId, immediate = false) {
    if (!this.ready) return;
    const index = this.stops.findIndex((stop) => stop.definition.id === id);
    if (index < 0) return;
    this.selectedIndex = index;
    const stop = this.stops[index];
    const facadeBounds = new Box3().setFromObject(stop.asset.root);
    this.lighting.setFacade(
      stop.definition.position[0],
      facadeBounds.min.y + (facadeBounds.max.y - facadeBounds.min.y) * 0.35,
      facadeBounds.max.z + 0.08,
    );
    for (let index = 0; index < 2; index++) {
      const window = stop.asset.root.getObjectByName(`WindowSpill${index}`);
      if (window) this.lighting.setWindowPosition(index, window.getWorldPosition(new Vector3()));
    }
    this.rig.focus(stop.shot, immediate);
    this.traffic?.setFocus(stop.definition.position[0], stop.definition.position[2]);
    this.emphasisTween?.kill();
    const targets = Object.fromEntries(
      this.stops.map(({ definition }) => [
        definition.id,
        definition.id === id ? 1 : BACKGROUND_EMPHASIS,
      ]),
    );
    this.emphasisTween = gsap.to(this.emphasis, {
      ...targets,
      duration: immediate || this.reduced ? 0 : EMPHASIS_SECONDS,
      ease: 'power2.inOut',
      onUpdate: () => {
        this.emphasisDirty = true;
      },
    });
    this.emphasisDirty = true;
    this.renderer.domElement.dataset.selected = id;
    this.callbacks.onSelect(id);
  }
  /** Moves along the tour; the ends wrap so the city can be browsed in a loop. */
  step(direction: 1 | -1) {
    if (!this.ready) return;
    const count = this.stops.length;
    this.select(this.stops[(this.selectedIndex + direction + count) % count].definition.id);
  }

  setClockPaused(paused: boolean) {
    this.clock.paused = paused;
    this.emitClock(true);
  }
  setClockSpeed(speed: number) {
    this.clock.speed = speed;
    this.emitClock(true);
  }
  /** Moves the clock forward to a preset and holds it there until play is pressed. */
  jumpTo(preset: DayPreset) {
    this.clockTween?.kill();
    this.clock.paused = true;
    const start = this.clock.hours;
    const span = hoursUntil(start, PRESET_HOURS[preset]);
    const canvas = this.renderer.domElement;
    if (this.reduced || span < 0.01) {
      this.clock.hours = PRESET_HOURS[preset];
      this.clockTween = undefined;
      this.emitClock(true);
      return;
    }
    const state = { progress: 0 };
    canvas.dataset.lighting = 'transition';
    this.clockTween = gsap.to(state, {
      progress: 1,
      duration: Math.min(1.1 + span * 0.08, 2.4),
      ease: 'power2.inOut',
      onUpdate: () => {
        this.clock.hours = wrapHours(start + span * state.progress);
      },
      onComplete: () => {
        this.clockTween = undefined;
        this.emitClock(true);
      },
    });
    this.emitClock(true);
  }

  private updateLighting(force = false) {
    sampleLighting(this.clock.hours, this.sample);
    this.lighting.apply(this.sample, this.rig.target);
    this.lighting.setFogRange(this.rig.distance);
    if (force || Math.abs(this.sample.night - this.appliedNight) > 0.002) {
      this.appliedNight = this.sample.night;
      const value = this.sample.night;
      this.city?.setNight(value);
      this.traffic?.setNight(value);
      this.simulation?.setNight(value);
      for (const stop of this.stops) stop.asset.setNight(value);
    }
    if (!this.clockTween) this.renderer.domElement.dataset.lighting = phaseAt(this.clock.hours);
    this.emitClock(force);
  }
  private emitClock(force = false) {
    const hours = this.clock.hours;
    const night = this.sample.night > 0.5;
    // Report in five-minute steps so React re-renders a few times per second at most.
    const step = Math.floor(hours * 12);
    const reported = this.reported;
    if (
      !force &&
      step === reported.step &&
      night === reported.night &&
      this.clock.paused === reported.paused &&
      this.clock.speed === reported.speed
    )
      return;
    reported.step = step;
    reported.night = night;
    reported.paused = this.clock.paused;
    reported.speed = this.clock.speed;
    this.renderer.domElement.dataset.clock = formatClock(hours);
    this.callbacks.onClock({
      hours,
      phase: phaseAt(hours),
      night,
      paused: this.clock.paused,
      speed: this.clock.speed,
    });
  }

  private emphasisForKey = (key: number) => {
    const id = this.keyToStop.get(key);
    return id ? this.emphasis[id] : BACKGROUND_EMPHASIS;
  };
  private applyEmphasis() {
    this.emphasisDirty = false;
    for (const stop of this.stops) stop.asset.setEmphasis(this.emphasis[stop.definition.id]);
    for (const factory of this.factories) {
      const id: FactoryId = factory.model.id;
      // The hub routes every lane, so all lanes stay readable while it is in focus.
      this.simulation?.setEmphasis(id, Math.max(this.emphasis[id], this.emphasis[hubStop.id]));
    }
    this.city?.applyEmphasis(this.emphasisForKey);
    this.crowd?.applyEmphasis(this.emphasisForKey);
    this.queueBarriers?.applyEmphasis(this.emphasisForKey);
    this.traffic?.applyEmphasis(this.emphasisForKey);
  }

  private resize = () => {
    this.width = this.container.clientWidth;
    this.height = this.container.clientHeight;
    if (!this.width || !this.height || this.disposed) return;
    this.renderer.setPixelRatio(
      renderPixelRatio(window.devicePixelRatio, this.width, this.height, this.quality.scale),
    );
    this.renderer.setSize(this.width, this.height);
    this.rig.resize(this.width, this.height);
  };
  private pick(event: PointerEvent) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.rig.camera);
    const hit = this.raycaster.intersectObjects(this.colliders, false)[0];
    return hit ? (this.owners.get(hit.object) ?? null) : null;
  }
  private onPointerDown = (event: PointerEvent) => {
    if (event.button !== 0 || !this.ready || this.rig.transitioning || this.dragPointer !== null)
      return;
    this.dragPointer = event.pointerId;
    this.dragX = event.clientX;
    this.dragged = false;
    this.pointerDown.set(event.clientX, event.clientY);
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };
  private onPointerCancel = () => {
    this.dragPointer = null;
    this.renderer.domElement.style.cursor = 'grab';
  };
  private onPointerUp = (event: PointerEvent) => {
    if (event.pointerId !== this.dragPointer || !this.ready) return;
    this.dragPointer = null;
    this.renderer.domElement.releasePointerCapture(event.pointerId);
    const dx = event.clientX - this.pointerDown.x,
      dy = event.clientY - this.pointerDown.y;
    if (!this.dragged && Math.hypot(dx, dy) < 6) {
      const id = this.pick(event);
      if (id && id !== this.selected) this.select(id);
    }
  };
  private onPointerMove = (event: PointerEvent) => {
    if (event.pointerId === this.dragPointer) {
      if (Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y) > 6)
        this.dragged = true;
      if (this.dragged) {
        this.rig.orbitBy(-(event.clientX - this.dragX) * 0.002);
        this.renderer.domElement.style.cursor = 'grabbing';
        this.updateLabels();
      }
      this.dragX = event.clientX;
      return;
    }
    if (event.buttons || !this.ready) return;
    const id = this.pick(event);
    this.renderer.domElement.style.cursor = id && id !== this.selected ? 'pointer' : 'grab';
  };
  private onVisibility = () => {
    this.previous = 0;
    this.quality.reset();
    if (this.previewReady && !this.disposed)
      this.renderer.setAnimationLoop(document.hidden ? null : this.animate);
  };

  private animate = (now: number) => {
    if (this.disposed) return;
    const frameDelta = this.previous ? (now - this.previous) / 1000 : 0;
    const delta = Math.min(frameDelta, 0.05);
    if (this.quality.sample(frameDelta)) this.resize();
    this.previous = now;
    const motionDelta = this.reduced ? 0 : delta * this.clock.speed;
    this.elapsed += motionDelta;
    if (!this.reduced) this.crowdElapsed += delta;
    if (!this.clockTween) this.clock.advance(delta);
    this.updateLighting();
    if (this.emphasisDirty) this.applyEmphasis();
    this.traffic?.update(delta, this.reduced, this.clock.speed);
    this.simulation?.update(motionDelta, this.elapsed);
    if (this.crowd && this.crowdElapsed !== this.crowdRenderedAt) {
      this.crowdRenderedAt = this.crowdElapsed;
      this.crowd.update(this.crowdElapsed);
    }
    const stop = this.stops[this.selectedIndex];
    this.effects?.update(this.rig.target, stop.shot.radius, delta);
    this.effects?.render();
    if (this.frame % 2 === 0) this.updateLabels();
    this.frame++;
  };
  /**
   * Stage-relative boxes of the HTML overlays marked `data-overlay` (hero, panel, controls).
   * Re-read while the camera moves and twice a second otherwise, so React updates are seen.
   */
  private refreshOverlays() {
    const stage = this.container.parentElement;
    if (!stage) return;
    const origin = stage.getBoundingClientRect();
    this.overlays.length = 0;
    stage.querySelectorAll<HTMLElement>('[data-overlay]').forEach((element) => {
      const rect = element.getBoundingClientRect();
      if (rect.width && rect.height)
        this.overlays.push([
          rect.left - origin.left - LABEL_GAP,
          rect.top - origin.top - LABEL_GAP,
          rect.right - origin.left + LABEL_GAP,
          rect.bottom - origin.top + LABEL_GAP,
        ]);
    });
    for (const stop of this.stops)
      if (stop.label) stop.labelSize = [stop.label.offsetWidth, stop.label.offsetHeight];
    if (this.hostBadge) this.hostSize = [this.hostBadge.offsetWidth, this.hostBadge.offsetHeight];
  }
  /** True while a tag at this stage-relative box would cover an HTML overlay. */
  private coversOverlay(left: number, top: number, right: number, bottom: number) {
    for (const [x1, y1, x2, y2] of this.overlays)
      if (left < x2 && right > x1 && top < y2 && bottom > y1) return true;
    return false;
  }
  /** Neighbour tags follow their buildings, never covering the frame edge or an overlay. */
  private updateLabels() {
    if (this.rig.transitioning || this.frame % 30 === 0) this.refreshOverlays();
    for (let index = 0; index < this.stops.length; index++) {
      const stop = this.stops[index];
      if (!stop.label) continue;
      stop.asset.getAnchor('UIAnchor', this.projected).project(this.rig.camera);
      const { x, y, z } = this.projected;
      const px = (x * 0.5 + 0.5) * this.width,
        py = (-y * 0.5 + 0.5) * this.height;
      // Tags hang above their anchor, centred horizontally.
      const [width, height] = stop.labelSize;
      const left = px - width / 2,
        top = py - height;
      let visible =
        index !== this.selectedIndex &&
        z > -1 &&
        z < 1 &&
        left > LABEL_GAP &&
        top > LABEL_GAP &&
        left + width < this.width - LABEL_GAP &&
        py < this.height - LABEL_GAP;
      if (visible && this.coversOverlay(left, top, left + width, py)) visible = false;
      stop.label.style.visibility = visible ? 'visible' : 'hidden';
      stop.label.style.transform = `translate(-50%, -100%) translate(${px}px, ${py}px)`;
    }
    this.updateHostBadge();
  }
  /** Keeps the guide's outbound link floating over their head while they are on screen. */
  private updateHostBadge() {
    const badge = this.hostBadge;
    if (!badge) return;
    if (!this.crowd?.hostAnchor(this.projected)) {
      badge.style.visibility = 'hidden';
      return;
    }
    this.projected.project(this.rig.camera);
    const { x, y, z } = this.projected;
    const px = (x * 0.5 + 0.5) * this.width,
      py = (-y * 0.5 + 0.5) * this.height;
    const [width, height] = this.hostSize;
    const left = px - width / 2,
      top = py - height;
    const onScreen =
      z > -1 &&
      z < 1 &&
      left > LABEL_GAP &&
      top > LABEL_GAP &&
      left + width < this.width - LABEL_GAP &&
      py < this.height - LABEL_GAP;
    badge.style.visibility =
      onScreen && !this.coversOverlay(left, top, left + width, py) ? 'visible' : 'hidden';
    badge.style.transform = `translate(-50%, -100%) translate(${px}px, ${py}px)`;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer.setAnimationLoop(null);
    this.observer.disconnect();
    this.emphasisTween?.kill();
    this.clockTween?.kill();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener('pointerdown', this.onPointerDown);
    canvas.removeEventListener('pointerup', this.onPointerUp);
    canvas.removeEventListener('pointermove', this.onPointerMove);
    canvas.removeEventListener('pointercancel', this.onPointerCancel);
    canvas.removeEventListener('lostpointercapture', this.onPointerCancel);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.rig.dispose();
    this.effects?.dispose();
    this.simulation?.dispose();
    this.factories.forEach((factory) => factory.dispose());
    this.crowd?.dispose();
    this.queueBarriers?.dispose();
    this.traffic?.dispose();
    this.city?.dispose();
    this.lighting.dispose();
    if (this.rendererInitialized) {
      this.renderer.dispose();
      this.rendererInitialized = false;
    }
    canvas.remove();
  }
}
