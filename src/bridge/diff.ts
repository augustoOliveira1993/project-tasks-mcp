/** Utilitários de diff da bridge: saída de Git estável e patch limitado por arquivo inteiro. */

export const PATCH_LIMIT_BYTES = 100 * 1024;

/**
 * Flags que tornam o patch independente da configuração do usuário (color.ui, diff.noprefix,
 * diff.mnemonicPrefix, diff.external, textconv) e detectam renomeações.
 */
export const DIFF_FLAGS = ['--no-ext-diff', '--no-textconv', '--no-color', '-M', '--src-prefix=a/', '--dst-prefix=b/'] as const;

export type LimitedPatch = { patch: string; truncated: boolean; omittedFiles: number };

/**
 * Mantém o maior conjunto possível de arquivos inteiros dentro do limite, na ordem do Git.
 * Um arquivo que sozinho não cabe é omitido, sem derrubar os demais; nunca corta um arquivo no meio.
 */
export function limitPatch(patch: string, maxBytes = PATCH_LIMIT_BYTES): LimitedPatch {
  if (Buffer.byteLength(patch, 'utf8') <= maxBytes) return { patch, truncated: false, omittedFiles: 0 };
  const sections = patch.split(/^(?=diff --git )/m).filter(section => section.length > 0);
  let used = 0;
  let omitted = 0;
  const kept: string[] = [];
  for (const section of sections) {
    const size = Buffer.byteLength(section, 'utf8');
    if (used + size <= maxBytes) { kept.push(section); used += size; }
    else omitted++;
  }
  return { patch: kept.join(''), truncated: omitted > 0 || kept.length === 0, omittedFiles: omitted };
}
