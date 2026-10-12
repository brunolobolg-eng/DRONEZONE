export interface Capabilities {
  readonly webgl2: boolean;
  readonly gamepad: boolean;
  readonly fullscreen: boolean;
}

/**
 * Verifica o que o ambiente oferece. O WebGL 2 é obrigatório (o Three.js recente não usa WebGL 1);
 * os demais recursos só desativam funções opcionais.
 */
export const detectCapabilities = (doc: Document = document): Capabilities => {
  let webgl2 = false;
  try {
    const probe = doc.createElement('canvas');
    const gl = probe.getContext('webgl2');
    webgl2 = gl !== null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    webgl2 = false;
  }
  return {
    webgl2,
    gamepad: typeof navigator !== 'undefined' && typeof navigator.getGamepads === 'function',
    fullscreen: typeof doc.documentElement.requestFullscreen === 'function',
  };
};

/** Mensagem exibida quando o hardware ou navegador não atende aos requisitos. */
export const unsupportedMessage = (caps: Capabilities): string | null => {
  if (!caps.webgl2) {
    return 'Este navegador ou computador não oferece WebGL 2, necessário para o jogo. Atualize o navegador ou ative a aceleração gráfica nas configurações e tente novamente.';
  }
  return null;
};
