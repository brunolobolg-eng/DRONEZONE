import { describe, expect, it } from 'vitest';
import { Heightfield, MATERIAL_DISTURBED, MATERIAL_RIM, type HeightfieldOptions } from '../../src/core/terrain/heightfield';
import { fromAxisAngle, QUAT_IDENTITY } from '../../src/core/math/quat';
import { vec3 } from '../../src/core/math/vec3';
import { DEFAULT_DRONE_PARAMS } from '../../src/core/physics/drone-params';
import { createDroneState } from '../../src/core/physics/drone-state';
import { computeTelemetry } from '../../src/core/telemetry/telemetry';

const OPTIONS: HeightfieldOptions = {
  cells: 40,
  cellSize: 1,
  origin: { x: -20, z: -20 },
  baseHeight: 0,
  roughness: 0.3,
  seed: 7,
  maxCraterDepth: 1.5,
  maxCraterRecords: 3,
  flatHalfWidth: 6,
};

describe('terreno deformável', () => {
  it('a faixa central das vias fica plana', () => {
    const hf = new Heightfield(OPTIONS);
    expect(hf.heightAt(0, 0)).toBeCloseTo(0, 9);
    expect(hf.heightAt(10, 0)).toBeCloseTo(0, 9);
  });

  it('a geração é determinística pela semente', () => {
    const a = new Heightfield(OPTIONS).snapshotHeights();
    const b = new Heightfield(OPTIONS).snapshotHeights();
    expect(Array.from(a)).toEqual(Array.from(b));
    const c = new Heightfield({ ...OPTIONS, seed: 8 }).snapshotHeights();
    expect(Array.from(a)).not.toEqual(Array.from(c));
  });

  it('cratera rebaixa o centro pela profundidade e devolve a região alterada', () => {
    const before = new Heightfield(OPTIONS);
    const hf = new Heightfield(OPTIONS);
    const dirty = hf.applyCrater({ x: 0, z: 10, radius: 3, depth: 1 });
    expect(dirty).not.toBeNull();
    expect(before.heightAt(0, 10) - hf.heightAt(0, 10)).toBeCloseTo(1, 6);
    expect(hf.vertexMaterial(20, 30)).toBe(MATERIAL_DISTURBED);
    expect(dirty!.minI).toBeLessThanOrEqual(20);
    expect(dirty!.maxI).toBeGreaterThanOrEqual(20);
  });

  it('a borda da cratera tem anel elevado (rim) e material de borda exposta', () => {
    const hf = new Heightfield(OPTIONS);
    hf.applyCrater({ x: 0, z: 10, radius: 3, depth: 1 });
    let foundRim = false;
    for (let i = 0; i <= 40; i++) {
      for (let j = 0; j <= 40; j++) {
        if (hf.vertexMaterial(i, j) === MATERIAL_RIM) foundRim = true;
      }
    }
    expect(foundRim).toBe(true);
  });

  it('profundidade é limitada mesmo com impacto muito forte', () => {
    const base = new Heightfield(OPTIONS);
    const hf = new Heightfield(OPTIONS);
    hf.applyCrater({ x: 0, z: 10, radius: 3, depth: 50 });
    expect(base.heightAt(0, 10) - hf.heightAt(0, 10)).toBeLessThanOrEqual(1.5 + 1e-6);
  });

  it('várias crateras na mesma região acumulam, sem passar do limite', () => {
    const base = new Heightfield(OPTIONS);
    const hf = new Heightfield(OPTIONS);
    hf.applyCrater({ x: 0, z: 10, radius: 3, depth: 1 });
    hf.applyCrater({ x: 0, z: 10, radius: 3, depth: 1 });
    const drop = base.heightAt(0, 10) - hf.heightAt(0, 10);
    expect(drop).toBeGreaterThan(1.2);
    expect(drop).toBeLessThanOrEqual(1.5 + 1e-6);
  });

  it('cratera fora da área não altera nada', () => {
    const hf = new Heightfield(OPTIONS);
    expect(hf.applyCrater({ x: 500, z: 500, radius: 3, depth: 1 })).toBeNull();
    expect(hf.craterRecords).toHaveLength(0);
  });

  it('registros de cratera são limitados, mas o terreno continua alterado', () => {
    const hf = new Heightfield(OPTIONS);
    for (let k = 0; k < 5; k++) hf.applyCrater({ x: -10 + k * 4, z: 10, radius: 1.5, depth: 0.5 });
    expect(hf.craterRecords).toHaveLength(3);
    expect(hf.craterRecords[0].x).toBe(-2);
  });

  it('reset restaura o terreno original', () => {
    const original = new Heightfield(OPTIONS).snapshotHeights();
    const hf = new Heightfield(OPTIONS);
    hf.applyCrater({ x: 0, z: 10, radius: 3, depth: 1 });
    hf.reset();
    expect(Array.from(hf.snapshotHeights())).toEqual(Array.from(original));
    expect(hf.craterRecords).toHaveLength(0);
  });
});

describe('telemetria', () => {
  const P = DEFAULT_DRONE_PARAMS;

  it('drone nivelado com rumo zero tem ângulos nulos', () => {
    const s = createDroneState(vec3(0, 12, 0), P);
    const t = computeTelemetry(s, P, 2, false);
    expect(t.altitudeAgl).toBeCloseTo(10, 9);
    expect(t.pitchDeg).toBeCloseTo(0, 9);
    expect(t.rollDeg).toBeCloseTo(0, 9);
    expect(t.headingDeg).toBeCloseTo(0, 9);
    expect(t.batteryPct).toBeCloseTo(100, 9);
    expect(t.integrityPct).toBeCloseTo(100, 9);
  });

  it('asa direita para baixo em 90° resulta em rolagem de +90°', () => {
    const s = { ...createDroneState(vec3(0, 12, 0), P), orientation: fromAxisAngle(vec3(1, 0, 0), Math.PI / 2) };
    expect(computeTelemetry(s, P, 0, false).rollDeg).toBeCloseTo(90, 6);
  });

  it('rolagem além de 90° não é dobrada: 200° aparece como -160°, não como -20°', () => {
    const s = { ...createDroneState(vec3(0, 12, 0), P), orientation: fromAxisAngle(vec3(1, 0, 0), (200 * Math.PI) / 180) };
    expect(computeTelemetry(s, P, 0, false).rollDeg).toBeCloseTo(-160, 6);
  });

  it('velocidade é convertida corretamente para km/h', () => {
    const s = { ...createDroneState(vec3(0, 12, 0), P), velocity: vec3(10, 0, 0), orientation: QUAT_IDENTITY };
    const t = computeTelemetry(s, P, 0, false);
    expect(t.speedMs).toBeCloseTo(10, 9);
    expect(t.speedKmh).toBeCloseTo(36, 9);
  });

  it('frações de motor ficam em [0, 1] e a potência acompanha o empuxo', () => {
    const s = { ...createDroneState(vec3(0, 12, 0), P), motorThrust: [P.motor.maxThrust, 0, 2, 100] as const };
    const t = computeTelemetry(s, P, 0, true);
    expect(t.motorFraction[0]).toBeCloseTo(1, 9);
    expect(t.motorFraction[3]).toBe(1);
    expect(t.saturated).toBe(true);
    expect(t.powerW).toBeGreaterThan(0);
  });
});
