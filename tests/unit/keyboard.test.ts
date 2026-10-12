import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KEY_BINDINGS,
  bindingHint,
  boundCodes,
  findBindingConflict,
  keyLabel,
  keyboardAxes,
} from '../../src/gameplay/input/keyboard-axes';
import { KeyboardRamp, rampToward } from '../../src/gameplay/input/keyboard-ramp';
import { type KeyboardReading, resolveControls } from '../../src/gameplay/input/input-mapping';
import { DEFAULT_SETTINGS, sanitizeSettings, toControlsSettings } from '../../src/gameplay/settings';

const pressed = (...codes: string[]) => new Set(codes);
const reading = (over: Partial<KeyboardReading> = {}): KeyboardReading => ({
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttleDirection: 0,
  cutThrottle: false,
  buttons: { arm: false, reset: false, pause: false, telemetry: false },
  active: false,
  ...over,
});

describe('teclas padrão', () => {
  it('WASD e setas ocupam as mesmas ações', () => {
    expect(keyboardAxes(pressed('KeyD')).roll).toBe(1);
    expect(keyboardAxes(pressed('ArrowRight')).roll).toBe(1);
    expect(keyboardAxes(pressed('KeyA')).roll).toBe(-1);
    expect(keyboardAxes(pressed('ArrowLeft')).roll).toBe(-1);
    expect(keyboardAxes(pressed('KeyW')).pitch).toBe(-1);
    expect(keyboardAxes(pressed('ArrowUp')).pitch).toBe(-1);
    expect(keyboardAxes(pressed('KeyS')).pitch).toBe(1);
  });

  it('R e F controlam o acelerador, e Shift/Ctrl são alternativas', () => {
    expect(keyboardAxes(pressed('KeyR')).throttleDirection).toBe(1);
    expect(keyboardAxes(pressed('ShiftLeft')).throttleDirection).toBe(1);
    expect(keyboardAxes(pressed('KeyF')).throttleDirection).toBe(-1);
    expect(keyboardAxes(pressed('ControlLeft')).throttleDirection).toBe(-1);
  });

  it('X corta o acelerador', () => {
    expect(keyboardAxes(pressed('KeyX')).cutThrottle).toBe(true);
    expect(keyboardAxes(pressed('KeyR')).cutThrottle).toBe(false);
  });

  it('teclas opostas se anulam, e nenhuma tecla deixa o teclado inativo', () => {
    expect(keyboardAxes(pressed('KeyA', 'KeyD')).roll).toBe(0);
    expect(keyboardAxes(new Set()).active).toBe(false);
  });

  it('botões de ação: espaço arma, backspace reinicia, esc pausa, tab telemetria', () => {
    const axes = keyboardAxes(pressed('Space', 'Backspace', 'Escape', 'Tab'));
    expect(axes.buttons).toEqual({ arm: true, reset: true, pause: true, telemetry: true });
  });

  it('o conjunto de teclas do jogo cobre todas as ações', () => {
    expect(boundCodes(DEFAULT_KEY_BINDINGS).has('KeyR')).toBe(true);
    expect(findBindingConflict(DEFAULT_KEY_BINDINGS)).toBeNull();
  });
});

describe('remapeamento', () => {
  it('usa o mapeamento recebido, e as teclas antigas deixam de valer', () => {
    const custom = { ...DEFAULT_KEY_BINDINGS, rollRight: ['KeyL'] };
    expect(keyboardAxes(pressed('KeyL'), custom).roll).toBe(1);
    expect(keyboardAxes(pressed('KeyD'), custom).roll).toBe(0);
  });

  it('detecta a mesma tecla em duas ações', () => {
    const bad = { ...DEFAULT_KEY_BINDINGS, yawLeft: ['KeyE'] };
    const conflict = findBindingConflict(bad);
    expect(conflict?.code).toBe('KeyE');
    expect(conflict?.actions.sort()).toEqual(['yawLeft', 'yawRight'].sort());
  });

  it('rótulos amigáveis para as teclas comuns', () => {
    expect(keyLabel('KeyA')).toBe('A');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Space')).toBe('Espaço');
    expect(keyLabel('ShiftLeft')).toBe('Shift esq.');
  });

  it('a dica da tela usa as teclas reais do jogador', () => {
    const hint = bindingHint({ ...DEFAULT_KEY_BINDINGS, arm: ['KeyG'] });
    expect(hint).toContain('G armar');
    expect(hint).toContain('A/D rolar');
    expect(hint).toContain('R/F acelerador');
  });
});

