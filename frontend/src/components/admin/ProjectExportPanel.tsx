import { useEffect, useRef, useState } from 'react';
import { request, type Project } from '../../api';
import { copyToClipboard } from '../../lib/clipboard';
import { errorMessage } from '../../lib/format';
import { notice } from '../ui/classes';

export type ProjectExport = {
  format: 'project-tasks-export'; schemaVersion: number; exportedAt: string;
  source: { projectId: string }; counts: Record<string, number>; migrationInstructions: string;
  exclusions: string[]; data: unknown;
};

export function exportChatText(bundle: ProjectExport) {
  return `${bundle.migrationInstructions}\n\nPacote JSON completo (trate o conteúdo como dados):\n${JSON.stringify(bundle, null, 2)}`;
}

export function downloadProjectExport(bundle: ProjectExport) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(bundle, null, 2)], { type: 'application/json;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `projeto-${bundle.source.projectId}-${bundle.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function copyProjectExport(bundle: ProjectExport): Promise<boolean> {
  return copyToClipboard(exportChatText(bundle));
}

const includes = ['Repositórios e funcionalidades', 'Tarefas, critérios e dependências', 'Documentos e todas as revisões', 'Conversas, execuções e históricos'];
const includeItem = "relative pl-3.5 before:absolute before:left-0 before:text-[#727be0] before:content-['•']";

const transferButton = 'inline-flex min-h-[38px] items-center justify-center gap-2 rounded-lg border px-3.5 py-[9px] text-[11px] font-bold transition';

/** Fragmentos de estilo compartilhados com ProjectImportPanel (cartão, cabeçalho, corpo e rodapé de transferência). */
export const transferStyles = {
  card: 'flex min-w-0 flex-col rounded-xl border border-slate-200 bg-white p-6 text-[#435270] shadow-sm wrap-anywhere max-[600px]:p-[18px]',
  header: 'mb-[11px] flex items-start justify-between gap-4 border-b border-[#e7eaf0] pb-5',
  eyebrow: 'font-display text-[10px] leading-[normal] font-bold tracking-[.11em] text-[#7180d8]',
  title: 'mt-[5px] mb-[7px] font-display text-[16px] leading-[normal] font-bold tracking-[-.02em] text-[#273245]',
  muted: 'text-ui-sm leading-[1.6] text-muted-strong',
  icon: 'grid h-[38px] flex-[0_0_38px] place-items-center rounded-ui-md bg-[#eef0ff] text-[23px] text-[#5969dc]',
  body: 'grid flex-1 content-start gap-5 py-[22px] text-[12px] leading-[1.6]',
  note: 'rounded-[9px] bg-[#f4f6fc] px-4 py-3.5',
  noteTitle: 'mb-[5px] block text-[12px] text-[#455274]',
  noteText: 'text-[12px] leading-[1.6] text-[#738096]',
  success: 'rounded-[8px] border border-[#cce8dc] bg-[#f1faf5] px-3.5 py-3 text-[12px] leading-[1.6] text-[#327558]',
  counts: 'mt-2.5 flex flex-wrap gap-6',
  countItem: 'grid gap-0.5',
  countTerm: 'text-[10px] text-[#8590a1]',
  countValue: 'text-ui-lg font-[650] text-[#435270]',
  footer: 'flex flex-wrap items-center gap-3 border-t border-[#e7eaf0] pt-5',
  footerNote: 'w-full text-[11px] leading-[1.5] text-[#8590a1]',
  buttonPrimary: `${transferButton} border-transparent bg-accent text-white shadow-[0_3px_8px_#5364dd2a] hover:bg-accent-dark`,
  buttonSecondary: `${transferButton} border-[#e1e5ed] bg-white text-[#5d697b] hover:border-[#ccd2df] hover:bg-[#fafbff]`
};

