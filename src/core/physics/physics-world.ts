import { FlightController } from '../control/flight-controller';
import { NEUTRAL_INPUT, type PilotInput } from '../control/pilot-input';
import { type Vec3, dot, vec3 } from '../math/vec3';
import { slerp, type Quat } from '../math/quat';
import { type ColliderEntry, sphereVsAabb } from './collision';
import { type DroneParams } from './drone-params';
import { type DroneState, type Quad } from './drone-state';
import { stepDrone, forwardSpeed } from './drone-physics-model';
import { CALM_WIND, type WindField } from './wind';

export interface GroundQuery {
  heightAt(x: number, z: number): number;
}

export interface ImpactEvent {
  /** Tempo de simulação do impacto, em segundos. */
  readonly time: number;
  readonly source: 'ground' | 'collider';
  readonly colliderId: string | null;
  readonly point: Vec3;
  /** Normal da superfície, apontando para o drone. */
  readonly normal: Vec3;
  /** Velocidade normal no momento do impacto, em m/s. */
  readonly speed: number;
  /** Dano sofrido pela estrutura do drone, em pontos de integridade. */
  readonly damage: number;
}

export interface PhysicsWorldOptions {
  readonly params: DroneParams;
  readonly ground: GroundQuery;
  readonly wind?: WindField;
  /** Frequência do passo fixo, em Hz. Testada em 100, 200 e 250. */
  readonly fixedHz?: number;
  /** Tempo máximo aceito por quadro. Acima disso o excedente é descartado, nunca simulado depois. */
  readonly maxFrameSeconds?: number;
  /** Limite de passos por quadro, como proteção extra contra picos. */
  readonly maxStepsPerFrame?: number;
  readonly controller?: FlightController;
}

export interface FrameReport {
  readonly steps: number;
  /** Tempo de simulação descartado neste quadro (pausa, aba oculta, queda de FPS), em s. */
  readonly droppedSeconds: number;
}

export interface RenderPose {
  readonly position: Vec3;
  readonly velocity: Vec3;
  readonly orientation: Quat;
  readonly motorThrust: Quad;
  readonly time: number;
}

const RESTITUTION = 0.2;
const REST_VERTICAL_SPEED = 0.05;
const GROUND_FRICTION = 6;
const CONTACT_SPIN_DAMPING = 8;
const EVENT_MIN_SPEED = 0.8;

/**
 * Mundo físico do drone. Mantém o estado, controla o passo fixo e resolve colisões.
 * Não usa Three.js nem DOM: o mesmo código roda no navegador, no Electron e nos testes.
 */
export class PhysicsWorld {
  readonly dt: number;
  readonly params: DroneParams;
  readonly controller: FlightController;
  private readonly ground: GroundQuery;
  private readonly wind: WindField;
  private readonly maxFrameSeconds: number;
  private readonly maxSteps: number;
  private readonly colliders: ColliderEntry[] = [];
  private readonly events: ImpactEvent[] = [];
  private accumulator = 0;
  private previous: DroneState;
  private current: DroneState;
  private input: PilotInput = NEUTRAL_INPUT;
  private lastSaturated = false;

  constructor(initial: DroneState, options: PhysicsWorldOptions) {
    const hz = options.fixedHz ?? 250;
    if (!Number.isFinite(hz) || hz < 30 || hz > 1000) throw new RangeError(`fixedHz fora do intervalo: ${hz}`);
    this.dt = 1 / hz;
    this.params = options.params;
    this.ground = options.ground;
    this.wind = options.wind ?? CALM_WIND;
    this.maxFrameSeconds = options.maxFrameSeconds ?? 0.1;
    this.maxSteps = options.maxStepsPerFrame ?? 50;
    this.controller = options.controller ?? new FlightController();
    this.previous = initial;
    this.current = initial;
  }

  get state(): DroneState {
    return this.current;
  }

  get fixedHz(): number {
    return 1 / this.dt;
  }

  /** Fração do próximo passo já acumulada, em [0, 1). Usada para interpolar a renderização. */
  get alpha(): number {
    return this.accumulator / this.dt;
  }

  get saturated(): boolean {
    return this.lastSaturated;
  }

  get forwardSpeedMs(): number {
    return forwardSpeed(this.current);
  }

  setInput(input: PilotInput): void {
    this.input = input;
  }

  /** Zera a entrada, por exemplo ao perder o foco da janela. */
  neutralizeInput(): void {
    this.input = NEUTRAL_INPUT;
  }

  addCollider(entry: ColliderEntry): void {
    this.colliders.push(entry);
  }

  setColliderEnabled(id: string, enabled: boolean): void {
    for (const c of this.colliders) if (c.id === id) c.enabled = enabled;
  }

  /**
   * Avança a simulação pelo tempo real decorrido, em passos fixos.
   * O tempo por quadro é limitado: uma aba suspensa não acumula segundos para depois.
   */
  advance(frameSeconds: number): FrameReport {
    const safe = Number.isFinite(frameSeconds) && frameSeconds > 0 ? frameSeconds : 0;
    const usable = Math.min(safe, this.maxFrameSeconds);
    let dropped = safe - usable;
    this.accumulator += usable;

    let steps = 0;
    while (this.accumulator >= this.dt) {
      if (steps >= this.maxSteps) {
        dropped += this.accumulator;
        this.accumulator = 0;
        break;
      }
      this.stepOnce();
      this.accumulator -= this.dt;
      steps++;
    }
    return { steps, droppedSeconds: dropped };
  }

