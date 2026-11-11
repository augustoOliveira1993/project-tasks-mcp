import { useRef, useState } from 'react';
import { request } from '../../../api';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { Input } from '../../../components/ui/input';
import { errorMessage } from '../../../lib/format';
import { notice } from '../../../components/ui/classes';
import { transferStyles, type ProjectExport } from './ProjectExportPanel';

const maxFileSize = 25 * 1024 * 1024;
const fileInput = 'w-full min-w-0 rounded-ui-md border border-dashed border-[#cbd3e7] bg-[#fafbfe] p-4 text-[#738096] file:mr-2.5 file:cursor-pointer file:rounded-ui-sm file:border file:border-[#dde2ef] file:bg-white file:px-2.5 file:py-2 file:text-[#4958bf] focus-visible:border-[#626ce2] focus-visible:outline-3! focus-visible:outline-[#e5e7ff]!';
const dialogBody = 'grid flex-1 content-start gap-5 px-6 py-[22px] text-[12px] leading-[1.6] wrap-anywhere';
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isCountRecord(value: unknown): value is Record<string, number> {
  return isRecord(value) && Object.values(value).every(count => typeof count === 'number' && Number.isInteger(count) && count >= 0);
}

const { counts, countItem, countTerm, countValue } = transferStyles;

const totalRecords = (counts: Record<string, number> = {}) => Object.values(counts).reduce((total, count) => total + count, 0);
const countDetails = (counts: Record<string, number> = {}) => Object.entries(counts).filter(([, count]) => count > 0);

export async function readProjectImport(file: Pick<File, 'size' | 'name' | 'text'>): Promise<ImportPreview> {
  if (file.size > maxFileSize) throw new Error('O arquivo deve ter no máximo 25 MB.');
  let value: unknown;
  try { value = JSON.parse(await file.text()); }
  catch { throw new Error('Não foi possível ler o JSON. Selecione um arquivo gerado pela exportação de projeto.'); }
  if (!isRecord(value) || value.format !== 'project-tasks-export' || value.schemaVersion !== 1 ||
    typeof value.exportedAt !== 'string' || typeof value.migrationInstructions !== 'string' ||
    !Array.isArray(value.exclusions) || !value.exclusions.every(item => typeof item === 'string') ||
    !isRecord(value.source) || typeof value.source.projectId !== 'string' ||
    !isRecord(value.data) || !isRecord(value.data.project) || typeof value.data.project.name !== 'string' ||
    value.data.project._id !== value.source.projectId || !isCountRecord(value.counts)) {
    throw new Error('Formato não suportado. Use um JSON completo gerado por Exportar projeto.');
  }
  return { package: value as unknown as ProjectExport, name: value.data.project.name, fileName: file.name, fileSize: file.size };
}

