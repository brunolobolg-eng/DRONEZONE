import { type ActionResult } from '../gameplay/game-session';
import { type PartCatalog, PART_SLOTS, type PartSlot } from '../gameplay/progression/catalog';
import { buildDrone, compareSpecs, type Loadout, specSheet } from '../gameplay/progression/loadout';
import { repairCost } from '../gameplay/progression/economy';
import { type GameSettings } from '../gameplay/settings';
import { KEY_ACTIONS, KEY_ACTION_LABELS, type KeyAction, actionLabel } from '../gameplay/input/keyboard-axes';
import { QUALITY_PRESETS } from '../rendering/quality';
import { el } from './dom';

export interface WorkshopState {
  readonly catalog: PartCatalog;
  readonly owned: readonly string[];
  readonly equipped: Loadout;
  readonly balance: number;
  readonly armed: boolean;
  readonly integrityLost: number;
}

export interface MenuActions {
  resume(): void;
  restart(): void;
  toggleTelemetry(): void;
  setSettings(patch: Partial<GameSettings>): void;
  beginKeyCapture(action: KeyAction): void;
  resetKeys(): void;
  buy(partId: string): ActionResult;
  equip(loadout: Loadout): ActionResult;
  repair(): ActionResult & { readonly cost: number };
}

type Tab = 'menu' | 'workshop' | 'settings';

const SLOT_LABELS: Record<PartSlot, string> = {
  frame: 'Quadro',
  motors: 'Motores',
  battery: 'Bateria',
  camera: 'Câmera',
  stabilizer: 'Amortecedor',
  mission: 'Equipamento de missão',
};

/**
 * Menu de pausa com três abas: menu principal, oficina (peças, comparação e reparo) e configurações
 * (controles, teclado, gráficos). Todas as ações passam pelo jogo; o menu só mostra e coleta escolhas.
 */
