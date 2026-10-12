import { FlightController } from '../core/control/flight-controller';
import { type PilotInput } from '../core/control/pilot-input';
import { createRng, type Rng } from '../core/math/random';
import { type Vec3, vec3 } from '../core/math/vec3';
import { type ColliderEntry } from '../core/physics/collision';
import { DEFAULT_DRONE_PARAMS, GRAVITY } from '../core/physics/drone-params';
import { createDroneState, type DroneState } from '../core/physics/drone-state';
import { PhysicsWorld, type FrameReport, type ImpactEvent } from '../core/physics/physics-world';
import { CALM_WIND, type WindField } from '../core/physics/wind';
import { Heightfield, type Crater, type DirtyRect } from '../core/terrain/heightfield';
import { type ControlFrame, ButtonEdges } from './input/input-mapping';
import { SignalFailsafe } from './input/failsafe';
import { DEFAULT_IMPACT_RULES, craterFromSpeed, structureDamageFromSpeed, type ImpactRules } from './destruction/impact-rules';
import { FragmentPool } from './destruction/fragment-pool';
import { createStructure, damageStructure, specsForHouse, type Structure, type StructureEvent } from './destruction/structure';
import { generateNeighborhood, AREA_HALF_EXTENT, FLAT_HALF_WIDTH, type Neighborhood } from './environment/layout';
import { Mission, type MissionEvent } from './missions/mission';
import { type PartCatalog } from './progression/catalog';
import { buildDrone, type BuiltDrone, type Loadout } from './progression/loadout';
import { CHECKPOINT_REWARD, MISSION_COMPLETE_REWARD, missionReward, purchasePart, repairCost } from './progression/economy';
import { type SaveData } from './progression/save-data';

export { FAILSAFE_SECONDS } from './input/failsafe';

export type SessionEvent =
  | { readonly type: 'impact'; readonly impact: ImpactEvent }
  | { readonly type: 'crater'; readonly crater: Crater; readonly dirty: DirtyRect }
  | { readonly type: 'structure'; readonly structureId: string; readonly events: readonly StructureEvent[] }
  | { readonly type: 'fragments'; readonly origin: Vec3; readonly count: number }
  | { readonly type: 'mission'; readonly event: MissionEvent }
  | { readonly type: 'reward'; readonly amount: number; readonly reason: string }
  | { readonly type: 'crash' }
  | { readonly type: 'failsafe' }
  | { readonly type: 'collider-off'; readonly colliderId: string };

export interface SessionOptions {
  readonly catalog: PartCatalog;
  readonly save: SaveData;
  readonly seed?: number;
  readonly fixedHz?: number;
  readonly wind?: WindField;
  readonly impactRules?: ImpactRules;
  /** Chamado sempre que o progresso muda (compra, equipamento, reparo, recompensa). */
  readonly onSave?: (save: SaveData) => void;
}

export type ActionResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

/**
 * Sessão de jogo: une o mundo físico, o cenário destrutível, o terreno deformável,
 * a missão e a progressão. Não depende de renderização nem de DOM.
 */
export class GameSession {
  readonly neighborhood: Neighborhood;
  readonly terrain: Heightfield;
  readonly fragments: FragmentPool;
  readonly mission: Mission;

  private readonly catalog: PartCatalog;
  private readonly fixedHz: number | undefined;
  private readonly wind: WindField;
  private readonly impactRules: ImpactRules;
  private readonly onSave: ((save: SaveData) => void) | undefined;
  private readonly rng: Rng;
  private readonly structures = new Map<string, Structure>();
  private readonly structureCenters = new Map<string, Vec3>();
  private readonly structureByCollider = new Map<string, string>();
  private readonly colliders: ColliderEntry[] = [];
  private readonly events: SessionEvent[] = [];
  private readonly buttonEdges = new ButtonEdges();
  private progress: SaveData;
  private built!: BuiltDrone;
  private physics!: PhysicsWorld;
  private readonly failsafe = new SignalFailsafe();
  private crashReported = false;

  constructor(options: SessionOptions) {
    this.catalog = options.catalog;
    this.progress = options.save;
    this.fixedHz = options.fixedHz;
    this.wind = options.wind ?? CALM_WIND;
    this.impactRules = options.impactRules ?? DEFAULT_IMPACT_RULES;
    this.onSave = options.onSave;
    this.rng = createRng(options.seed ?? 4242);

    this.neighborhood = generateNeighborhood(options.seed ?? 20260);
    this.terrain = new Heightfield({
      cells: AREA_HALF_EXTENT * 2,
      cellSize: 1,
      origin: { x: -AREA_HALF_EXTENT, z: -AREA_HALF_EXTENT },
      baseHeight: 0,
      roughness: 0.5,
      seed: options.seed ?? 20260,
      maxCraterDepth: 1.2,
      maxCraterRecords: 40,
      flatHalfWidth: FLAT_HALF_WIDTH,
    });
    this.fragments = new FragmentPool(
      { capacity: 160, lifetime: 4, despawnDistance: 120, restitution: 0.3 },
      this.rng,
    );

    for (const house of this.neighborhood.houses) {
      const structure = createStructure(
        house.id,
        specsForHouse(house.width / 2, house.depth / 2, house.height, house.windows, house.door),
      );
      this.structures.set(house.id, structure);
      this.structureCenters.set(house.id, house.center);
      this.structureByCollider.set(structure.colliderId, house.id);
    }
    for (const c of this.neighborhood.colliders) this.colliders.push({ id: c.id, box: c.box, enabled: true });

    this.mission = new Mission(this.neighborhood.checkpoints);
    this.buildDrone(this.progress.loadout);
  }

