import * as THREE from 'three';
import { type RenderPose } from '../core/physics/physics-world';
import { type GameSession, type SessionEvent } from '../gameplay/game-session';
import { type QualityPreset } from '../gameplay/settings';
import { CityVisuals } from './scene/city-visuals';
import { TerrainMesh } from './scene/terrain-mesh';
import { DroneModel } from './drone/drone-model';
import { FpvCamera } from './camera/fpv-camera';
import { MaterialCache, PALETTE } from './materials';
import { QUALITY_PRESETS, pixelRatioFor } from './quality';

export interface SceneRendererOptions {
  readonly canvas: HTMLCanvasElement;
  readonly session: GameSession;
  readonly quality: QualityPreset;
  readonly fov: number;
  readonly devicePixelRatio: number;
}

/**
 * Renderização da cena: ambiente, drone, câmera FPV e iluminação.
 * Lê o estado da sessão e não altera a simulação. Pode ser trocado por outro renderizador
 * sem mexer no núcleo.
 */
export class SceneRenderer {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly materials = new MaterialCache();
  readonly drone: DroneModel;
  readonly fpv: FpvCamera;
  readonly city: CityVisuals;
  readonly terrain: TerrainMesh;
  private readonly sun: THREE.DirectionalLight;
  private quality: QualityPreset;
  private readonly session: GameSession;

  constructor(options: SceneRendererOptions) {
    this.session = options.session;
    this.quality = options.quality;
    const q = QUALITY_PRESETS[options.quality];

    this.renderer = new THREE.WebGLRenderer({
      canvas: options.canvas,
      antialias: q.antialias,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(pixelRatioFor(options.quality, options.devicePixelRatio));
    this.renderer.shadowMap.enabled = q.shadowMapSize > 0;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene.background = new THREE.Color('#a9c4d9');
    this.scene.fog = new THREE.Fog('#b9cbd9', q.fogNear, q.fogFar);

    const hemi = new THREE.HemisphereLight('#cfe3f2', '#4a5a34', 1.0);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff1d6', 2.2);
    this.sun.position.set(60, 90, 30);
    this.sun.target.position.set(0, 0, 0);
    this.sun.castShadow = q.shadowMapSize > 0;
    this.sun.shadow.mapSize.set(q.shadowMapSize || 512, q.shadowMapSize || 512);
    this.sun.shadow.camera.left = -90;
    this.sun.shadow.camera.right = 90;
    this.sun.shadow.camera.top = 90;
    this.sun.shadow.camera.bottom = -90;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = 300;
    this.sun.shadow.bias = -0.0008;
    this.scene.add(this.sun, this.sun.target);

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2400, 2400),
      this.materials.standardFor(PALETTE.grassFar, { roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.05;
    ground.receiveShadow = true;
    ground.name = 'far-ground';
    this.scene.add(ground);

    const terrainMaterial = this.materials.track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
    this.terrain = new TerrainMesh(options.session.terrain, terrainMaterial);
    this.scene.add(this.terrain.mesh);

    this.city = new CityVisuals({
      neighborhood: options.session.neighborhood,
      structures: new Map(options.session.structureList.map((s) => [s.id, s])),
      fragments: options.session.fragments,
      materials: this.materials,
      fragmentCapacity: q.fragmentCapacity,
      shadows: q.shadowMapSize > 0,
    });
    this.scene.add(this.city.group);

    this.drone = new DroneModel(options.session.drone.params, this.materials, q.shadowMapSize > 0);
    this.scene.add(this.drone.root);

    const aspect = Math.max(1, options.canvas.clientWidth) / Math.max(1, options.canvas.clientHeight);
    this.fpv = new FpvCamera(this.drone.cameraMount, options.fov, aspect);
    this.applyShadowFlags(q.shadowMapSize > 0);
  }

  get qualityPreset(): QualityPreset {
    return this.quality;
  }

  /** Aplica um preset de qualidade sem recriar a cena. */
  setQuality(preset: QualityPreset, devicePixelRatio: number): void {
    const q = QUALITY_PRESETS[preset];
    this.quality = preset;
    this.renderer.setPixelRatio(pixelRatioFor(preset, devicePixelRatio));
    this.renderer.shadowMap.enabled = q.shadowMapSize > 0;
    this.sun.castShadow = q.shadowMapSize > 0;
    if (q.shadowMapSize > 0) {
      this.sun.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
      this.sun.shadow.map?.dispose();
      this.sun.shadow.map = null;
    }
    if (this.scene.fog instanceof THREE.Fog) {
      this.scene.fog.near = q.fogNear;
      this.scene.fog.far = q.fogFar;
    }
    this.applyShadowFlags(q.shadowMapSize > 0);
  }

  setFov(fov: number): void {
    this.fpv.setBaseFov(fov);
  }

  resize(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.renderer.setSize(width, height, false);
    this.fpv.setAspect(width / height);
  }

  /** Aplica eventos da sessão à cena: deformações do terreno e mudanças de dano. */
  applyEvents(events: readonly SessionEvent[]): void {
    for (const e of events) {
      if (e.type === 'crater') this.terrain.applyDirty(e.dirty);
    }
  }

  /** Sincroniza visuais com o estado atual da sessão (dano, fragmentos). */
  syncWorld(): void {
    this.city.sync(new Map(this.session.structureList.map((s) => [s.id, s])));
    this.city.syncFragments(this.session.fragments);
  }

  /**
   * Desenha um quadro. A pose vem interpolada entre os dois últimos passos físicos,
   * então o movimento é suave mesmo quando a renderização roda mais rápido que a física.
   */
  render(pose: RenderPose, options: { motorFraction: readonly number[]; speedMs: number; integrityFraction: number; cameraEffects: boolean; vibration: number; time: number; dt: number }): void {
    this.drone.root.position.set(pose.position.x, pose.position.y, pose.position.z);
    this.drone.root.quaternion.set(pose.orientation.x, pose.orientation.y, pose.orientation.z, pose.orientation.w);
    this.drone.update(options.motorFraction, options.dt);
    this.drone.setIntegrity(options.integrityFraction);

    const avg = options.motorFraction.reduce((a, b) => a + b, 0) / Math.max(1, options.motorFraction.length);
    this.fpv.update({ speedMs: options.speedMs, motorAverage: avg, time: options.time }, { enabled: options.cameraEffects, vibration: options.vibration });
    this.renderer.render(this.scene, this.fpv.camera);
  }

  dispose(): void {
    this.city.dispose();
    this.terrain.dispose();
    this.materials.dispose();
    this.renderer.dispose();
  }

  private applyShadowFlags(enabled: boolean): void {
    this.scene.traverse((obj) => {
      if (obj instanceof THREE.Mesh || obj instanceof THREE.InstancedMesh) {
        if (obj.name === 'far-ground' || obj.name === 'road' || obj.name === 'road-dashes') {
          obj.receiveShadow = enabled;
          return;
        }
        obj.castShadow = enabled && obj.name !== 'fragments';
        obj.receiveShadow = enabled;
      }
    });
  }
}
