import { useEffect, useRef, useState } from 'react';
import { request, type Project } from '../../api';
import { copyToClipboard } from '../../lib/clipboard';
import { errorMessage } from '../../lib/format';

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

  return <section className="panel-card project-transfer-card project-export-panel" aria-labelledby="project-export-title" aria-busy={busy}>
    <header className="section-heading"><div><p className="eyebrow">ENVIAR DADOS</p><h2 id="project-export-title">Exportar projeto</h2><p className="muted-text">Leve o projeto completo para outro MCP ou para o chat.</p></div><span className="transfer-icon" aria-hidden="true">↓</span></header>
    <div className="project-transfer-body">
      <div className="transfer-project"><span>PROJETO SELECIONADO</span><strong>{project.name}</strong></div>
      <div><h3 className="transfer-subtitle">O que está incluído</h3><ul className="transfer-includes"><li>Repositórios e funcionalidades</li><li>Tarefas, critérios e dependências</li><li>Documentos e todas as revisões</li><li>Conversas, execuções e históricos</li></ul><p className="muted-text">Os registros arquivados também fazem parte do pacote.</p></div>
      <div className="transfer-note"><strong>Pronto para migrar</strong><p>O JSON preserva os vínculos e inclui instruções para o chat. Credenciais e permissões ficam de fora; revise os textos livres antes de compartilhar.</p></div>
      {busy && <p role="status">Preparando exportação completa…</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {message && <p className="transfer-success" role="status">{message}</p>}
      {bundle && <p className="muted-text">Gerado em {new Date(bundle.exportedAt).toLocaleString('pt-BR')} · {bundle.counts.tasks ?? 0} tarefas · {bundle.counts.markdownDocuments ?? 0} documentos · {bundle.counts.conversations ?? 0} conversas.</p>}
      {manual && bundle && <div className="stack-form"><label>Pacote para copiar manualmente<textarea readOnly rows={12} value={exportChatText(bundle)} onFocus={event => event.currentTarget.select()} /></label></div>}
    </div>
    <footer className="project-transfer-footer"><div className="button-row">
      <button type="button" className="button primary" disabled={busy} onClick={() => void exportData('download')}>Baixar JSON completo</button>
      <button type="button" className="button secondary" disabled={busy} onClick={() => void exportData('copy')}>Copiar para o chat</button>
    </div><span>Para projetos grandes, prefira o arquivo JSON.</span></footer>
  </section>;
}
