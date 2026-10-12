import { describe, expect, it } from 'vitest';
import { createCatalog, DEFAULT_CATALOG } from '../../src/gameplay/progression/catalog';
import { buildDrone, compareSpecs, DEFAULT_LOADOUT, loadoutCost, specSheet, type Loadout } from '../../src/gameplay/progression/loadout';
import { purchasePart, repairCost, repairDrone, START_BALANCE, missionReward } from '../../src/gameplay/progression/economy';
import { createNewSave, parseSave, serializeSave, SAVE_SCHEMA_VERSION } from '../../src/gameplay/progression/save-data';
import { DEFAULT_DRONE_PARAMS } from '../../src/core/physics/drone-params';
import { computeActuation } from '../../src/core/physics/drone-physics-model';

const ALL_OWNED = { balance: 1e6, owned: DEFAULT_CATALOG.parts.map((p) => p.id) };

describe('catálogo de peças', () => {
  it('o arquivo de dados padrão é válido e tem todos os slots', () => {
    const slots = new Set(DEFAULT_CATALOG.parts.map((p) => p.slot));
    expect(slots.size).toBe(6);
    expect(DEFAULT_CATALOG.get('frame-scrap')?.price).toBe(0);
  });

  it('rejeita id duplicado, slot inválido e versão desconhecida', () => {
    const part = { id: 'a', slot: 'frame', name: 'a', price: 0, effects: {} };
    expect(() => createCatalog({ schemaVersion: 1, parts: [part, part] })).toThrow(/duplicado/);
    expect(() => createCatalog({ schemaVersion: 1, parts: [{ ...part, slot: 'asa' }] })).toThrow(/slot/);
    expect(() => createCatalog({ schemaVersion: 2, parts: [] })).toThrow(/versão/);
  });

  it('rejeita efeito desconhecido, para não ignorar erro de digitação em silêncio', () => {
    const part = { id: 'a', slot: 'frame', name: 'a', price: 0, effects: { massDelt: 0.1 } };
    expect(() => createCatalog({ schemaVersion: 1, parts: [part] })).toThrow(/desconhecido/);
  });
});

describe('melhorias alteram o modelo físico', () => {
  it('configuração padrão reproduz os parâmetros base', () => {
    const drone = buildDrone(DEFAULT_CATALOG, DEFAULT_LOADOUT);
    expect(drone.params.mass).toBeCloseTo(DEFAULT_DRONE_PARAMS.mass, 12);
    expect(drone.params.motor.maxThrust).toBeCloseTo(DEFAULT_DRONE_PARAMS.motor.maxThrust, 12);
    expect(drone.cameraQuality).toBe(1);
  });

  it('motores melhores aumentam o empuxo e reduzem o tempo de resposta', () => {
    const upgraded: Loadout = { ...DEFAULT_LOADOUT, motors: 'motors-2306' };
    const base = buildDrone(DEFAULT_CATALOG, DEFAULT_LOADOUT).params;
    const better = buildDrone(DEFAULT_CATALOG, upgraded).params;
    expect(better.motor.maxThrust).toBeGreaterThan(base.motor.maxThrust);
    expect(better.motor.responseTime).toBeLessThan(base.motor.responseTime);
    expect(better.mass).toBeGreaterThan(base.mass);
  });

  it('com motores melhores, o acelerador de hover fica menor', () => {
    const base = specSheet(buildDrone(DEFAULT_CATALOG, DEFAULT_LOADOUT));
    const better = specSheet(buildDrone(DEFAULT_CATALOG, { ...DEFAULT_LOADOUT, motors: 'motors-2306' }));
    expect(better.hoverThrottlePct).toBeLessThan(base.hoverThrottlePct);
  });

  it('bateria maior aumenta o tempo de voo estimado', () => {
    const base = specSheet(buildDrone(DEFAULT_CATALOG, DEFAULT_LOADOUT));
    const big = specSheet(buildDrone(DEFAULT_CATALOG, { ...DEFAULT_LOADOUT, battery: 'battery-1800' }));
    expect(big.batteryWh).toBeGreaterThan(base.batteryWh);
    expect(big.flightMinutes).toBeGreaterThan(base.flightMinutes);
  });

  it('quadro melhor aumenta integridade e tolerância a impacto', () => {
    const drone = buildDrone(DEFAULT_CATALOG, { ...DEFAULT_LOADOUT, frame: 'frame-carbon' });
    expect(drone.params.integrityMax).toBeGreaterThan(DEFAULT_DRONE_PARAMS.integrityMax);
    expect(drone.params.impactTolerance).toBeGreaterThan(DEFAULT_DRONE_PARAMS.impactTolerance);
  });

  it('o empuxo real de um motor melhor é o que o modelo físico usa', () => {
    const drone = buildDrone(DEFAULT_CATALOG, { ...DEFAULT_LOADOUT, motors: 'motors-2306' });
    const max = drone.params.motor.maxThrust;
    const act = computeActuation([max, max, max, max], drone.params);
    expect(act.totalThrust).toBeCloseTo(4 * max, 9);
  });

  it('peça no slot errado é recusada', () => {
    expect(() => buildDrone(DEFAULT_CATALOG, { ...DEFAULT_LOADOUT, frame: 'motors-stock' })).toThrow(/slot/);
    expect(() => buildDrone(DEFAULT_CATALOG, { ...DEFAULT_LOADOUT, frame: 'inexistente' })).toThrow(/desconhecida/);
  });

  it('comparação marca como melhoria apenas as métricas que melhoraram', () => {
    const current = specSheet(buildDrone(DEFAULT_CATALOG, DEFAULT_LOADOUT));
    const candidate = specSheet(buildDrone(DEFAULT_CATALOG, { ...DEFAULT_LOADOUT, motors: 'motors-2306' }));
    const rows = compareSpecs(current, candidate);
    expect(rows.find((r) => r.label === 'Empuxo por motor')?.improved).toBe(true);
    expect(rows.find((r) => r.label === 'Massa')?.improved).toBe(false);
  });
});

