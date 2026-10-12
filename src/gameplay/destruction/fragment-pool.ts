import { type Rng } from '../../core/math/random';
import { type Vec3, vec3 } from '../../core/math/vec3';

export interface Fragment {
  active: boolean;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Tempo restante de vida, em segundos. */
  life: number;
  /** Escala relativa do fragmento (visual). */
  size: number;
  /** Ordem de criação, para descartar o mais antigo quando o limite é atingido. */
  age: number;
}

export interface FragmentPoolOptions {
  /** Limite físico de fragmentos ativos ao mesmo tempo. */
  readonly capacity: number;
  /** Vida padrão de cada fragmento, em segundos. */
  readonly lifetime: number;
  /** Fragmentos mais longe que isso do drone são removidos, em metros. */
  readonly despawnDistance: number;
  readonly restitution: number;
}

/**
 * Pool de fragmentos com capacidade fixa. Nenhum objeto é criado depois da construção:
 * os slots são reaproveitados. Quando a capacidade acaba, o fragmento mais antigo é reciclado.
 */
export class FragmentPool {
  private readonly slots: Fragment[];
  private counter = 0;

  constructor(
    private readonly options: FragmentPoolOptions,
    private readonly rng: Rng,
  ) {
    this.slots = Array.from({ length: options.capacity }, () => ({
      active: false,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      life: 0,
      size: 1,
      age: 0,
    }));
  }

  get capacity(): number {
    return this.slots.length;
  }

  get activeCount(): number {
    let n = 0;
    for (const s of this.slots) if (s.active) n++;
    return n;
  }

  /** Fragmentos ativos, para a camada visual. Não copia; leia imediatamente. */
  get fragments(): readonly Fragment[] {
    return this.slots;
  }

  /** Cria `count` fragmentos saindo de `origin`. Retorna quantos foram criados. */
  spawn(origin: Vec3, count: number, speed: number): number {
    let created = 0;
    for (let k = 0; k < count; k++) {
      const slot = this.freeSlot() ?? this.oldestSlot();
      const dir = this.randomDirection();
      const v = speed * (0.4 + 0.6 * this.rng.next());
      slot.active = true;
      slot.x = origin.x;
      slot.y = origin.y;
      slot.z = origin.z;
      slot.vx = dir.x * v;
      slot.vy = Math.abs(dir.y) * v + speed * 0.3;
      slot.vz = dir.z * v;
      slot.life = this.options.lifetime * (0.7 + 0.3 * this.rng.next());
      slot.size = 0.5 + this.rng.next();
      slot.age = ++this.counter;
      created++;
    }
    return created;
  }

  /**
   * Avança a física simples (balística com quique no solo). Remove fragmentos
   * expirados ou distantes do centro de interesse, o drone.
   */
  update(dt: number, groundHeightAt: (x: number, z: number) => number, center: Vec3, gravity: number): number {
    let removed = 0;
    for (const s of this.slots) {
      if (!s.active) continue;
      s.life -= dt;
      s.vy -= gravity * dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.z += s.vz * dt;
      const ground = groundHeightAt(s.x, s.z) + 0.02;
      if (s.y < ground) {
        s.y = ground;
        s.vy = -s.vy * this.options.restitution;
        s.vx *= 0.6;
        s.vz *= 0.6;
      }
      const far = Math.hypot(s.x - center.x, s.z - center.z) > this.options.despawnDistance;
      if (s.life <= 0 || far) {
        s.active = false;
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    for (const s of this.slots) s.active = false;
  }

  private freeSlot(): Fragment | undefined {
    return this.slots.find((s) => !s.active);
  }

  private oldestSlot(): Fragment {
    let oldest = this.slots[0];
    for (const s of this.slots) if (s.age < oldest.age) oldest = s;
    return oldest;
  }

  private randomDirection(): Vec3 {
    const theta = this.rng.range(0, Math.PI * 2);
    const phi = this.rng.range(0.2, Math.PI / 2);
    return vec3(Math.cos(theta) * Math.cos(phi), Math.sin(phi), Math.sin(theta) * Math.cos(phi));
  }
}