  /** Estado interpolado entre os dois últimos passos, para renderizar com suavidade. */
  renderPose(): RenderPose {
    const t = this.alpha;
    const a = this.previous;
    const b = this.current;
    return {
      position: vec3(
        a.position.x + (b.position.x - a.position.x) * t,
        a.position.y + (b.position.y - a.position.y) * t,
        a.position.z + (b.position.z - a.position.z) * t,
      ),
      velocity: b.velocity,
      orientation: slerp(a.orientation, b.orientation, t),
      motorThrust: b.motorThrust,
      time: b.time,
    };
  }

  /** Eventos de impacto desde a última leitura. */
  drainEvents(): ImpactEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /** Restaura a integridade após reparo. Um drone destruído volta a ficar desarmado. */
  repair(integrity: number): void {
    const next: DroneState = {
      ...this.current,
      integrity: Math.min(this.params.integrityMax, Math.max(0, integrity)),
      flightState: this.current.flightState === 'crashed' ? 'disarmed' : this.current.flightState,
    };
    this.previous = next;
    this.current = next;
  }

  /** Volta ao estado inicial. Não há interpolação com o estado anterior à reinicialização. */
  reset(initial: DroneState): void {
    this.accumulator = 0;
    this.previous = initial;
    this.current = initial;
    this.controller.reset();
    this.events.length = 0;
    this.lastSaturated = false;
  }

  /** Desarma os motores imediatamente (failsafe por perda de sinal). */
  disarm(): void {
    if (this.current.flightState !== 'armed') return;
    const next: DroneState = { ...this.current, flightState: 'disarmed' };
    this.previous = next;
    this.current = next;
  }

  private stepOnce(): void {
    this.previous = this.current;
    const out = this.controller.update(this.current, this.input, this.params, this.dt);
    this.lastSaturated = out.saturated;
    // O pedido de armar vale só para o primeiro passo do quadro.
    this.input = { ...this.input, armRequest: false };

    let state: DroneState = { ...this.current, flightState: out.flightState };
    state = stepDrone(state, { demand: out.demand, params: this.params, wind: this.wind, dt: this.dt });
    this.current = this.resolveContacts(state);
  }

  /** Colisões com o solo e com colisores. Gera eventos de impacto e aplica dano à estrutura. */
  private resolveContacts(state: DroneState): DroneState {
    const { params, dt } = this;
    const r = params.radius;
    let pos = state.position;
    let vel = state.velocity;
    let spin = state.angularVelocity;
    let integrity = state.integrity;
    let inContact = false;

    for (const entry of this.colliders) {
      if (!entry.enabled) continue;
      const contact = sphereVsAabb(pos, r, entry.box);
      if (!contact) continue;
      pos = vec3(
        pos.x + contact.normal.x * contact.penetration,
        pos.y + contact.normal.y * contact.penetration,
        pos.z + contact.normal.z * contact.penetration,
      );
      const vn = dot(vel, contact.normal);
      if (vn < 0) {
        const impact = -vn;
        vel = vec3(
          (vel.x - (1 + RESTITUTION) * vn * contact.normal.x) * 0.9,
          (vel.y - (1 + RESTITUTION) * vn * contact.normal.y) * 0.9,
          (vel.z - (1 + RESTITUTION) * vn * contact.normal.z) * 0.9,
        );
        integrity = this.registerImpact(integrity, impact, 'collider', entry.id, pos, contact.normal, state.time);
      }
      inContact = true;
    }

    const groundY = this.ground.heightAt(pos.x, pos.z);
    if (pos.y - r < groundY) {
      pos = vec3(pos.x, groundY + r, pos.z);
      const normal = vec3(0, 1, 0);
      if (vel.y < 0) {
        const impact = -vel.y;
        vel = vec3(vel.x, impact > REST_VERTICAL_SPEED ? impact * RESTITUTION : 0, vel.z);
        integrity = this.registerImpact(integrity, impact, 'ground', null, pos, normal, state.time);
      }
      const friction = Math.exp(-GROUND_FRICTION * dt);
      vel = vec3(vel.x * friction, vel.y, vel.z * friction);
      spin = vec3(spin.x * Math.exp(-CONTACT_SPIN_DAMPING * dt), spin.y * Math.exp(-CONTACT_SPIN_DAMPING * dt), spin.z * Math.exp(-CONTACT_SPIN_DAMPING * dt));
      inContact = true;
    }

    const crashed = integrity <= 0 || state.flightState === 'crashed';
    return {
      ...state,
      position: pos,
      velocity: vel,
      angularVelocity: spin,
      integrity: Math.max(0, integrity),
      inContact,
      flightState: crashed ? 'crashed' : state.flightState,
    };
  }

  private registerImpact(
    integrity: number,
    speed: number,
    source: 'ground' | 'collider',
    colliderId: string | null,
    point: Vec3,
    normal: Vec3,
    time: number,
  ): number {
    const over = Math.max(0, speed - this.params.impactTolerance);
    const damage = over * this.params.impactDamagePerSpeed;
    if (speed >= EVENT_MIN_SPEED) {
      this.events.push({ time, source, colliderId, point, normal, speed, damage });
    }
    return integrity - damage;
  }
}
