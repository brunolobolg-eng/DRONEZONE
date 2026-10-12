import { MotorAudio } from '../audio/motor-audio';
import { GameSession, type SessionEvent } from '../gameplay/game-session';
import { ButtonEdges, type ControlFrame, resolveControls } from '../gameplay/input/input-mapping';
import {
  DEFAULT_KEY_BINDINGS,
  KEY_ACTION_LABELS,
  type KeyAction,
  bindingHint,
  findBindingConflict,
  keyLabel,
} from '../gameplay/input/keyboard-axes';
import { KeyboardRamp } from '../gameplay/input/keyboard-ramp';
import { DEFAULT_CATALOG, type PartCatalog } from '../gameplay/progression/catalog';
import { type Loadout } from '../gameplay/progression/loadout';
import { type SaveData, serializeSave } from '../gameplay/progression/save-data';
import { type GameSettings, sanitizeSettings, toControlsSettings } from '../gameplay/settings';
import { computeTelemetry } from '../core/telemetry/telemetry';
import { SceneRenderer } from '../rendering/scene-renderer';
import { SETTINGS_KEY, SAVE_KEY, type KeyValueStorage } from '../platform/storage';
import { GamepadSource, KeyboardSource } from '../platform/input-sources';
import { logger } from '../platform/logger';
import { Hud, TelemetryPanel } from '../ui/hud';
import { Menus, type WorkshopState } from '../ui/menus';
import { toggleFullscreen } from '../platform/fullscreen';
import { fmt } from '../ui/dom';

export interface GameOptions {
  readonly canvas: HTMLCanvasElement;
  readonly storage: KeyValueStorage;
  readonly catalog?: PartCatalog;
  readonly save: SaveData;
  readonly settings: GameSettings;
  readonly hudRoot: HTMLElement;
  readonly telemetryRoot: HTMLElement;
  readonly menuRoot: HTMLElement;
  readonly seed?: number;
  readonly fixedHz?: number;
}

const HUD_INTERVAL_MS = 100;
const MAX_FRAME_SECONDS = 0.25;

/**
 * Laço principal do jogo. Liga entradas, sessão, renderização, interface e áudio.
 * A simulação roda em passo fixo dentro da sessão; aqui só se decide quanto tempo passou.
 */
export class Game {
  private readonly session: GameSession;
  private readonly renderer: SceneRenderer;
  private readonly hud: Hud;
  private readonly telemetry: TelemetryPanel;
  private readonly menus: Menus;
  private readonly keyboard: KeyboardSource;
  private readonly keyboardRamp = new KeyboardRamp();
  /** Ação que está sendo remapeada, ou null. Enquanto há captura, os controles não são processados. */
  private capture: KeyAction | null = null;
  private readonly gamepad: GamepadSource;
  private readonly audio = new MotorAudio();
  private readonly edges = new ButtonEdges();
  private readonly storage: KeyValueStorage;
  private settings: GameSettings;
  private paused = false;
  private throttle = 0;
  private lastHud = 0;
  private frameTimes: number[] = [];
  private renderFps = 0;
  private simMs = 0;
  private running = false;
  private lastTime = 0;
  private readonly telemetryRoot: HTMLElement;
  private readonly canvas: HTMLCanvasElement;

