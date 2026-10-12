import { describe, expect, it } from 'vitest';
import { GameSession } from '../../src/gameplay/game-session';
import { DEFAULT_KEY_BINDINGS, keyboardAxes } from '../../src/gameplay/input/keyboard-axes';
import { KeyboardRamp } from '../../src/gameplay/input/keyboard-ramp';
import { resolveControls, type ControlFrame } from '../../src/gameplay/input/input-mapping';
import { DEFAULT_SETTINGS, toControlsSettings } from '../../src/gameplay/settings';
import { DEFAULT_CATALOG } from '../../src/gameplay/progression/catalog';
import { createNewSave } from '../../src/gameplay/progression/save-data';

/**
 * Voo só com teclado, pelo mesmo caminho do navegador:
 * teclas -> suavização -> resolução de controles -> sessão.
 */
const flyKeyboard = () => {
  const session = new GameSession({ catalog: DEFAULT_CATALOG, save: createNewSave(DEFAULT_CATALOG), seed: 7, fixedHz: 250 });
  const ramp = new KeyboardRamp();
  const settings = toControlsSettings(DEFAULT_SETTINGS);
  let throttle = 0;

  const step = (codes: string[], seconds: number): ControlFrame | null => {
    let last: ControlFrame | null = null;
    const frames = Math.round(seconds * 60);
    for (let i = 0; i < frames; i++) {
      const raw = keyboardAxes(new Set(codes), DEFAULT_KEY_BINDINGS);
      const keyboard = ramp.update(raw, 1 / 60, DEFAULT_SETTINGS.keyboardRampMs);
      const frame = resolveControls({ gamepad: null, keyboard, settings, previousThrottle: throttle, dt: 1 / 60 });
      throttle = frame.throttle;
      session.frame(frame, 1 / 60);
      last = frame;
    }
    return last;
  };
  return { session, step };
};

describe('voo só com teclado', () => {
  it('arma com Espaço, sobe com R e corta com X', () => {
    const { session, step } = flyKeyboard();
    step(['Space'], 1 / 60);
    expect(session.world.state.flightState).toBe('armed');
    step([], 0.2);

    step(['KeyR'], 3);
    const high = session.world.state.position.y;
    expect(high).toBeGreaterThan(5);

    // Cortar: o acelerador vai a zero e os motores param de empurrar. A altitude não cai de imediato,
    // porque o drone ainda tem velocidade vertical (inércia); o teste não exige queda instantânea.
    const cut = step(['KeyX'], 0.5);
    expect(cut?.throttle).toBe(0);
    const thrust = session.world.state.motorThrust.reduce((a, b) => a + b, 0);
    expect(thrust).toBeLessThan(0.5);
  });

  it('rolar com D inclina para a direita, e com A para a esquerda', () => {
    const { session, step } = flyKeyboard();
    step(['Space'], 1 / 60);
    step(['KeyR'], 0.5);
    step([], 0.3);

    step(['KeyD'], 0.15);
    expect(session.world.state.angularVelocity.x).toBeGreaterThan(0);

    const other = flyKeyboard();
    other.step(['Space'], 1 / 60);
    other.step(['KeyR'], 0.5);
    other.step([], 0.3);
    other.step(['KeyA'], 0.15);
    expect(other.session.world.state.angularVelocity.x).toBeLessThan(0);
  });

  it('a seta direita rola como D, e Backspace reinicia o voo', () => {
    const { session, step } = flyKeyboard();
    step(['Space'], 1 / 60);
    expect(session.world.state.flightState).toBe('armed');
    step(['ArrowRight'], 0.15);
    expect(session.world.state.angularVelocity.x).toBeGreaterThan(0);
    step(['Backspace'], 1 / 60);
    expect(session.world.state.flightState).toBe('disarmed');
  });

  it('teclado ocioso não desarma o drone (o failsafe é só para gamepad)', () => {
    const { session, step } = flyKeyboard();
    step(['Space'], 1 / 60);
    step(['KeyR'], 0.4);
    step([], 5);
    expect(session.world.state.flightState).toBe('armed');
  });
});
