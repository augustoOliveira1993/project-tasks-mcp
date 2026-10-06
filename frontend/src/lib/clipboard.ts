/**
 * Copia texto para a área de transferência.
 * `navigator.clipboard` só existe em contexto seguro (HTTPS ou localhost); o painel interno roda em HTTP,
 * então o plano B usa um textarea temporário com `execCommand('copy')`.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch { /* permissão negada ou documento sem foco: tenta o plano B */ }
  return copyWithSelection(text);
}

function copyWithSelection(text: string): boolean {
  if (typeof document === 'undefined') return false;
  const previouslyFocused = document.activeElement as HTMLElement | null;
  // Dentro de <dialog> modal o resto da página fica inerte; o campo temporário precisa estar no mesmo contêiner.
  const host = previouslyFocused?.closest('dialog[open], [role="dialog"]') ?? document.body;
  const field = document.createElement('textarea');
  field.value = text;
  field.setAttribute('readonly', '');
  field.setAttribute('aria-hidden', 'true');
  field.style.cssText = 'position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none';
  host.appendChild(field);
  try {
    field.focus({ preventScroll: true });
    field.select();
    field.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch { return false; }
  finally {
    field.remove();
    previouslyFocused?.focus?.({ preventScroll: true });
  }
}
