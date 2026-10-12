/** Criação de elementos sem framework. Mantém a interface simples e sem dependências extras. */
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | ((e: Event) => void)> = {},
  children: (Node | string)[] = [],
): HTMLElementTagNameMap[K] => {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (typeof value === 'function') node.addEventListener(key.replace(/^on/, ''), value);
    else if (typeof value === 'boolean') {
      if (value) node.setAttribute(key, '');
    } else node.setAttribute(key, String(value));
  }
  node.append(...children);
  return node;
};

export const fmt = (value: number, digits = 0): string => (Number.isFinite(value) ? value.toFixed(digits) : '--');
