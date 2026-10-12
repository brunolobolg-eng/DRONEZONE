import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, sanitizeSettings, toControlsSettings } from '../../src/gameplay/settings';
import { keyboardAxes, DEFAULT_KEY_BINDINGS } from '../../src/gameplay/input/keyboard-axes';
import {
  ButtonEdges,
  absoluteThrottle,
  integrateThrottle,
  resolveControls,
  stickCommand,
  type GamepadReading,
  type KeyboardReading,
  type ControlsSettings,
} from '../../src/gameplay/input/input-mapping';

const NO_KEYS: KeyboardReading = {
  roll: 0,
  pitch: 0,
  yaw: 0,
  throttleDirection: 0,
  cutThrottle: false,
  buttons: { arm: false, reset: false, pause: false, telemetry: false },
  active: false,
};

const settings = toControlsSettings(DEFAULT_SETTINGS);
const pad = (axes: number[], buttons: boolean[] = []): GamepadReading => ({ axes, buttons });
/** Valor esperado depois da zona morta padrão, que reescalona a faixa restante até ±1. */
const afterDeadzone = (v: number): number => {
  const dz = DEFAULT_SETTINGS.deadzone;
  return Math.sign(v) * (Math.abs(v) - dz) / (1 - dz);
};

describe('gamepad: deadzone, inversão e sensibilidade', () => {
  it('ignora o ruído do centro do stick', () => {
    expect(stickCommand(0.03, { index: 0, invert: false }, 0.06)).toBe(0);
  });

  it('inverte o eixo quando configurado', () => {
    expect(stickCommand(0.8, { index: 0, invert: true }, 0)).toBeCloseTo(-0.8, 12);
  });

  it('acelerador absoluto: stick para cima (-1) = 100%, para baixo (+1) = 0%', () => {
    const b = { index: 1, invert: false };
    expect(absoluteThrottle(-1, b)).toBe(1);
    expect(absoluteThrottle(1, b)).toBe(0);
    expect(absoluteThrottle(0, b)).toBeCloseTo(0.5, 12);
  });

  it('acelerador com mola mantém a posição ao soltar o stick', () => {
    const v = integrateThrottle(0.4, 0, 1, 0.5);
    expect(v).toBe(0.4);
    expect(integrateThrottle(0.4, 1, 1, 0.1)).toBeCloseTo(0.5, 12);
    expect(integrateThrottle(0.98, 1, 1, 1)).toBe(1);
  });
});

describe('resolução de controles', () => {
  it('mapeia o layout padrão (modo 2) para roll, pitch, yaw e acelerador', () => {
    const frame = resolveControls({
      gamepad: pad([0.5, -1, 0.7, 0.3]),
      keyboard: NO_KEYS,
      settings,
      previousThrottle: 0,
      dt: 1 / 60,
    });
    expect(frame.input.yaw).toBeCloseTo(afterDeadzone(0.5), 6);
    expect(frame.input.roll).toBeCloseTo(afterDeadzone(0.7), 6);
    expect(frame.input.pitch).toBeCloseTo(afterDeadzone(0.3), 6);
    // Stick do acelerador totalmente para cima (-1) = 100%.
    expect(frame.throttle).toBe(1);
    expect(frame.gamepadConnected).toBe(true);
  });

  it('o remapeamento troca os eixos sem mudar o código do jogo', () => {
    const remapped: ControlsSettings = {
      ...settings,
      axes: { ...settings.axes, roll: { index: 0, invert: true } },
    };
    const frame = resolveControls({
      gamepad: pad([0.6, 0, 0, 0]),
      keyboard: NO_KEYS,
      settings: remapped,
      previousThrottle: 0.5,
      dt: 0,
    });
    expect(frame.input.roll).toBeCloseTo(-afterDeadzone(0.6), 6);
  });

  it('sensibilidade escala as entradas de atitude e satura em ±1', () => {
    const s = { ...settings, sensitivity: 2 };
    const frame = resolveControls({ gamepad: pad([0, 0, 0.8, 0]), keyboard: NO_KEYS, settings: s, previousThrottle: 0, dt: 0 });
    expect(frame.input.roll).toBe(1);
  });

  it('teclado funciona sem gamepad, e a fonte com maior deflexão vence', () => {
    const keys: KeyboardReading = { ...NO_KEYS, roll: 1, active: true };
    const frame = resolveControls({ gamepad: null, keyboard: keys, settings, previousThrottle: 0.2, dt: 0.1 });
    expect(frame.input.roll).toBe(1);
    expect(frame.gamepadConnected).toBe(false);
    expect(frame.keyboardActive).toBe(true);

    // Stick de rolagem fraco (no eixo 2) perde para a tecla A/D totalmente pressionada.
    const weakPad = resolveControls({ gamepad: pad([0, 0, 0.2, 0]), keyboard: keys, settings, previousThrottle: 0, dt: 0 });
    expect(weakPad.input.roll).toBe(1);
  });

  it('botões do gamepad e do teclado são combinados', () => {
    const frame = resolveControls({
      gamepad: pad([0, 0, 0, 0], [true, false, false, false, false, false, false, false, false, true]),
      keyboard: NO_KEYS,
      settings,
      previousThrottle: 0,
      dt: 0,
    });
    expect(frame.buttons.arm).toBe(true);
    expect(frame.buttons.pause).toBe(true);
    expect(frame.buttons.reset).toBe(false);
  });

  it('modo com mola usa o teclado para subir o acelerador sem gamepad', () => {
    const holdSettings: ControlsSettings = { ...settings, throttleMode: 'hold', throttleRate: 1 };
    const keys: KeyboardReading = { ...NO_KEYS, throttleDirection: 1, active: true };
    const frame = resolveControls({ gamepad: null, keyboard: keys, settings: holdSettings, previousThrottle: 0.2, dt: 0.25 });
    expect(frame.throttle).toBeCloseTo(0.45, 9);
  });
});

