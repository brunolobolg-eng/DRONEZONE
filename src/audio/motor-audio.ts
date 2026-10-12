import { logger } from '../platform/logger';

/**
 * Áudio sintetizado com WebAudio. Não usa arquivos: o zumbido dos motores varia com o
 * empuxo real, e os impactos são ruídos curtos. Só inicia após um gesto do jogador,
 * como exigem os navegadores.
 */
export class MotorAudio {
  private context: AudioContext | null = null;
  private oscillator: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private enabled = true;

  /** Cria o contexto de áudio. Deve ser chamado dentro de um evento do usuário. */
  start(): void {
    if (this.context || !this.enabled) return;
    try {
      const Ctor: typeof AudioContext | undefined = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = new Ctor();
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = 110;
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      const gain = ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter).connect(gain).connect(ctx.destination);
      osc.start();

      const length = ctx.sampleRate * 0.25;
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.05));

      this.context = ctx;
      this.oscillator = osc;
      this.gain = gain;
      this.noise = buffer;
    } catch (error) {
      logger.log('warn', 'áudio indisponível', error);
      this.context = null;
    }
  }

  /** Atualiza o zumbido. `thrust` é a média do empuxo em [0, 1]. */
  update(thrust: number, armed: boolean): void {
    if (!this.context || !this.oscillator || !this.gain) return;
    const t = Math.min(1, Math.max(0, thrust));
    const now = this.context.currentTime;
    this.oscillator.frequency.setTargetAtTime(armed ? 110 + 260 * t : 60, now, 0.05);
    this.gain.gain.setTargetAtTime(armed ? 0.01 + 0.05 * t : 0, now, 0.05);
  }

  /** Ruído curto de impacto, mais forte quanto maior a velocidade. */
  impact(speed: number): void {
    if (!this.context || !this.noise || !this.enabled) return;
    const src = this.context.createBufferSource();
    src.buffer = this.noise;
    const g = this.context.createGain();
    g.gain.value = Math.min(0.4, 0.04 * speed);
    src.connect(g).connect(this.context.destination);
    src.start();
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value) this.update(0, false);
  }

  dispose(): void {
    this.oscillator?.stop();
    void this.context?.close();
    this.context = null;
  }
}
