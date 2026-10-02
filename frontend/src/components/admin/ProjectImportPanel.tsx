import { useEffect, useRef, useState } from 'react';
import { request } from '../../api';
import { errorMessage } from '../../lib/format';
import type { ProjectExport } from './ProjectExportPanel';
import './admin-panels.css';

const maxFileSize = 25 * 1024 * 1024;
const collectionLabels: Record<string, string> = {
  project: 'Projeto', repositories: 'Repositórios', features: 'Funcionalidades', tasks: 'Tarefas', taskDependencies: 'Dependências',
  executions: 'Execuções', events: 'Históricos', taskMessages: 'Mensagens de tarefas', conversations: 'Conversas',
  conversationMessages: 'Mensagens de conversas', actionProposals: 'Propostas', deliveryEvents: 'Eventos', taskDiffs: 'Diffs',
  automationJobs: 'Automações', markdownDocuments: 'Documentos', markdownRevisions: 'Revisões de documentos'
};
export type ImportResult = {
  projectId: string; name: string; reused: boolean; alreadyImported?: boolean;
  importedCounts: Record<string, number>; skippedCounts: Record<string, number>;
  skipped: Array<{ collection: string; id: string; reason: string }>; skippedDetailsTruncated?: boolean; warnings: string[];
};
type ImportPreview = { package: ProjectExport; name: string; fileName: string; fileSize: number };

const totalRecords = (counts: Record<string, number> = {}) => Object.values(counts).reduce((total, count) => total + count, 0);
const countDetails = (counts: Record<string, number> = {}) => Object.entries(counts).filter(([, count]) => count > 0);

export async function readProjectImport(file: Pick<File, 'size' | 'name' | 'text'>): Promise<ImportPreview> {
  if (file.size > maxFileSize) throw new Error('O arquivo deve ter no máximo 25 MB.');
  let value: any;
  try { value = JSON.parse(await file.text()); }
  catch { throw new Error('Não foi possível ler o JSON. Selecione um arquivo gerado pela exportação de projeto.'); }
  if (value?.format !== 'project-tasks-export' || value.schemaVersion !== 1 || !value.data?.project ||
    typeof value.data.project.name !== 'string' || typeof value.source?.projectId !== 'string' || value.data.project._id !== value.source.projectId ||
    !value.counts || typeof value.counts !== 'object' || Object.values(value.counts).some(count => typeof count !== 'number' || !Number.isInteger(count) || count < 0)) {
    throw new Error('Formato não suportado. Use um JSON completo gerado por Exportar projeto.');
  }
  return { package: value, name: value.data.project.name, fileName: file.name, fileSize: file.size };
}

