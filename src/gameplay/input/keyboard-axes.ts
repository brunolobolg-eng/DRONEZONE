/**
 * Teclado: ações, teclas padrão e conversão do conjunto de teclas pressionadas em comandos.
 *
 * Padrão (teclado, uma mão no cluster WASD):
 *   A / D (ou ← / →)   rolagem esquerda / direita
 *   W / S (ou ↑ / ↓)   nariz para baixo / para cima
 *   Q / E              guinada esquerda / direita
 *   R / F (ou Shift esq. / Ctrl esq.)   acelerador sobe / desce (mantém a posição ao soltar)
 *   X                  corta o acelerador a zero
 *   Espaço             armar / desarmar
 *   Backspace          reiniciar o voo
 *   Esc                pausar / retomar
 *   Tab                alternar telemetria
 *
 * Cada ação aceita até duas teclas. A primeira é a principal, mostrada na tela e alterada no remapeamento.
 */
import { type ButtonName, type KeyboardReading } from './input-mapping';

export const KEY_ACTIONS = [
  'rollLeft',
  'rollRight',
  'pitchUp',
  'pitchDown',
  'yawLeft',
  'yawRight',
  'throttleUp',
  'throttleDown',
  'throttleZero',
  'arm',
  'reset',
  'pause',
  'telemetry',
] as const;

export type KeyAction = (typeof KEY_ACTIONS)[number];
export type KeyBindings = Readonly<Record<KeyAction, readonly string[]>>;

export const MAX_KEYS_PER_ACTION = 2;

export const KEY_ACTION_LABELS: Record<KeyAction, string> = {
  rollLeft: 'Rolar à esquerda',
  rollRight: 'Rolar à direita',
  pitchUp: 'Nariz para cima',
  pitchDown: 'Nariz para baixo',
  yawLeft: 'Guinar à esquerda',
  yawRight: 'Guinar à direita',
  throttleUp: 'Acelerador: subir',
  throttleDown: 'Acelerador: descer',
  throttleZero: 'Cortar acelerador',
  arm: 'Armar / desarmar',
  reset: 'Reiniciar voo',
  pause: 'Pausar / retomar',
  telemetry: 'Telemetria',
};

export const DEFAULT_KEY_BINDINGS: KeyBindings = {
  rollLeft: ['KeyA', 'ArrowLeft'],
  rollRight: ['KeyD', 'ArrowRight'],
  pitchDown: ['KeyW', 'ArrowUp'],
  pitchUp: ['KeyS', 'ArrowDown'],
  yawLeft: ['KeyQ'],
  yawRight: ['KeyE'],
  throttleUp: ['KeyR', 'ShiftLeft'],
  throttleDown: ['KeyF', 'ControlLeft'],
  throttleZero: ['KeyX'],
  arm: ['Space'],
  reset: ['Backspace'],
  pause: ['Escape'],
  telemetry: ['Tab'],
};

const BUTTON_ACTIONS: Readonly<Partial<Record<KeyAction, ButtonName>>> = {
  arm: 'arm',
  reset: 'reset',
  pause: 'pause',
  telemetry: 'telemetry',
};

/** Ações que disparam uma vez por pressionamento (ficam travadas entre quadros). */
export const BUTTON_KEY_ACTIONS = Object.keys(BUTTON_ACTIONS) as KeyAction[];

const SPECIAL_LABELS: Record<string, string> = {
  Space: 'Espaço',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  ShiftLeft: 'Shift esq.',
  ShiftRight: 'Shift dir.',
  ControlLeft: 'Ctrl esq.',
  ControlRight: 'Ctrl dir.',
  AltLeft: 'Alt esq.',
  AltRight: 'Alt dir.',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Enter: 'Enter',
};

/** Texto curto de uma tecla, para mostrar ao jogador. */
export const keyLabel = (code: string): string => {
  if (code in SPECIAL_LABELS) return SPECIAL_LABELS[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
};

/** Teclas de uma ação, como texto: "A / ←". */
export const actionLabel = (bindings: KeyBindings, action: KeyAction): string =>
  bindings[action].map(keyLabel).join(' / ');

/** Primeira tecla que aparece em mais de uma ação, ou null se não há conflito. */
export const findBindingConflict = (bindings: KeyBindings): { code: string; actions: KeyAction[] } | null => {
  const owners = new Map<string, KeyAction[]>();
  for (const action of KEY_ACTIONS) {
    for (const code of bindings[action]) {
      const list = owners.get(code) ?? [];
      list.push(action);
      owners.set(code, list);
    }
  }
  for (const [code, actions] of owners) {
    if (actions.length > 1) return { code, actions };
  }
  return null;
};

/** Todas as teclas usadas pelo jogo. O navegador não deve tratá-las como atalhos. */
export const boundCodes = (bindings: KeyBindings): Set<string> => new Set(KEY_ACTIONS.flatMap((a) => bindings[a]));

export type KeyboardAxes = KeyboardReading;

/** Converte as teclas pressionadas em comandos de -1 a 1. Pura e testável. */
export const keyboardAxes = (pressed: ReadonlySet<string>, bindings: KeyBindings = DEFAULT_KEY_BINDINGS): KeyboardAxes => {
  const held = (action: KeyAction): boolean => bindings[action].some((code) => pressed.has(code));
  const axis = (negative: KeyAction, positive: KeyAction): number => (held(positive) ? 1 : 0) - (held(negative) ? 1 : 0);
  const roll = axis('rollLeft', 'rollRight');
  const pitch = axis('pitchDown', 'pitchUp');
  const yaw = axis('yawLeft', 'yawRight');
  const throttleDirection = axis('throttleDown', 'throttleUp');
  const cutThrottle = held('throttleZero');
  const buttons = {
    arm: held('arm'),
    reset: held('reset'),
    pause: held('pause'),
    telemetry: held('telemetry'),
  };
  const active = roll !== 0 || pitch !== 0 || yaw !== 0 || throttleDirection !== 0 || cutThrottle || Object.values(buttons).some(Boolean);
  return { roll, pitch, yaw, throttleDirection, cutThrottle, buttons, active };
};

/** Linha de dicas da tela, montada com as teclas reais do jogador. */
export const bindingHint = (bindings: KeyBindings): string => {
  const pair = (neg: KeyAction, pos: KeyAction) => `${bindings[neg][0] ? keyLabel(bindings[neg][0]) : '?'}/${bindings[pos][0] ? keyLabel(bindings[pos][0]) : '?'}`;
  const main = (action: KeyAction) => (bindings[action][0] ? keyLabel(bindings[action][0]) : '?');
  return [
    `${pair('rollLeft', 'rollRight')} rolar`,
    `${pair('pitchDown', 'pitchUp')} arfagem`,
    `${pair('yawLeft', 'yawRight')} guinar`,
    `${main('throttleUp')}/${main('throttleDown')} acelerador`,
    `${main('throttleZero')} cortar`,
    `${main('arm')} armar`,
    `${main('pause')} pausar`,
    `${main('reset')} reiniciar`,
    `${main('telemetry')} telemetria`,
  ].join(' · ');
};