  get saveData(): SaveData {
    return this.progress;
  }

  get balance(): number {
    return this.progress.balance;
  }

  get drone(): BuiltDrone {
    return this.built;
  }

  get world(): PhysicsWorld {
    return this.physics;
  }

  get structureList(): readonly Structure[] {
    return [...this.structures.values()];
  }

  structure(id: string): Structure | undefined {
    return this.structures.get(id);
  }

  /** Estado da construção, para decidir a aparência. */
  structureCenter(id: string): Vec3 | undefined {
    return this.structureCenters.get(id);
  }

  /** Eventos gerados desde a última chamada. A camada visual e a UI consomem esta fila. */
  drainEvents(): SessionEvent[] {
    return this.events.splice(0, this.events.length);
  }

  /**
   * Um quadro de jogo: aplica os controles, avança a física e processa os impactos.
   * Retorna o relatório de passos da física.
   */
  frame(controls: ControlFrame, frameSeconds: number): FrameReport {
    const edges = this.buttonEdges.update(controls.buttons);
    if (edges.includes('reset')) this.restartFlight();

    const input: PilotInput = { ...controls.input, armRequest: edges.includes('arm') };
    this.physics.setInput(input);

    this.updateFailsafe(controls, frameSeconds);
    const report = this.physics.advance(frameSeconds);
    for (const impact of this.physics.drainEvents()) this.onImpact(impact);

    if (this.physics.state.flightState === 'crashed' && !this.crashReported) {
      this.crashReported = true;
      this.events.push({ type: 'crash' });
      for (const e of this.mission.fail('drone destruído', this.physics.state.time)) this.events.push({ type: 'mission', event: e });
    }
    if (this.mission.state === 'ready' && this.physics.state.flightState === 'armed') {
      this.mission.start(this.physics.state.time);
    }
    if (this.mission.state === 'running') {
      for (const e of this.mission.update(this.physics.state.position, this.physics.state.time)) this.onMission(e);
    }

    if (report.steps > 0) this.fragments.update(report.steps * this.physics.dt, (x, z) => this.terrain.heightAt(x, z), this.physics.state.position, GRAVITY);
    return report;
  }

  /** Reinicia o voo: drone no ponto de partida e missão do começo. O cenário mantém os danos. */
  restartFlight(): void {
    this.physics.reset(this.spawnState());
    this.mission.reset();
    this.crashReported = false;
  }

  /** Compra uma peça com créditos fictícios. */
  buy(partId: string): ActionResult {
    const result = purchasePart({ balance: this.progress.balance, owned: this.progress.owned }, this.catalog, partId);
    if (!result.ok) return { ok: false, reason: messageFor(result.reason) };
    this.setSave({ ...this.progress, balance: result.state.balance, owned: result.state.owned });
    return { ok: true };
  }