export function ProjectImportPanel({ token, canImport, onImported }: { token: string; canImport: boolean; onImported: (result: ImportResult) => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
  const resultDialog = useRef<HTMLDialogElement>(null);
  const readVersion = useRef(0);
  useEffect(() => {
    const dialog = resultDialog.current;
    if (resultOpen && dialog && !dialog.open) dialog.showModal();
    if (!resultOpen && dialog?.open) dialog.close();
    return () => { if (dialog?.open) dialog.close(); };
  }, [resultOpen]);
  async function selectFile(file?: File) {
    const version = ++readVersion.current;
    setPreview(null); setError(''); setResult(null); setReading(Boolean(file));
    if (!file) return;
    try { const next = await readProjectImport(file); if (readVersion.current === version) setPreview(next); }
    catch (failure) { if (readVersion.current === version) setError(errorMessage(failure)); }
    finally { if (readVersion.current === version) setReading(false); }
  }
  async function importData() {
    if (!preview || busy) return;
    setBusy(true); setError(''); setResult(null);
    try {
      const imported = await request<ImportResult>(token, '/admin/projects/import', { body: preview.package, gzip: true });
      setResult(imported); onImported(imported);
    } catch (failure) {
      setError(failure instanceof TypeError
        ? 'A conexão foi interrompida antes de o servidor responder. Confirme se o servidor está atualizado e se o proxy aceita o envio deste arquivo; depois tente novamente.'
        : errorMessage(failure));
    }
    finally { setBusy(false); setResultOpen(true); }
  }
  return <section className="panel-card project-transfer-card" aria-labelledby="project-import-title" aria-busy={busy || reading}>
    <header className="section-heading"><div><p className="eyebrow">RECEBER DADOS</p><h2 id="project-import-title">Importar projeto</h2><p className="muted-text">Restaure neste MCP um projeto exportado em outro ambiente.</p></div><span className="transfer-icon" aria-hidden="true">↑</span></header>
    <div className="project-transfer-body">
      <div className="transfer-file-field">
        <label htmlFor="project-import-file">Arquivo do projeto</label>
        <input id="project-import-file" type="file" accept=".json,application/json" disabled={!canImport || busy} onChange={event => void selectFile(event.target.files?.[0])} aria-describedby="project-import-help" />
        <small id="project-import-help">JSON gerado pela exportação · até 25 MB</small>
      </div>
      {reading && <p role="status">Lendo arquivo…</p>}
      {preview && <div className="transfer-file-preview"><strong>{preview.name}</strong><span>{preview.fileName} · {preview.fileSize < 1024 * 1024 ? `${Math.ceil(preview.fileSize / 1024)} KB` : `${(preview.fileSize / (1024 * 1024)).toFixed(1)} MB`}</span><dl className="transfer-counts"><div><dt>Tarefas</dt><dd>{preview.package.counts.tasks ?? 0}</dd></div><div><dt>Documentos</dt><dd>{preview.package.counts.markdownDocuments ?? 0}</dd></div><div><dt>Conversas</dt><dd>{preview.package.counts.conversations ?? 0}</dd></div></dl></div>}
      <div className="transfer-note"><strong>Importação sem sobrescrita</strong><p>Os IDs e vínculos são preservados. Itens existentes ou com conflito são pulados; os demais seguem na importação. Reenviar o mesmo pacote não duplica os registros.</p></div>
      <p className="muted-text">A importação cria o projeto ou mescla itens ausentes quando o ID já existe. Acessos devem ser configurados novamente; execuções e automações antigas não são retomadas.</p>
      {!canImport && <p className="notice" role="note">Entre com uma credencial de administrador do sistema para importar projetos.</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
    </div>
    <footer className="project-transfer-footer"><button type="button" className="button primary" disabled={!canImport || !preview || busy || reading} onClick={() => void importData()}>{busy ? 'Importando projeto…' : 'Importar projeto'}</button>{result && <button type="button" className="button secondary" onClick={() => setResultOpen(true)}>Ver resultado</button>}<span>Validação completa antes da gravação.</span></footer>
    <dialog ref={resultDialog} className="create-task-dialog project-import-result-dialog" aria-labelledby="project-import-result-title" onCancel={event => { event.preventDefault(); setResultOpen(false); }} onClose={() => setResultOpen(false)}>
      <header className="dialog-header"><div><p className="eyebrow">IMPORTAÇÃO DO PROJETO</p><h2 id="project-import-result-title">{error ? 'Erro na importação' : 'Resultado da importação'}</h2></div><button type="button" className="icon-button" aria-label="Fechar resultado da importação" onClick={() => setResultOpen(false)}>×</button></header>
      <div className="project-transfer-body">
      {error && <div className="notice error" role="alert">{error}</div>}
      {result && <div className="transfer-success" role="status">
        <strong>{result.alreadyImported ? 'Este pacote já tinha sido importado; nada foi duplicado.' : totalRecords(result.skippedCounts) > 0 ? 'Importação concluída com itens ignorados.' : 'Importação concluída.'}</strong>
        <p>{result.name} · {totalRecords(result.importedCounts)} importado(s) · {totalRecords(result.skippedCounts)} ignorado(s).</p>
        <dl className="transfer-counts"><div><dt>Importados</dt><dd>{totalRecords(result.importedCounts)}</dd></div><div><dt>Ignorados</dt><dd>{totalRecords(result.skippedCounts)}</dd></div></dl>
        {(countDetails(result.importedCounts).length > 0 || countDetails(result.skippedCounts).length > 0) && <div className="transfer-result-breakdown">
          {countDetails(result.importedCounts).length > 0 && <p><strong>Importados:</strong> {countDetails(result.importedCounts).map(([name, count]) => `${collectionLabels[name] ?? name}: ${count}`).join(' · ')}</p>}
          {countDetails(result.skippedCounts).length > 0 && <p><strong>Ignorados:</strong> {countDetails(result.skippedCounts).map(([name, count]) => `${collectionLabels[name] ?? name}: ${count}`).join(' · ')}</p>}
        </div>}
        {result.skipped.length > 0 && <details className="transfer-skip-details" open><summary>Conflitos e vínculos ignorados ({totalRecords(result.skippedCounts)})</summary><ul>{result.skipped.map(item => <li key={`${item.collection}:${item.id}`}><strong>{collectionLabels[item.collection] ?? item.collection}</strong> <code>{item.id}</code>: {item.reason}</li>)}</ul></details>}
        {result.skippedDetailsTruncated && <p>O resumo detalhado foi limitado; as contagens incluem todos os itens ignorados.</p>}
        {result.warnings.map(warning => <p key={warning}>{warning}</p>)}
      </div>}
      </div>
      <footer className="dialog-footer"><button type="button" className="button primary" autoFocus onClick={() => setResultOpen(false)}>Fechar</button></footer>
    </dialog>
  </section>;
}