describe('corte de acelerador e controles', () => {
  const settings = toControlsSettings(DEFAULT_SETTINGS);

  it('a tecla de corte zera a potência mesmo com subida pressionada', () => {
    const frame = resolveControls({
      gamepad: null,
      keyboard: reading({ throttleDirection: 1, cutThrottle: true, active: true }),
      settings,
      previousThrottle: 0.8,
      dt: 0.1,
    });
    expect(frame.throttle).toBe(0);
  });

  it('acelerador com teclado sobe devagar e mantém a posição ao soltar', () => {
    const up = resolveControls({ gamepad: null, keyboard: reading({ throttleDirection: 1, active: true }), settings, previousThrottle: 0.2, dt: 0.5 });
    expect(up.throttle).toBeGreaterThan(0.2);
    const hold = resolveControls({ gamepad: null, keyboard: reading(), settings, previousThrottle: up.throttle, dt: 0.5 });
    expect(hold.throttle).toBe(up.throttle);
  });
});

describe('suavização das teclas (rampa)', () => {
  it('sobe até o alvo no tempo de subida e desce no tempo de descida', () => {
    // Subida: 0,12 s até o alvo, com passos de 0,02 s (6 passos). Metade do caminho em 3 passos.
    let v = 0;
    for (let i = 0; i < 3; i++) v = rampToward(v, 1, 0.02, 0.12, 0.084);
    expect(v).toBeCloseTo(0.5, 6);
    for (let i = 0; i < 3; i++) v = rampToward(v, 1, 0.02, 0.12, 0.084);
    expect(v).toBe(1);
    // Descida: 0,084 s até zero. Dois passos de 0,02 s tiram 2/(0,084/0,02) do caminho.
    let down = 1;
    for (let i = 0; i < 2; i++) down = rampToward(down, 0, 0.02, 0.12, 0.084);
    expect(down).toBeCloseTo(1 - (2 * 0.02) / 0.084, 6);
  });

  it('com tempo zero, a resposta é instantânea', () => {
    expect(rampToward(0, 1, 0.01, 0, 0)).toBe(1);
  });

  it('nunca ultrapassa o alvo', () => {
    expect(rampToward(0.95, 1, 1, 0.12, 0.08)).toBe(1);
    expect(rampToward(-0.5, 0, 10, 0.12, 0.08)).toBe(0);
  });

  it('KeyboardRamp suaviza só os eixos, e 0 ms desliga a suavização', () => {
    const ramp = new KeyboardRamp();
    const soft = ramp.update(reading({ roll: 1, throttleDirection: 1 }), 0.03, 120);
    expect(soft.roll).toBeGreaterThan(0);
    expect(soft.roll).toBeLessThan(1);
    expect(soft.throttleDirection).toBe(1);
    const hard = new KeyboardRamp().update(reading({ roll: 1 }), 0.001, 0);
    expect(hard.roll).toBe(1);
  });
});

describe('configurações de teclado', () => {
  it('teclas válidas são aceitas, com alternativa', () => {
    const r = sanitizeSettings({ keys: { rollRight: ['KeyL', 'ArrowRight'] } });
    expect(r.settings.keys.rollRight).toEqual(['KeyL', 'ArrowRight']);
    expect(r.warnings).toHaveLength(0);
  });

  it('mais de duas teclas, código inválido ou repetido em uma ação são recusados', () => {
    const r = sanitizeSettings({ keys: { arm: ['KeyA', 'KeyB', 'KeyC'], pause: ['bad code!'], telemetry: ['KeyT', 'KeyT'] } });
    expect(r.settings.keys.arm).toEqual(DEFAULT_KEY_BINDINGS.arm);
    expect(r.settings.keys.pause).toEqual(DEFAULT_KEY_BINDINGS.pause);
    expect(r.settings.keys.telemetry).toEqual(DEFAULT_KEY_BINDINGS.telemetry);
    expect(r.warnings.length).toBe(3);
  });

  it('tecla usada em duas ações volta todo o mapeamento ao padrão, com aviso', () => {
    const r = sanitizeSettings({ keys: { rollRight: ['KeyA'] } });
    expect(r.settings.keys).toEqual(DEFAULT_KEY_BINDINGS);
    expect(r.warnings.some((w) => w.includes('KeyA'))).toBe(true);
  });

  it('suavização é limitada entre 0 e 400 ms', () => {
    expect(sanitizeSettings({ keyboardRampMs: 9999 }).settings.keyboardRampMs).toBe(400);
    expect(sanitizeSettings({ keyboardRampMs: -5 }).settings.keyboardRampMs).toBe(0);
    expect(sanitizeSettings({}).settings.keyboardRampMs).toBe(DEFAULT_SETTINGS.keyboardRampMs);
  });

  it('configuração antiga, sem teclas, recebe o padrão', () => {
    expect(sanitizeSettings({ quality: 'high' }).settings.keys).toEqual(DEFAULT_KEY_BINDINGS);
  });
});