  /** Equipa uma configuração de peças. Só é possível com o drone desarmado. */
  equip(loadout: Loadout): ActionResult {
    if (this.physics.state.flightState === 'armed') return { ok: false, reason: 'desarme o drone antes de trocar peças' };
    for (const slot of Object.keys(loadout) as (keyof Loadout)[]) {
      if (!this.progress.owned.includes(loadout[slot])) return { ok: false, reason: `peça não comprada: ${loadout[slot]}` };
    }
    try {
      this.buildDrone(loadout);
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : 'configuração inválida' };
    }
    this.setSave({ ...this.progress, loadout });
    return { ok: true };
  }

  /** Repara a integridade pelo custo proporcional ao dano. */
  repair(): ActionResult & { readonly cost: number } {
    const lost = this.built.params.integrityMax - this.physics.state.integrity;
    const cost = repairCost(lost);
    if (cost === 0) return { ok: true, cost: 0 };
    if (this.progress.balance < cost) return { ok: false, cost, reason: 'saldo insuficiente para o reparo' };
    this.physics.repair(this.built.params.integrityMax);
    this.setSave({ ...this.progress, balance: this.progress.balance - cost });
    return { ok: true, cost };
  }

  /** Estado de dano de todas as construções, para depuração e testes. */
  damageSummary(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const s of this.structures.values()) out[s.id] = s.state;
    return out;
  }

  /** Impacto de teste no solo, pelo mesmo caminho dos impactos reais. Usado por testes e pelo modo de depuração. */
  applyGroundImpact(x: number, z: number, speed: number): void {
    this.onImpact({
      time: this.physics.state.time,
      source: 'ground',
      colliderId: null,
      point: vec3(x, this.terrain.heightAt(x, z), z),
      normal: vec3(0, 1, 0),
      speed,
      damage: 0,
    });
  }

  /** Impacto de teste em um colisor de construção, pelo mesmo caminho dos impactos reais. */
  applyStructureImpact(colliderId: string, point: Vec3, speed: number): void {
    this.onImpact({
      time: this.physics.state.time,
      source: 'collider',
      colliderId,
      point,
      normal: vec3(0, 0, 1),
      speed,
      damage: 0,
    });
  }

  private buildDrone(loadout: Loadout): void {
    const drone = buildDrone(this.catalog, loadout, DEFAULT_DRONE_PARAMS);
    this.built = drone;
    const world = new PhysicsWorld(this.spawnStateFor(drone), {
      params: drone.params,
      ground: this.terrain,
      wind: this.wind,
      fixedHz: this.fixedHz,
      controller: new FlightController(),
    });
    for (const c of this.colliders) world.addCollider(c);
    this.physics = world;
    this.crashReported = false;
  }

  private spawnStateFor(drone: BuiltDrone): DroneState {
    const sp = this.neighborhood.spawn;
    const y = this.terrain.heightAt(sp.x, sp.z) + drone.params.radius + 0.05;
    return createDroneState(vec3(sp.x, y, sp.z), drone.params);
  }

  private spawnState(): DroneState {
    return this.spawnStateFor(this.built);
  }

  private updateFailsafe(controls: ControlFrame, frameSeconds: number): void {
    const verdict = this.failsafe.update(controls, frameSeconds);
    if (verdict === 'lost' && this.physics.state.flightState === 'armed') {
      this.physics.disarm();
      this.events.push({ type: 'failsafe' });
    }
  }

  private onImpact(impact: ImpactEvent): void {
    this.events.push({ type: 'impact', impact });
    const rules = this.impactRules;

    if (impact.source === 'ground') {
      const crater = craterFromSpeed(impact.speed, rules);
      if (crater) {
        const spec: Crater = { x: impact.point.x, z: impact.point.z, radius: crater.radius, depth: crater.depth };
        const dirty = this.terrain.applyCrater(spec);
        if (dirty) this.events.push({ type: 'crater', crater: spec, dirty });
      }
      this.spawnFragments(impact.point, rules.fragmentsPerImpact(impact.speed));
      return;
    }

    const structureId = impact.colliderId ? this.structureByCollider.get(impact.colliderId) : undefined;
    if (!structureId) return;
    const structure = this.structures.get(structureId);
    const center = this.structureCenters.get(structureId);
    if (!structure || !center || structure.state === 'destroyed') return;

    const local = vec3(impact.point.x - center.x, impact.point.y - center.y, impact.point.z - center.z);
    const damage = structureDamageFromSpeed(impact.speed, rules);
    const result = damageStructure(structure, local, damage);
    this.structures.set(structureId, result.structure);
    if (result.events.length > 0) this.events.push({ type: 'structure', structureId, events: result.events });
    this.spawnFragments(impact.point, rules.fragmentsPerImpact(impact.speed));

    if (result.structure.state === 'destroyed' && impact.colliderId) {
      this.physics.setColliderEnabled(impact.colliderId, false);
      this.events.push({ type: 'collider-off', colliderId: impact.colliderId });
      this.spawnFragments(impact.point, rules.fragmentsPerImpact(impact.speed) + 8);
    }
  }

  private spawnFragments(origin: Vec3, count: number): void {
    if (count <= 0) return;
    const created = this.fragments.spawn(origin, count, 3 + this.rng.next() * 2);
    this.events.push({ type: 'fragments', origin, count: created });
  }

  private onMission(event: MissionEvent): void {
    this.events.push({ type: 'mission', event });
    if (event.type === 'checkpoint') {
      const amount = missionReward(CHECKPOINT_REWARD, this.built.missionRewardFactor);
      this.setSave({ ...this.progress, balance: this.progress.balance + amount });
      this.events.push({ type: 'reward', amount, reason: 'ponto de controle' });
    }
    if (event.type === 'completed') {
      const amount = missionReward(MISSION_COMPLETE_REWARD, this.built.missionRewardFactor);
      this.setSave({ ...this.progress, balance: this.progress.balance + amount });
      this.events.push({ type: 'reward', amount, reason: 'missão concluída' });
    }
  }

  private setSave(next: SaveData): void {
    this.progress = { ...next, balance: Math.max(0, next.balance) };
    this.onSave?.(this.progress);
  }
}

const messageFor = (reason: 'unknown-part' | 'already-owned' | 'insufficient-funds'): string => {
  switch (reason) {
    case 'unknown-part':
      return 'peça desconhecida';
    case 'already-owned':
      return 'peça já comprada';
    case 'insufficient-funds':
      return 'saldo insuficiente';
  }
};