  constructor(options: GameOptions) {
    this.canvas = options.canvas;
    this.storage = options.storage;
    this.settings = options.settings;
    this.telemetryRoot = options.telemetryRoot;

    this.session = new GameSession({
      catalog: options.catalog ?? DEFAULT_CATALOG,
      save: options.save,
      seed: options.seed,
      fixedHz: options.fixedHz,
      onSave: (save) => void this.persist(SAVE_KEY, serializeSave(save)),
    });
    this.renderer = new SceneRenderer({
      canvas: options.canvas,
      session: this.session,
      quality: this.settings.quality,
      fov: this.settings.fov,
      devicePixelRatio: window.devicePixelRatio,
    });
    this.renderer.syncWorld();

    this.hud = new Hud(options.hudRoot);
    this.telemetry = new TelemetryPanel(options.telemetryRoot);
    options.telemetryRoot.hidden = !this.settings.telemetryVisible;

    this.keyboard = new KeyboardSource(window);
    this.keyboard.setBindings(this.settings.keys);
    this.hud.setHint(bindingHint(this.settings.keys));
    window.addEventListener('keydown', this.onCaptureKey, true);
    this.gamepad = new GamepadSource(window, (connected) => {
      this.hud.warn(connected ? 'Controle conectado' : 'Controle desconectado', performance.now(), 3);
    });

    this.menus = new Menus(
      options.menuRoot,
      {
        resume: () => this.setPaused(false),
        restart: () => {
          this.session.restartFlight();
          this.setPaused(false);
          this.hud.warn('Voo reiniciado', performance.now(), 2);
        },
        toggleTelemetry: () => this.toggleTelemetry(),
        setSettings: (patch) => this.applySettings(patch),
        beginKeyCapture: (action) => this.beginKeyCapture(action),
        resetKeys: () => {
          this.capture = null;
          this.applySettings({ keys: DEFAULT_KEY_BINDINGS });
          this.menus.setCapture(null, 'Teclas padrão restauradas.');
        },
        buy: (id) => {
          const r = this.session.buy(id);
          this.refreshWorkshop();
          return r;
        },
        equip: (loadout: Loadout) => {
          const r = this.session.equip(loadout);
          this.refreshWorkshop();
          return r;
        },
        repair: () => {
          const r = this.session.repair();
          this.refreshWorkshop();
          return r;
        },
      },
      this.settings,
    );
    this.menus.setWorkshop(this.workshopState());
    this.handleResize();

    this.installWindowHandlers();
    this.canvas.addEventListener('webglcontextlost', this.onContextLost);
    this.canvas.addEventListener('webglcontextrestored', this.onContextRestored);
    this.canvas.addEventListener('click', () => this.audio.start());
  }

  start(): void {
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    this.renderer.dispose();
    this.keyboard.dispose();
    this.gamepad.dispose(window);
    this.audio.dispose();
  }

  get isPaused(): boolean {
    return this.paused;
  }

  private readonly frame = (now: number): void => {
    if (!this.running) return;
    requestAnimationFrame(this.frame);
    const dt = Math.min(Math.max((now - this.lastTime) / 1000, 0), MAX_FRAME_SECONDS);
    this.lastTime = now;
    this.trackFps(now);

    // Os controles são lidos sempre, para que Esc (pausa/retomar) e Tab funcionem também em pausa.
    if (this.capture !== null) {
      // Remapeando uma tecla: nenhum comando do jogo é processado enquanto o jogador escolhe.
      this.keyboard.clear();
    } else {
      const controls = this.readControls(dt);
      const pressed = this.edges.update(controls.buttons);
      if (pressed.includes('pause')) this.setPaused(!this.paused);
      if (pressed.includes('telemetry')) this.toggleTelemetry();
      if (!this.paused) this.simulate(controls, dt);
    }

    this.renderer.syncWorld();
    const pose = this.session.world.renderPose();
    const state = this.session.world.state;
    const telemetry = computeTelemetry(state, this.session.drone.params, this.session.terrain.heightAt(state.position.x, state.position.z), this.session.world.saturated);
    this.renderer.render(pose, {
      motorFraction: telemetry.motorFraction,
      speedMs: telemetry.speedMs,
      integrityFraction: state.integrity / this.session.drone.params.integrityMax,
      cameraEffects: this.settings.cameraEffects,
      vibration: this.settings.vibration,
      time: now / 1000,
      dt,
    });

    if (now - this.lastHud >= HUD_INTERVAL_MS) {
      this.lastHud = now;
      this.updateInterface(telemetry, now);
    }
  };

  private readControls(dt: number): ControlFrame {
    const controls = resolveControls({
      gamepad: this.gamepad.read(),
      keyboard: this.keyboardRamp.update(this.keyboard.read(), dt, this.settings.keyboardRampMs),
      settings: toControlsSettings(this.settings),
      previousThrottle: this.throttle,
      dt,
    });
    this.throttle = controls.throttle;
    return controls;
  }

