import { distance, type Vec3 } from '../../core/math/vec3';
import { type Checkpoint } from '../environment/layout';

export type MissionStatus = 'ready' | 'running' | 'completed' | 'failed';

export type MissionEvent =
  | { readonly type: 'checkpoint'; readonly checkpoint: Checkpoint; readonly index: number; readonly total: number }
  | { readonly type: 'completed'; readonly elapsed: number }
  | { readonly type: 'failed'; readonly reason: string };

/**
 * Missão de inspeção: atravessar os pontos de controle em ordem, sem limite de tempo nesta versão.
 * O cronômetro começa no primeiro armamento.
 */
export class Mission {
  private status: MissionStatus = 'ready';
  private next = 0;
  private startTime = 0;
  private endTime = 0;

  constructor(private readonly checkpoints: readonly Checkpoint[]) {
    if (checkpoints.length === 0) throw new RangeError('A missão precisa de pelo menos um ponto');
  }

  get state(): MissionStatus {
    return this.status;
  }

  get progress(): { readonly index: number; readonly total: number } {
    return { index: this.next, total: this.checkpoints.length };
  }

  get nextCheckpoint(): Checkpoint | null {
    return this.checkpoints[this.next] ?? null;
  }

  /** Tempo decorrido da missão, em segundos de simulação. */
  elapsed(now: number): number {
    if (this.status === 'ready') return 0;
    return (this.status === 'running' ? now : this.endTime) - this.startTime;
  }

  start(now: number): void {
    if (this.status !== 'ready') return;
    this.status = 'running';
    this.startTime = now;
  }

  /** Verifica se a posição atravessou o próximo ponto. Retorna os eventos gerados. */
  update(position: Vec3, now: number): MissionEvent[] {
    if (this.status !== 'running') return [];
    const events: MissionEvent[] = [];
    const cp = this.checkpoints[this.next];
    if (cp && distance(position, cp.position) <= cp.radius) {
      events.push({ type: 'checkpoint', checkpoint: cp, index: this.next, total: this.checkpoints.length });
      this.next++;
      if (this.next >= this.checkpoints.length) {
        this.status = 'completed';
        this.endTime = now;
        events.push({ type: 'completed', elapsed: this.endTime - this.startTime });
      }
    }
    return events;
  }

  fail(reason: string, now: number): MissionEvent[] {
    if (this.status !== 'running') return [];
    this.status = 'failed';
    this.endTime = now;
    return [{ type: 'failed', reason }];
  }

  reset(): void {
    this.status = 'ready';
    this.next = 0;
    this.startTime = 0;
    this.endTime = 0;
  }
}