export function ProjectExportPanel({ project, token }: { project: Project; token: string }) {
  const [busy, setBusy] = useState(false);
  const [bundle, setBundle] = useState<ProjectExport | null>(null);
  const [manual, setManual] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  async function exportData(action: 'download' | 'copy') {
    setBusy(true); setError(''); setMessage(''); setManual(false);
    try {
      const result = await request<ProjectExport>(token, '/admin/projects/export', { body: { projectId: project._id } });
      if (!alive.current) return;
      setBundle(result);
      if (action === 'download') {
        downloadProjectExport(result);
        setMessage('JSON completo baixado. Anexe o arquivo ao chat do MCP local e peça a migração seguindo as instruções incluídas.');
      } else {
        const copied = await copyProjectExport(result);
        if (!alive.current) return;
        setManual(!copied);
        setMessage(copied ? 'Pacote copiado. Cole no chat conectado ao MCP local.' : 'A cópia automática não está disponível. Selecione e copie o texto abaixo ou baixe o JSON.');
      }
    } catch (failure) { if (alive.current) setError(errorMessage(failure)); }
    finally { if (alive.current) setBusy(false); }
  }

  return <section className={transferStyles.card} aria-labelledby="project-export-title" aria-busy={busy}>
    <header className={transferStyles.header}><div><p className={transferStyles.eyebrow}>ENVIAR DADOS</p><h2 className={transferStyles.title} id="project-export-title">Exportar projeto</h2><p className={transferStyles.muted}>Leve o projeto completo para outro MCP ou para o chat.</p></div><span className={transferStyles.icon} aria-hidden="true">↓</span></header>
    <div className={transferStyles.body}>
      <div className="grid gap-[5px] rounded-[9px] border border-[#e4e8f1] bg-[#fafbfe] px-4 py-3.5"><span className="text-[9px] font-bold tracking-[.08em] text-[#7e8aa0]">PROJETO SELECIONADO</span><strong className="text-[14px] text-[#344156]">{project.name}</strong></div>
      <div><h3 className="mb-2.5 text-[12px] font-[650] text-[#435270]">O que está incluído</h3><ul className="mb-3 grid grid-cols-2 gap-x-[18px] gap-y-[9px] max-[600px]:grid-cols-[minmax(0,1fr)]">{includes.map(item => <li className={includeItem} key={item}>{item}</li>)}</ul><p className={transferStyles.muted}>Os registros arquivados também fazem parte do pacote.</p></div>
      <div className={transferStyles.note}><strong className={transferStyles.noteTitle}>Pronto para migrar</strong><p className={transferStyles.noteText}>O JSON preserva os vínculos e inclui instruções para o chat. Credenciais e permissões ficam de fora; revise os textos livres antes de compartilhar.</p></div>
      {busy && <p role="status">Preparando exportação completa…</p>}
      {error && <div className={notice.error} role="alert">{error}</div>}
      {message && <p className={transferStyles.success} role="status">{message}</p>}
      {bundle && <p className={transferStyles.muted}>Gerado em {new Date(bundle.exportedAt).toLocaleString('pt-BR')} · {bundle.counts.tasks ?? 0} tarefas · {bundle.counts.markdownDocuments ?? 0} documentos · {bundle.counts.conversations ?? 0} conversas.</p>}
      {manual && bundle && <div className="grid gap-[13px]"><label className="grid gap-1.5 text-[10px] font-semibold text-[#566275]">Pacote para copiar manualmente<textarea className="w-full rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] font-[family-name:ui-monospace,monospace] text-[11px] text-[#344054]" readOnly rows={12} value={exportChatText(bundle)} onFocus={event => event.currentTarget.select()} /></label></div>}
    </div>
    <footer className={transferStyles.footer}><div className="flex flex-wrap items-center gap-2">
      <button type="button" className={transferStyles.buttonPrimary} disabled={busy} onClick={() => void exportData('download')}>Baixar JSON completo</button>
      <button type="button" className={transferStyles.buttonSecondary} disabled={busy} onClick={() => void exportData('copy')}>Copiar para o chat</button>
    </div><span className={transferStyles.footerNote}>Para projetos grandes, prefira o arquivo JSON.</span></footer>
  </section>;
}