  private simulate(controls: ControlFrame, dt: number): void {
    const t0 = performance.now();
    this.session.frame(controls, dt);
    this.simMs = performance.now() - t0;

    for (const event of this.session.drainEvents()) this.handleEvent(event);
    this.audio.update(this.averageThrust(), this.session.world.state.flightState === 'armed');
  }

  private handleEvent(event: SessionEvent): void {
    const now = performance.now();
    switch (event.type) {
      case 'crater':
        this.renderer.applyEvents([event]);
        break;
      case 'impact':
        this.audio.impact(event.impact.speed);
        if (event.impact.damage > 0) this.hud.warn(`Impacto: -${fmt(event.impact.damage)} integridade`, now);
        break;
      case 'structure':
        if (event.events.some((e) => e.type === 'structure' && e.to === 'destroyed')) this.hud.warn('Construção destruída', now, 5);
        break;
      case 'crash':
        this.hud.warn('Drone destruído. Reinicie o voo ou repare na oficina.', now, 6);
        break;
      case 'failsafe':
        this.hud.warn('Sinal perdido: motores desarmados', now, 5);
        break;
      case 'reward':
        this.hud.warn(`+${event.amount} cr · ${event.reason}`, now, 3);
        this.refreshWorkshop();
        break;
      case 'mission':
        if (event.event.type === 'checkpoint') this.hud.warn(`Ponto ${event.event.index + 1} de ${event.event.total}`, now, 2);
        if (event.event.type === 'completed') this.hud.warn(`Missão concluída em ${fmt(event.event.elapsed, 1)} s`, now, 6);
        break;
      default:
        break;
    }
  }

  private updateInterface(t: ReturnType<typeof computeTelemetry>, now: number): void {
    const session = this.session;
    const mission = session.mission;
    this.hud.update(
      {
        telemetry: t,
        balance: session.balance,
        equipment: this.equipmentNames(),
        missionProgress: mission.progress,
        missionStatus: mission.state,
        missionElapsed: mission.elapsed(session.world.state.time),
        gamepad: { connected: this.gamepad.connected, id: this.gamepad.id },
      },
      now,
    );
    if (this.settings.telemetryVisible && !this.telemetryRoot.hidden) {
      const report = session.world.state;
      this.telemetry.update({
        'sim Hz': session.world.fixedHz,
        'tempo sim (s)': report.time,
        'tempo de sim/quadro (ms)': this.simMs,
        'FPS de render': this.renderFps,
        'fluxo de tempo': this.paused ? 'pausado' : 'ativo',
        'motor 0..3 (N)': report.motorThrust.map((f) => f.toFixed(2)).join(' '),
        'empuxo total (N)': t.totalThrustN,
        'potência (W)': t.powerW,
        'taxa roll/pitch/yaw (°/s)': `${fmt(t.rateDegPerSec.roll)} / ${fmt(t.rateDegPerSec.pitch)} / ${fmt(t.rateDegPerSec.yaw)}`,
        'saturação do mixer': t.saturated ? 'sim' : 'não',
        'controle': this.gamepad.connected ? 'gamepad' : 'teclado',
        'construções': session.structureList.map((s) => `${s.id.replace('house-', 'c')}:${s.state[0]}`).join(' '),
        'crateras': session.terrain.craterRecords.length,
        'fragmentos ativos': session.fragments.activeCount,
      });
    }
  }

  private averageThrust(): number {
    const f = this.session.world.state.motorThrust;
    return (f[0] + f[1] + f[2] + f[3]) / (4 * this.session.drone.params.motor.maxThrust);
  }

  private equipmentNames(): string[] {
    const names: string[] = [];
    const loadout = this.session.saveData.loadout;
    for (const id of [loadout.frame, loadout.motors, loadout.battery, loadout.camera]) {
      names.push(DEFAULT_CATALOG.get(id)?.name.split(' ')[0] ?? id);
    }
    return names;
  }

