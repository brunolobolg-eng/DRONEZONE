import { type DroneTelemetry } from '../core/telemetry/telemetry';
import { el, fmt } from './dom';

export interface HudSnapshot {
  readonly telemetry: DroneTelemetry;
  readonly balance: number;
  readonly equipment: readonly string[];
  readonly missionProgress: { readonly index: number; readonly total: number };
  readonly missionStatus: string;
  readonly missionElapsed: number;
  readonly gamepad: { readonly connected: boolean; readonly id: string };
}

const STATE_LABELS: Record<DroneTelemetry['flightState'], string> = {
  disarmed: 'Desarmado',
  armed: 'Armado',
  crashed: 'Destruído',
};

const MISSION_LABELS: Record<string, string> = {
  ready: 'Pronta: arme o drone para começar',
  running: 'Em andamento',
  completed: 'Concluída',
  failed: 'Falhou',
};

/** HUD principal: valores de voo, missão e avisos. Atualiza o DOM só quando o texto muda. */
export class Hud {
  private readonly values = new Map<string, HTMLElement>();
  private readonly warningsEl: HTMLElement;
  private readonly warnings: { text: string; expires: number }[] = [];
  private lastWarningKey = '';

  constructor(root: HTMLElement) {
    const field = (key: string, label: string): HTMLElement => {
      const value = el('span', { class: 'value' });
      this.values.set(key, value);
      return el('div', { class: 'row' }, [el('span', { class: 'label' }, [label]), value]);
    };
    root.replaceChildren(
      el('div', { class: 'panel hud-main' }, [
        field('speed', 'Velocidade'),
        field('altitude', 'Altitude'),
        field('attitude', 'Orientação'),
        field('battery', 'Bateria'),
        field('integrity', 'Integridade'),
        field('state', 'Estado'),
        field('balance', 'Saldo (fictício)'),
        field('equipment', 'Equipamento'),
      ]),
      el('div', { class: 'panel hud-mission' }, [field('mission', 'Missão'), field('timer', 'Tempo')]),
      el('div', { class: 'hint' }, ['Espaço armar · Esc pausar · Backspace reiniciar · Tab telemetria']),
      el('div', { class: 'gamepad-status' }, [field('gamepad', 'Controle')]),
    );
    this.warningsEl = el('div', { class: 'warnings', role: 'status', 'aria-live': 'polite' });
    root.append(this.warningsEl);
  }

  /** Acrescenta um aviso curto que some depois de alguns segundos. */
  warn(text: string, now: number, seconds = 4): void {
    this.warnings.push({ text, expires: now + seconds * 1000 });
    if (this.warnings.length > 4) this.warnings.shift();
  }

  update(snapshot: HudSnapshot, now: number): void {
    const t = snapshot.telemetry;
    this.set('speed', `${fmt(t.speedKmh)} km/h`);
    this.set('altitude', `${fmt(t.altitudeAgl, 1)} m`);
    this.set('attitude', `P ${fmt(t.pitchDeg)}° · R ${fmt(t.rollDeg)}° · ${fmt(t.headingDeg)}°`);
    this.set('battery', `${fmt(t.batteryPct)}% · ${fmt(t.batteryVoltage, 1)} V`);
    this.set('integrity', `${fmt(t.integrityPct)}%`);
    this.set('state', STATE_LABELS[t.flightState]);
    this.set('balance', `${snapshot.balance} cr`);
    this.set('equipment', snapshot.equipment.join(' · '));
    const { index, total } = snapshot.missionProgress;
    this.set('mission', `${MISSION_LABELS[snapshot.missionStatus] ?? snapshot.missionStatus} (${index}/${total})`);
    this.set('timer', formatTime(snapshot.missionElapsed));
    this.set('gamepad', snapshot.gamepad.connected ? snapshot.gamepad.id.split('(')[0].trim() || 'conectado' : 'teclado');

    this.refreshWarnings(snapshot, now);
  }

  private refreshWarnings(snapshot: HudSnapshot, now: number): void {
    const t = snapshot.telemetry;
    const conditions: string[] = [];
    if (t.batteryPct < 20 && t.flightState !== 'crashed') conditions.push('Bateria baixa');
    if (t.integrityPct < 30 && t.flightState !== 'crashed') conditions.push('Estrutura comprometida');
    if (t.saturated && t.flightState === 'armed') conditions.push('Motores no limite');
    const key = conditions.join('|');
    if (key !== this.lastWarningKey) {
      this.lastWarningKey = key;
      for (const c of conditions) this.warn(c, now, 2.5);
    }
    const active = this.warnings.filter((w) => w.expires > now);
    this.warnings.splice(0, this.warnings.length, ...active);
    this.warningsEl.replaceChildren(...active.map((w) => el('div', { class: 'warning' }, [w.text])));
  }

  private set(key: string, text: string): void {
    const node = this.values.get(key);
    if (node && node.textContent !== text) node.textContent = text;
  }
}

/** Painel de depuração, independente do HUD. Mostra o que o núcleo produz, sem filtros. */
export class TelemetryPanel {
  private readonly pre: HTMLElement;

  constructor(root: HTMLElement) {
    this.pre = el('pre', { class: 'telemetry-text' });
    root.replaceChildren(el('div', { class: 'panel telemetry-panel' }, [el('strong', {}, ['Telemetria de depuração']), this.pre]));
  }

  update(lines: Record<string, string | number>): void {
    this.pre.textContent = Object.entries(lines)
      .map(([k, v]) => `${k.padEnd(18, ' ')} ${typeof v === 'number' ? v.toFixed(3) : v}`)
      .join('\n');
  }
}

const formatTime = (seconds: number): string => {
  const s = Math.floor(seconds);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export { formatTime };