describe('economia fictícia', () => {
  it('compra desconta o preço e registra a peça', () => {
    const result = purchasePart({ balance: 500, owned: [] }, DEFAULT_CATALOG, 'motors-2207');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.balance).toBe(150);
      expect(result.state.owned).toContain('motors-2207');
    }
  });

  it('não compra sem saldo, nem peça já possuída, nem peça desconhecida', () => {
    expect(purchasePart({ balance: 10, owned: [] }, DEFAULT_CATALOG, 'motors-2306')).toEqual({ ok: false, reason: 'insufficient-funds' });
    expect(purchasePart({ balance: 9999, owned: ['camera-hd'] }, DEFAULT_CATALOG, 'camera-hd')).toEqual({ ok: false, reason: 'already-owned' });
    expect(purchasePart({ balance: 9999, owned: [] }, DEFAULT_CATALOG, 'nada')).toEqual({ ok: false, reason: 'unknown-part' });
  });

  it('custo de reparo cresce com a integridade perdida e não aceita valor negativo', () => {
    expect(repairCost(0)).toBe(0);
    expect(repairCost(10)).toBe(60);
    expect(repairCost(-5)).toBe(0);
  });

  it('reparo recusado quando o saldo não cobre o custo', () => {
    expect(repairDrone(10, 10)).toEqual({ ok: false, cost: 60 });
    expect(repairDrone(100, 10)).toEqual({ ok: true, balance: 40, cost: 60 });
  });

  it('recompensa é multiplicada pelo equipamento de missão', () => {
    expect(missionReward(100, 1.25)).toBe(125);
    expect(missionReward(100, -1)).toBe(0);
  });

  it('custo total do conjunto soma os preços', () => {
    expect(loadoutCost(DEFAULT_CATALOG, DEFAULT_LOADOUT)).toBe(0);
    expect(loadoutCost(DEFAULT_CATALOG, { ...DEFAULT_LOADOUT, motors: 'motors-2207' })).toBe(350);
    expect(START_BALANCE).toBeGreaterThan(0);
  });
});

describe('salvamento', () => {
  it('serialização e leitura são simétricas', () => {
    const save = { ...createNewSave(DEFAULT_CATALOG), balance: 777, owned: ['camera-hd', 'frame-scrap'] };
    const parsed = parseSave(serializeSave(save), DEFAULT_CATALOG);
    expect(parsed.recovered).toBe(false);
    expect(parsed.warnings).toHaveLength(0);
    expect(parsed.save.balance).toBe(777);
    expect(parsed.save.owned).toEqual(expect.arrayContaining(['camera-hd', 'frame-scrap']));
  });

  it('ausência de salvamento gera partida nova sem aviso', () => {
    const result = parseSave(null, DEFAULT_CATALOG);
    expect(result.save).toEqual(createNewSave(DEFAULT_CATALOG));
    expect(result.recovered).toBe(false);
  });

  it('JSON corrompido é recuperado com aviso', () => {
    const result = parseSave('{ não é json', DEFAULT_CATALOG);
    expect(result.recovered).toBe(true);
    expect(result.save.balance).toBe(START_BALANCE);
  });

  it('versão futura não é lida às cegas', () => {
    const result = parseSave(JSON.stringify({ schemaVersion: 99, balance: 5 }), DEFAULT_CATALOG);
    expect(result.recovered).toBe(true);
    expect(result.save.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
  });

  it('saldo negativo, peças desconhecidas e peças não compradas são sanitizados', () => {
    const raw = {
      schemaVersion: SAVE_SCHEMA_VERSION,
      balance: -50,
      owned: ['peca-fantasma', 'camera-hd'],
      loadout: { ...DEFAULT_LOADOUT, motors: 'motors-2306', camera: 'camera-hd' },
    };
    const result = parseSave(JSON.stringify(raw), DEFAULT_CATALOG);
    expect(result.save.balance).toBe(START_BALANCE);
    expect(result.save.owned).not.toContain('peca-fantasma');
    expect(result.save.loadout.motors).toBe('motors-stock');
    expect(result.save.loadout.camera).toBe('camera-hd');
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('peça de slot errado no loadout volta ao padrão do slot', () => {
    const raw = { schemaVersion: SAVE_SCHEMA_VERSION, balance: 10, owned: [], loadout: { frame: 'motors-2207' } };
    const result = parseSave(JSON.stringify(raw), DEFAULT_CATALOG);
    expect(result.save.loadout.frame).toBe('frame-scrap');
  });

  it('todas as peças gratuitas estão sempre disponíveis após leitura', () => {
    const result = parseSave(JSON.stringify({ schemaVersion: SAVE_SCHEMA_VERSION, owned: [] }), DEFAULT_CATALOG);
    expect(result.save.owned).toContain('frame-scrap');
    expect(result.save.owned).toContain('camera-analog');
  });
});

describe('equipamentos em massa', () => {
  it('todas as peças do catálogo montam um drone válido', () => {
    for (const part of DEFAULT_CATALOG.parts) {
      const loadout: Loadout = { ...DEFAULT_LOADOUT, [part.slot]: part.id };
      expect(() => buildDrone(DEFAULT_CATALOG, loadout)).not.toThrow();
    }
    expect(ALL_OWNED.owned.length).toBe(DEFAULT_CATALOG.parts.length);
  });
});