  private workshopState(): WorkshopState {
    const save = this.session.saveData;
    const world = this.session.world.state;
    return {
      catalog: DEFAULT_CATALOG,
      owned: save.owned,
      equipped: save.loadout,
      balance: save.balance,
      armed: world.flightState === 'armed',
      integrityLost: this.session.drone.params.integrityMax - world.integrity,
    };
  }

  private refreshWorkshop(): void {
    this.menus.setWorkshop(this.workshopState());
  }

  private setPaused(paused: boolean, announce = true): void {
    this.paused = paused;
    if (paused) {
      this.keyboard.clear();
      this.menus.open('menu');
      this.refreshWorkshop();
    } else {
      this.menus.close();
      this.audio.start();
    }
    if (announce) logger.log('info', paused ? 'jogo pausado' : 'jogo retomado');
  }

  private toggleTelemetry(): void {
    const next = !this.settings.telemetryVisible;
    this.applySettings({ telemetryVisible: next });
  }

  private applySettings(patch: Partial<GameSettings>): void {
    const raw = { ...this.settings, ...patch };
    const { settings, warnings } = sanitizeSettings(raw);
    for (const w of warnings) logger.log('warn', `configuração: ${w}`);
    this.settings = settings;
    this.menus.setSettings(settings);
    this.telemetryRoot.hidden = !settings.telemetryVisible;
    this.renderer.setQuality(settings.quality, window.devicePixelRatio);
    this.renderer.setFov(settings.fov);
    this.keyboard.setBindings(settings.keys);
    this.hud.setHint(bindingHint(settings.keys));
    void this.persist(SETTINGS_KEY, JSON.stringify(settings));
  }

  private beginKeyCapture(action: KeyAction): void {
    this.capture = action;
    this.keyboard.clear();
    this.menus.setCapture(action);
  }

  /** Captura a próxima tecla para a ação em remapeamento. Esc cancela; a capture phase impede que a tecla acione o jogo. */
  private readonly onCaptureKey = (e: KeyboardEvent): void => {
    if (this.capture === null) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    const action = this.capture;
    if (e.code === 'Escape') {
      this.capture = null;
      this.menus.setCapture(null, 'Remapeamento cancelado.');
      return;
    }
    const current = this.settings.keys[action];
    const next = { ...this.settings.keys, [action]: [e.code, ...current.slice(1).filter((c) => c !== e.code)] };
    const conflict = findBindingConflict(next);
    if (conflict && conflict.actions.some((a) => a !== action)) {
      const others = conflict.actions.filter((a) => a !== action).map((a) => KEY_ACTION_LABELS[a]).join(', ');
      this.menus.setCapture(action, `"${keyLabel(e.code)}" já é usada em: ${others}.`);
      return;
    }
    this.capture = null;
    this.applySettings({ keys: next });
    this.menus.setCapture(null, `"${keyLabel(e.code)}" agora é ${KEY_ACTION_LABELS[action].toLowerCase()}.`);
  };

  private async persist(key: string, value: string): Promise<void> {
    const ok = await this.storage.write(key, value);
    if (!ok) this.hud.warn('Não foi possível salvar o progresso', performance.now(), 5);
  }

  private trackFps(now: number): void {
    this.frameTimes.push(now);
    while (this.frameTimes.length > 0 && now - this.frameTimes[0] > 1000) this.frameTimes.shift();
    this.renderFps = this.frameTimes.length;
  }

  private handleResize(): void {
    this.renderer.resize(window.innerWidth, window.innerHeight);
  }

  private installWindowHandlers(): void {
    const pauseOnHide = () => {
      if (!this.paused && (document.hidden || !document.hasFocus())) this.setPaused(true);
    };
    document.addEventListener('visibilitychange', pauseOnHide);
    window.addEventListener('blur', pauseOnHide);
    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'F11') {
        e.preventDefault();
        void toggleFullscreen(document.documentElement);
      }
    });
  }

  private readonly onContextLost = (event: Event): void => {
    event.preventDefault();
    this.setPaused(true);
    logger.log('error', 'contexto WebGL perdido: aguardando recuperação');
  };

  private readonly onContextRestored = (): void => {
    logger.log('info', 'contexto WebGL restaurado: recarregando a página');
    window.location.reload();
  };
}