describe('desconexão e reconexão do gamepad', () => {
  it('sem gamepad, o teclado segue funcionando e o estado informa a ausência', () => {
    const connected = resolveControls({ gamepad: pad([0.5, 0, 0, 0]), keyboard: NO_KEYS, settings, previousThrottle: 0, dt: 0 });
    const disconnected = resolveControls({ gamepad: null, keyboard: NO_KEYS, settings, previousThrottle: 0, dt: 0 });
    expect(connected.gamepadConnected).toBe(true);
    expect(disconnected.gamepadConnected).toBe(false);
    expect(disconnected.input.yaw).toBe(0);
  });

  it('sticks de um gamepad removido não vazam para a próxima leitura', () => {
    const before = resolveControls({ gamepad: pad([0, 0, 0.9, 0]), keyboard: NO_KEYS, settings, previousThrottle: 0, dt: 0 });
    const after = resolveControls({ gamepad: null, keyboard: NO_KEYS, settings, previousThrottle: 0, dt: 0 });
    expect(before.input.roll).toBeGreaterThan(0.5);
    expect(after.input.roll).toBe(0);
  });
});

describe('bordas de botão', () => {
  it('um pressionamento gera exatamente um evento, mesmo com o botão segurado', () => {
    const edges = new ButtonEdges();
    const down = { arm: true, reset: false, pause: false, telemetry: false };
    const up = { arm: false, reset: false, pause: false, telemetry: false };
    expect(edges.update(down)).toEqual(['arm']);
    expect(edges.update(down)).toEqual([]);
    expect(edges.update(up)).toEqual([]);
    expect(edges.update(down)).toEqual(['arm']);
  });
});

describe('teclado', () => {
  it('converte teclas em eixos de -1 a 1', () => {
    const axes = keyboardAxes(new Set([DEFAULT_KEY_BINDINGS.rollRight[0], DEFAULT_KEY_BINDINGS.pitchDown[0], DEFAULT_KEY_BINDINGS.throttleUp[0]]));
    expect(axes.roll).toBe(1);
    expect(axes.pitch).toBe(-1);
    expect(axes.throttleDirection).toBe(1);
    expect(axes.active).toBe(true);
  });

  it('teclas opostas se anulam', () => {
    const axes = keyboardAxes(new Set([DEFAULT_KEY_BINDINGS.rollLeft[0], DEFAULT_KEY_BINDINGS.rollRight[0]]));
    expect(axes.roll).toBe(0);
  });

  it('sem teclas, o teclado está inativo', () => {
    expect(keyboardAxes(new Set()).active).toBe(false);
  });
});

describe('configurações', () => {
  it('valores inválidos voltam ao padrão com aviso, sem derrubar o restante', () => {
    const result = sanitizeSettings({ deadzone: 'alto', fov: 85, quality: 'ultra', layout: 'mode2', cameraEffects: 'sim' });
    expect(result.settings.deadzone).toBe(DEFAULT_SETTINGS.deadzone);
    expect(result.settings.fov).toBe(85);
    expect(result.settings.quality).toBe('medium');
    expect(result.warnings.length).toBeGreaterThanOrEqual(3);
  });

  it('valores fora do intervalo são limitados', () => {
    const result = sanitizeSettings({ fov: 500, deadzone: 0.9, vibration: -3 });
    expect(result.settings.fov).toBe(110);
    expect(result.settings.deadzone).toBe(0.3);
    expect(result.settings.vibration).toBe(0);
  });

  it('entrada nula ou corrompida gera configuração padrão', () => {
    expect(sanitizeSettings(null).settings).toEqual(DEFAULT_SETTINGS);
    expect(sanitizeSettings('lixo').warnings.length).toBe(1);
  });

  it('eixos e botões remapeados são aceitos, e índices inválidos são descartados', () => {
    const result = sanitizeSettings({
      axes: { roll: { index: 5, invert: true }, pitch: { index: -2 } },
      buttons: { arm: 4 },
    });
    expect(result.settings.axes.roll).toEqual({ index: 5, invert: true });
    expect(result.settings.axes.pitch).toEqual(DEFAULT_SETTINGS.axes.pitch);
    expect(result.settings.buttons.arm).toBe(4);
    expect(result.warnings.some((w) => w.includes('pitch'))).toBe(true);
  });
});
