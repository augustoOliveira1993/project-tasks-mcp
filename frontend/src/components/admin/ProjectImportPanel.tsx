import { useRef, useState } from 'react';
import { request } from '../../api';
import { errorMessage } from '../../lib/format';
import type { ProjectExport } from './ProjectExportPanel';
import './admin-panels.css';

const maxFileSize = 25 * 1024 * 1024;
export type ImportResult = { projectId: string; name: string; reused: boolean; counts: Record<string, number>; warnings: string[] };
type ImportPreview = { package: ProjectExport; name: string; fileName: string };

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
  return { package: value, name: value.data.project.name, fileName: file.name };
}

export function ProjectImportPanel({ token, canImport, onImported }: { token: string; canImport: boolean; onImported: (result: ImportResult) => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const readVersion = useRef(0);
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
      const imported = await request<ImportResult>(token, '/admin/projects/import', { body: preview.package });
      setResult(imported); onImported(imported);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setBusy(false); }
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
      {preview && <div className="transfer-file-preview"><strong>{preview.name}</strong><span>{preview.fileName}</span><dl className="transfer-counts"><div><dt>Tarefas</dt><dd>{preview.package.counts.tasks ?? 0}</dd></div><div><dt>Documentos</dt><dd>{preview.package.counts.markdownDocuments ?? 0}</dd></div><div><dt>Conversas</dt><dd>{preview.package.counts.conversations ?? 0}</dd></div></dl></div>}
      <div className="transfer-note"><strong>Importação sem sobrescrita</strong><p>Os IDs e vínculos são preservados. Reenviar o mesmo pacote não duplica os registros; conflitos são informados antes de salvar.</p></div>
      <p className="muted-text">A importação cria o projeto do arquivo. Acessos devem ser configurados novamente; execuções e automações antigas não são retomadas.</p>
      {!canImport && <p className="notice" role="note">Entre com uma credencial de administrador do sistema para importar projetos.</p>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {result && <div className="transfer-success" role="status"><strong>{result.reused ? 'Este pacote já foi importado.' : 'Projeto importado com sucesso.'}</strong><p>{result.name} · {result.counts.tasks ?? 0} tarefas. A lista de projetos foi atualizada.</p>{result.warnings.map(warning => <p key={warning}>{warning}</p>)}</div>}
    </div>
    <footer className="project-transfer-footer"><button type="button" className="button primary" disabled={!canImport || !preview || busy || reading} onClick={() => void importData()}>{busy ? 'Importando projeto…' : 'Importar projeto'}</button><span>Validação completa antes da gravação.</span></footer>
  </section>;
}
