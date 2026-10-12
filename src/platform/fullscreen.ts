import { logger } from './logger';

/** Alterna tela cheia. Retorna false se o navegador ou o aplicativo recusar. Nunca lança. */
export const toggleFullscreen = async (element: HTMLElement): Promise<boolean> => {
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
    } else {
      await element.requestFullscreen();
    }
    return true;
  } catch (error) {
    logger.log('warn', 'tela cheia indisponível', error);
    return false;
  }
};
