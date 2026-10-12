import { describe, expect, it } from 'vitest';
import { FAILSAFE_SECONDS, SignalFailsafe } from '../../src/gameplay/input/failsafe';

const idle = { gamepadConnected: false, keyboardActive: false };
const pad = { gamepadConnected: true, keyboardActive: false };
const keys = { gamepadConnected: false, keyboardActive: true };

describe('failsafe de perda de sinal', () => {
  it('teclado ocioso nunca dispara o failsafe (entrada neutra é válida)', () => {
    const f = new SignalFailsafe();
    for (let i = 0; i < 60 * 60; i++) expect(f.update(idle, 1 / 60)).toBe('ok');
  });

  it('gamepad desconectado após uso, sem nenhuma entrada, dispara depois de 1,5 s', () => {
    const f = new SignalFailsafe();
    f.update(pad, 1 / 60);
    let verdict: 'ok' | 'lost' = 'ok';
    const frames = Math.ceil(FAILSAFE_SECONDS * 60) + 2;
    for (let i = 0; i < frames && verdict === 'ok'; i++) verdict = f.update(idle, 1 / 60);
    expect(verdict).toBe('lost');
  });

  it('usar o teclado durante a perda assume o controle e cancela o failsafe', () => {
    const f = new SignalFailsafe();
    f.update(pad, 0.1);
    for (let i = 0; i < 60; i++) f.update(idle, 1 / 60);
    expect(f.update(keys, 1 / 60)).toBe('ok');
    expect(f.idle).toBe(0);
    for (let i = 0; i < 60; i++) expect(f.update(keys, 1 / 60)).toBe('ok');
  });

  it('reconectar o gamepad cancela o failsafe', () => {
    const f = new SignalFailsafe();
    f.update(pad, 0.1);
    for (let i = 0; i < 40; i++) f.update(idle, 1 / 60);
    expect(f.update(pad, 1 / 60)).toBe('ok');
    expect(f.idle).toBe(0);
  });

  it('nunca ter usado gamepad não conta como perda de sinal', () => {
    const f = new SignalFailsafe();
    for (let i = 0; i < 60 * 10; i++) expect(f.update(idle, 1 / 60)).toBe('ok');
  });

  it('reset volta ao estado inicial', () => {
    const f = new SignalFailsafe();
    f.update(pad, 0.1);
    f.reset();
    for (let i = 0; i < 60 * 10; i++) expect(f.update(idle, 1 / 60)).toBe('ok');
  });
});
