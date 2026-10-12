import * as THREE from 'three';
import { type DroneParams } from '../../core/physics/drone-params';
import { motorOffsets } from '../../core/physics/motor-model';
import { type MaterialCache } from '../materials';

/**
 * Quadricóptero improvisado, montado de peças simples. As peças têm nome e podem ser
 * ocultadas (quebra, perda de braço), sem refazer a malha.
 * Convenção: nariz em +X, direita em +Z, cima em +Y, igual ao referencial do corpo da física.
 */
export type DronePartName = 'frame' | 'battery' | 'camera' | 'tape' | `arm-${number}` | `motor-${number}` | `prop-${number}`;

const SPIN_IDLE = 18;
const SPIN_FULL = 240;

export class DroneModel {
  readonly root = new THREE.Group();
  /** Ponto de montagem da câmera FPV, no nariz e um pouco acima do quadro. */
  readonly cameraMount = new THREE.Object3D();
  private readonly parts = new Map<DronePartName, THREE.Object3D>();
  private readonly props: THREE.Object3D[] = [];
  private readonly propSign: number[] = [];
  private readonly frameMaterial: THREE.MeshStandardMaterial;
  private readonly frameBaseColor = new THREE.Color('#2e3033');

  constructor(params: DroneParams, materials: MaterialCache, shadows: boolean) {
    this.root.name = 'drone';
    this.frameMaterial = materials.track(new THREE.MeshStandardMaterial({ color: '#2e3033', roughness: 0.6, metalness: 0.2 }));
    const armMaterial = materials.standardFor('#3a3d41', { roughness: 0.5, metalness: 0.3 });
    const motorMaterial = materials.standardFor('#8d9298', { roughness: 0.35, metalness: 0.7 });
    const propMaterial = new THREE.MeshStandardMaterial({ color: '#d7d9dc', roughness: 0.4, transparent: true, opacity: 0.85 });
    materials.track(propMaterial);
    const tapeMaterial = materials.standardFor('#c9a227', { roughness: 0.9 });
    const batteryMaterial = materials.standardFor('#1f2a36', { roughness: 0.7 });

    const body = this.add('frame', new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 0.14), this.frameMaterial));
    body.position.y = 0.02;
    body.castShadow = shadows;

    // Fita adesiva em uma das placas: indício de remendo.
    this.add('tape', new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.14), tapeMaterial)).position.set(-0.02, 0.040, 0);

    const battery = this.add('battery', new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.03, 0.04), batteryMaterial));
    battery.position.set(-0.01, -0.02, 0);

    const offsets = motorOffsets(params.armLength);
    offsets.forEach((o, i) => {
      const length = params.armLength;
      const arm = this.add(`arm-${i}`, new THREE.Mesh(new THREE.BoxGeometry(length, 0.012, 0.022), armMaterial));
      arm.position.set(o.x / 2, 0.02, o.z / 2);
      arm.rotation.y = -Math.atan2(o.z, o.x);
      arm.castShadow = shadows;

      const motor = this.add(`motor-${i}`, new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.028, 12), motorMaterial));
      motor.position.set(o.x, 0.035, o.z);
      motor.castShadow = shadows;

      const prop = new THREE.Group();
      // Diâmetro de 0,13 m, como uma hélice de 5 polegadas.
      const blade = new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.003, 0.02), propMaterial);
      const blade2 = blade.clone();
      blade2.rotation.y = Math.PI / 2;
      prop.add(blade, blade2);
      prop.position.set(o.x, 0.058, o.z);
      prop.name = `prop-${i}`;
      this.parts.set(`prop-${i}`, prop);
      this.root.add(prop);
      this.props.push(prop);
      this.propSign.push(o.spin);
    });

    // Módulo da câmera no nariz, com a lente virada para a frente (+X). Fica um pouco acima do quadro.
    const camBody = this.add('camera', new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.03, 0.03), batteryMaterial));
    camBody.position.set(0.088, 0.1, 0);
    const lens = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.012, 10), motorMaterial);
    lens.rotation.z = Math.PI / 2;
    lens.position.set(0.02, 0, 0);
    camBody.add(lens);

    // Lente acima e à frente das hélices: elas ficam fora do campo de visão.
    this.cameraMount.position.set(0.11, 0.13, 0);
    // A câmera do Three.js olha para -Z; girar -90° em Y faz esse eixo apontar para +X do corpo.
    this.cameraMount.rotation.y = -Math.PI / 2;
    this.root.add(this.cameraMount);
  }

  get partNames(): DronePartName[] {
    return [...this.parts.keys()];
  }

  setPartVisible(name: DronePartName, visible: boolean): void {
    const part = this.parts.get(name);
    if (part) part.visible = visible;
  }

  /**
   * Hélices giram conforme o empuxo real de cada motor. Nada aqui altera a física.
   * Sentidos alternados, igual ao modelo.
   */
  update(motorFraction: readonly number[], dt: number): void {
    this.props.forEach((prop, i) => {
      const fraction = motorFraction[i] ?? 0;
      const omega = SPIN_IDLE * (fraction > 0.001 ? 1 : 0) + SPIN_FULL * fraction;
      prop.rotation.y += this.propSign[i] * omega * dt;
    });
  }

  /** Escurece a estrutura conforme a integridade restante, de 0 (destruída) a 1 (nova). */
  setIntegrity(fraction: number): void {
    const f = Math.min(1, Math.max(0, fraction));
    this.frameMaterial.color.copy(this.frameBaseColor).lerp(new THREE.Color('#1a1a1a'), 1 - f);
  }

  private add<T extends THREE.Object3D>(name: DronePartName, obj: T): T {
    obj.name = name;
    this.parts.set(name, obj);
    this.root.add(obj);
    return obj;
  }
}