export function ProjectImportPanel({ token, canImport, onImported }: { token: string; canImport: boolean; onImported: (result: ImportResult) => void }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [resultOpen, setResultOpen] = useState(false);
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
      const imported = await request<ImportResult>(token, '/admin/projects/import', { body: preview.package, gzip: true });
      setResult(imported); onImported(imported);
    } catch (failure) {
      setError(failure instanceof TypeError
        ? 'A conexão foi interrompida antes de o servidor responder. Confirme se o servidor está atualizado e se o proxy aceita o envio deste arquivo; depois tente novamente.'
        : errorMessage(failure));
    }
    finally { setBusy(false); setResultOpen(true); }
  }
  return <section className={transferStyles.card} aria-labelledby="project-import-title" aria-busy={busy || reading}>
    <header className={transferStyles.header}><div><p className={transferStyles.eyebrow}>RECEBER DADOS</p><h2 className={transferStyles.title} id="project-import-title">Importar projeto</h2><p className={transferStyles.muted}>Restaure neste MCP um projeto exportado em outro ambiente.</p></div><span className={transferStyles.icon} aria-hidden="true">↑</span></header>
    <div className={transferStyles.body}>
      <div className="grid gap-[9px]">
        <label className="text-[12px] font-semibold text-[#435270]" htmlFor="project-import-file">Arquivo do projeto</label>
        <Input className={fileInput} id="project-import-file" type="file" accept=".json,application/json" disabled={!canImport || busy} onChange={event => void selectFile(event.target.files?.[0])} aria-describedby="project-import-help" />
        <small className="text-[11px] text-[#8590a1]" id="project-import-help">JSON gerado pela exportação · até 25 MB</small>
      </div>
      {reading && <p role="status">Lendo arquivo…</p>}
      {preview && <div className="grid min-w-0 gap-[5px] rounded-ui-md border border-[#dce2f4] p-[15px]"><strong>{preview.name}</strong><span className="text-[11px] text-[#8590a1]">{preview.fileName} · {preview.fileSize < 1024 * 1024 ? `${Math.ceil(preview.fileSize / 1024)} KB` : `${(preview.fileSize / (1024 * 1024)).toFixed(1)} MB`}</span><dl className={counts}><div className={countItem}><dt className={countTerm}>Tarefas</dt><dd className={countValue}>{preview.package.counts.tasks ?? 0}</dd></div><div className={countItem}><dt className={countTerm}>Documentos</dt><dd className={countValue}>{preview.package.counts.markdownDocuments ?? 0}</dd></div><div className={countItem}><dt className={countTerm}>Conversas</dt><dd className={countValue}>{preview.package.counts.conversations ?? 0}</dd></div></dl></div>}
      <div className={transferStyles.note}><strong className={transferStyles.noteTitle}>Importação sem sobrescrita</strong><p className={transferStyles.noteText}>Os IDs e vínculos são preservados. Itens existentes ou com conflito são pulados; os demais seguem na importação. Reenviar o mesmo pacote não duplica os registros.</p></div>
      <p className={transferStyles.muted}>A importação cria o projeto ou mescla itens ausentes quando o ID já existe. Acessos devem ser configurados novamente; execuções e automações antigas não são retomadas.</p>
      {!canImport && <p className={notice.info} role="note">Entre com uma credencial de administrador do sistema para importar projetos.</p>}
      {error && <div className={notice.error} role="alert">{error}</div>}
    </div>
    <footer className={transferStyles.footer}><Button type="button" disabled={!canImport || !preview || busy || reading} onClick={() => void importData()}>{busy ? 'Importando projeto…' : 'Importar projeto'}</Button>{result && <Button type="button" variant="outline" onClick={() => setResultOpen(true)}>Ver resultado</Button>}<span className={transferStyles.footerNote}>Validação completa antes da gravação.</span></footer>
    <Dialog open={resultOpen} onOpenChange={setResultOpen}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>{error ? 'Erro na importação' : 'Resultado da importação'}</DialogTitle>
          <DialogDescription>Resumo da validação e dos registros criados ou ignorados durante a importação.</DialogDescription>
        </DialogHeader>
      <div className={dialogBody}>
      {error && <div className={notice.error} role="alert">{error}</div>}
      {result && <div className={transferStyles.success} role="status">
        <strong>{result.alreadyImported ? 'Este pacote já tinha sido importado; nada foi duplicado.' : totalRecords(result.skippedCounts) > 0 ? 'Importação concluída com itens ignorados.' : 'Importação concluída.'}</strong>
        <p>{result.name} · {totalRecords(result.importedCounts)} importado(s) · {totalRecords(result.skippedCounts)} ignorado(s).</p>
        <dl className={counts}><div className={countItem}><dt className={countTerm}>Importados</dt><dd className={countValue}>{totalRecords(result.importedCounts)}</dd></div><div className={countItem}><dt className={countTerm}>Ignorados</dt><dd className={countValue}>{totalRecords(result.skippedCounts)}</dd></div></dl>
        {(countDetails(result.importedCounts).length > 0 || countDetails(result.skippedCounts).length > 0) && <div className="mt-2.5 grid gap-1">
          {countDetails(result.importedCounts).length > 0 && <p className="wrap-anywhere"><strong>Importados:</strong> {countDetails(result.importedCounts).map(([name, count]) => `${collectionLabels[name] ?? name}: ${count}`).join(' · ')}</p>}
          {countDetails(result.skippedCounts).length > 0 && <p className="wrap-anywhere"><strong>Ignorados:</strong> {countDetails(result.skippedCounts).map(([name, count]) => `${collectionLabels[name] ?? name}: ${count}`).join(' · ')}</p>}
        </div>}
        {result.skipped.length > 0 && <details className="mt-2.5 text-[#435270]" open><summary className="cursor-pointer font-[650]">Conflitos e vínculos ignorados ({totalRecords(result.skippedCounts)})</summary><ul className="grid max-h-[220px] gap-1.5 overflow-auto pt-2 pl-[18px]">{result.skipped.map(item => <li key={`${item.collection}:${item.id}`}><strong>{collectionLabels[item.collection] ?? item.collection}</strong> <code className="wrap-anywhere">{item.id}</code>: {item.reason}</li>)}</ul></details>}
        {result.skippedDetailsTruncated && <p>O resumo detalhado foi limitado; as contagens incluem todos os itens ignorados.</p>}
        {result.warnings.map((warning, index) => <p className={index > 0 || result.skippedDetailsTruncated ? 'mt-1.5' : undefined} key={warning}>{warning}</p>)}
      </div>}
      </div>
      <DialogFooter><Button type="button" variant="outline" onClick={() => setResultOpen(false)}>Fechar</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  </section>;
}