export class Menus {
  private tab: Tab = 'menu';
  private candidate: Loadout | null = null;
  private message = '';
  private capturing: KeyAction | null = null;
  private readonly panel: HTMLElement;
  private readonly tabs: HTMLElement;
  private readonly root: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly actions: MenuActions,
    private settings: GameSettings,
    private workshop: WorkshopState | null = null,
  ) {
    this.root = root;
    this.panel = el('div', { class: 'menu-body' });
    this.tabs = el('nav', { class: 'menu-tabs' });
    root.replaceChildren(el('div', { class: 'panel menu' }, [this.tabs, this.panel]));
    root.hidden = true;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }

  setSettings(settings: GameSettings): void {
    this.settings = settings;
    if (this.visible) this.render();
  }

  setWorkshop(state: WorkshopState): void {
    this.workshop = state;
    if (this.candidate === null) this.candidate = state.equipped;
    if (this.visible) this.render();
  }

  /** Tecla aguardando: o menu mostra qual ação está sendo remapeada. */
  setCapture(action: KeyAction | null, message = ''): void {
    this.capturing = action;
    this.message = message;
    if (this.visible) this.render();
  }

  setMessage(text: string): void {
    this.message = text;
    if (this.visible) this.render();
  }

  open(tab: Tab = 'menu'): void {
    this.tab = tab;
    this.message = '';
    this.root.hidden = false;
    this.render();
  }

  close(): void {
    this.capturing = null;
    this.root.hidden = true;
  }

  private render(): void {
    this.tabs.replaceChildren(
      this.tabButton('menu', 'Menu'),
      this.tabButton('workshop', 'Oficina'),
      this.tabButton('settings', 'Configurações'),
    );
    if (this.tab === 'menu') this.renderMain();
    else if (this.tab === 'workshop') this.renderWorkshop();
    else this.renderSettings();
  }

  private tabButton(tab: Tab, label: string): HTMLElement {
    return el(
      'button',
      {
        class: this.tab === tab ? 'tab active' : 'tab',
        onclick: () => {
          this.tab = tab;
          this.message = '';
          this.render();
        },
      },
      [label],
    );
  }

  private renderMain(): void {
    this.panel.replaceChildren(
      el('h2', {}, ['Pausa']),
      this.button('Continuar (Esc)', () => this.actions.resume()),
      this.button('Reiniciar voo (Backspace)', () => this.actions.restart()),
      this.button('Telemetria de depuração (Tab)', () => this.actions.toggleTelemetry()),
      el('p', { class: 'muted' }, ['Teclado por padrão: WASD ou setas para voar, R/F acelerador, X corta o acelerador. Teclas podem ser trocadas em Configurações.']),
    );
  }

  private renderWorkshop(): void {
    const w = this.workshop;
    if (!w) {
      this.panel.replaceChildren(el('p', {}, ['Oficina indisponível.']));
      return;
    }
    const candidate = this.candidate ?? w.equipped;
    const select = (slot: PartSlot) => {
      const options = w.catalog.inSlot(slot).map((p) => {
        const owned = w.owned.includes(p.id);
        const label = owned ? p.name : `${p.name} (${p.price} cr)`;
        return el('option', { value: p.id, selected: candidate[slot] === p.id }, [label]);
      });
      return el('label', { class: 'field' }, [
        el('span', {}, [SLOT_LABELS[slot]]),
        el(
          'select',
          {
            onchange: (e: Event) => {
              this.candidate = { ...candidate, [slot]: (e.target as HTMLSelectElement).value };
              this.message = '';
              this.render();
            },
          },
          options,
        ),
      ]);
    };

    let rows: HTMLElement[] = [];
    try {
      const current = specSheet(buildDrone(w.catalog, w.equipped));
      const next = specSheet(buildDrone(w.catalog, candidate));
      rows = compareSpecs(current, next).map((r) =>
        el('tr', { class: r.improved === true ? 'better' : r.improved === false ? 'worse' : '' }, [
          el('td', {}, [r.label]),
          el('td', {}, [r.before]),
          el('td', {}, [r.after]),
        ]),
      );
    } catch (error) {
      this.message = error instanceof Error ? error.message : 'configuração inválida';
    }

    const missing = PART_SLOTS.filter((s) => !w.owned.includes(candidate[s]));
    const pendingPrice = missing.reduce((sum, s) => sum + (w.catalog.get(candidate[s])?.price ?? 0), 0);
    const repair = repairCost(w.integrityLost);

    this.panel.replaceChildren(
      el('h2', {}, ['Oficina']),
      el('p', { class: 'muted' }, [`Saldo: ${w.balance} créditos fictícios`]),
      el('div', { class: 'grid-2' }, PART_SLOTS.map(select)),
      el('table', { class: 'compare' }, [
        el('thead', {}, [el('tr', {}, [el('th', {}, ['Métrica']), el('th', {}, ['Atual']), el('th', {}, ['Candidata'])])]),
        el('tbody', {}, rows),
      ]),
      el('div', { class: 'actions' }, [
        this.button(
          pendingPrice > 0 ? `Comprar peças (${pendingPrice} cr)` : 'Nada a comprar',
          () => this.buyMissing(missing),
          pendingPrice === 0 || missing.length === 0,
        ),
        this.button('Equipar', () => this.equip(candidate), !w.owned.length || missing.length > 0 || w.armed),
        this.button(repair > 0 ? `Reparar (${repair} cr)` : 'Sem reparo necessário', () => this.doRepair(), repair === 0),
      ]),
      el('p', { class: 'status', role: 'status' }, [this.message]),
    );
  }

  private renderSettings(): void {
    const s = this.settings;
    const range = (key: 'deadzone' | 'expo' | 'sensitivity' | 'fov' | 'vibration', min: number, max: number, step: number, label: string) =>
      el('label', { class: 'field' }, [
        el('span', {}, [`${label}: ${Number(s[key]).toFixed(step < 0.1 ? 2 : 1)}`]),
        el('input', {
          type: 'range',
          min,
          max,
          step,
          value: Number(s[key]),
          oninput: (e: Event) => this.actions.setSettings({ [key]: Number((e.target as HTMLInputElement).value) } as Partial<GameSettings>),
        }),
      ]);
    const choice = <T extends string>(key: keyof GameSettings, label: string, options: [T, string][]) =>
      el('label', { class: 'field' }, [
        el('span', {}, [label]),
        el(
          'select',
          {
            onchange: (e: Event) => this.actions.setSettings({ [key]: (e.target as HTMLSelectElement).value } as Partial<GameSettings>),
          },
          options.map(([value, text]) => el('option', { value, selected: s[key] === value }, [text])),
        ),
      ]);
    const toggle = (key: 'cameraEffects' | 'telemetryVisible', label: string) =>
      el('label', { class: 'field check' }, [
        el('input', {
          type: 'checkbox',
          checked: s[key] === true,
          onchange: (e: Event) => this.actions.setSettings({ [key]: (e.target as HTMLInputElement).checked } as Partial<GameSettings>),
        }),
        el('span', {}, [label]),
      ]);

    const rampSlider = el('label', { class: 'field' }, [
      el('span', {}, [`Suavização das teclas: ${s.keyboardRampMs} ms (0 = instantânea)`]),
      el('input', {
        type: 'range',
        min: 0,
        max: 400,
        step: 10,
        value: s.keyboardRampMs,
        oninput: (e: Event) => this.actions.setSettings({ keyboardRampMs: Number((e.target as HTMLInputElement).value) }),
      }),
    ]);

    const keyRow = (action: KeyAction) =>
      el('div', { class: 'key-row' }, [
        el('span', {}, [KEY_ACTION_LABELS[action]]),
        el('kbd', {}, [actionLabel(s.keys, action)]),
        this.button(
          this.capturing === action ? 'Pressione a tecla…' : 'Alterar',
          () => this.actions.beginKeyCapture(action),
          this.capturing !== null && this.capturing !== action,
        ),
      ]);

    this.panel.replaceChildren(
      el('h2', {}, ['Configurações']),
      el('h3', {}, ['Teclado']),
      rampSlider,
      el('p', { class: 'muted' }, [
        this.capturing
          ? `Pressione a nova tecla para "${KEY_ACTION_LABELS[this.capturing]}". Esc cancela.`
          : 'Clique em "Alterar" e pressione a tecla. Cada ação aceita a tecla principal mostrada aqui.',
      ]),
      el('div', { class: 'key-grid' }, KEY_ACTIONS.map(keyRow)),
      el('div', { class: 'actions' }, [
        this.button('Restaurar teclas padrão', () => this.actions.resetKeys(), this.capturing !== null),
      ]),
      el('h3', {}, ['Controle (gamepad)']),
      choice<'mode2' | 'mode1'>('layout', 'Layout', [
        ['mode2', 'Modo 2 (acelerador no stick esquerdo)'],
        ['mode1', 'Modo 1 (acelerador no stick direito)'],
      ]),
      range('deadzone', 0, 0.3, 0.01, 'Zona morta'),
      range('expo', 0, 1, 0.01, 'Curva de resposta'),
      range('sensitivity', 0.25, 2, 0.05, 'Sensibilidade'),
      choice<'absolute' | 'hold'>('throttleMode', 'Acelerador', [
        ['absolute', 'Absoluto (stick define a potência)'],
        ['hold', 'Com mola (mantém a posição ao soltar)'],
      ]),
      el('h3', {}, ['Gráficos e câmera']),
      choice<'low' | 'medium' | 'high'>('quality', 'Qualidade', [
        ['low', QUALITY_PRESETS.low.label],
        ['medium', QUALITY_PRESETS.medium.label],
        ['high', QUALITY_PRESETS.high.label],
      ]),
      range('fov', 50, 110, 1, 'Campo de visão (graus)'),
      toggle('cameraEffects', 'Efeitos de câmera (variação de FOV e vibração)'),
      range('vibration', 0, 1, 0.05, 'Intensidade da vibração'),
      toggle('telemetryVisible', 'Mostrar telemetria de depuração'),
      el('p', { class: 'status', role: 'status' }, [this.message]),
      this.button('Voltar', () => {
        this.tab = 'menu';
        this.render();
      }),
    );
  }

  private buyMissing(missing: PartSlot[]): void {
    if (!this.workshop || !this.candidate) return;
    for (const slot of missing) {
      const result = this.actions.buy(this.candidate[slot]);
      if (!result.ok) {
        this.message = result.reason;
        this.render();
        return;
      }
    }
    this.message = 'Peças compradas. Agora é possível equipar.';
    this.render();
  }

  private equip(loadout: Loadout): void {
    const result = this.actions.equip(loadout);
    this.message = result.ok ? 'Configuração equipada.' : result.reason;
    this.render();
  }

  private doRepair(): void {
    const result = this.actions.repair();
    this.message = result.ok ? `Reparo concluído (${result.cost} cr).` : result.reason;
    this.render();
  }

  private button(label: string, onClick: () => void, disabled = false): HTMLElement {
    return el('button', { class: 'btn', disabled, onclick: onClick }, [label]);
  }
}
