import * as THREE from 'three';
import { clamp } from '../../core/math/scalar';

export interface FpvCameraFrame {
  readonly speedMs: number;
  /** Média do empuxo dos motores como fração do máximo, em [0, 1]. Vem da física. */
  readonly motorAverage: number;
  readonly time: number;
}

export interface FpvCameraEffects {
  readonly enabled: boolean;
  /** Intensidade da vibração, em [0, 1]. */
  readonly vibration: number;
}

const MAX_FOV_KICK = 6;
const FOV_KICK_PER_MS = 0.12;
const MAX_VIBRATION_RAD = 0.0035;

/**
 * Câmera FPV presa ao nariz do drone. Não há tremor artificial sobre a orientação:
 * o movimento vem do estado físico. A vibração é um efeito visual pequeno, ligado ao
 * empuxo real dos motores, e pode ser desligada.
 */
export class FpvCamera {
  readonly camera: THREE.PerspectiveCamera;
  private baseFov: number;
  private currentFov: number;

  constructor(mount: THREE.Object3D, fov: number, aspect: number) {
    this.baseFov = fov;
    this.currentFov = fov;
    this.camera = new THREE.PerspectiveCamera(fov, aspect, 0.03, 1200);
    this.camera.name = 'fpv-camera';
    mount.add(this.camera);
  }

  setBaseFov(fov: number): void {
    this.baseFov = fov;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  update(frame: FpvCameraFrame, effects: FpvCameraEffects): void {
    const kick = effects.enabled ? clamp(frame.speedMs * FOV_KICK_PER_MS, 0, MAX_FOV_KICK) : 0;
    const target = this.baseFov + kick;
    if (Math.abs(target - this.currentFov) > 0.05) {
      this.currentFov = target;
      this.camera.fov = target;
      this.camera.updateProjectionMatrix();
    }

    const amp = effects.enabled ? effects.vibration * MAX_VIBRATION_RAD * clamp(frame.motorAverage, 0, 1) : 0;
    this.camera.rotation.set(Math.sin(frame.time * 83) * amp, Math.sin(frame.time * 61) * amp * 0.6, 0);
  }

  get fov(): number {
    return this.currentFov;
  }
}
