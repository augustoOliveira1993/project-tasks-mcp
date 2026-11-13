import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { operationId, request } from '../../../api';
import type { Project } from '../../../api';
import { copyToClipboard } from '../../../lib/clipboard';
import { errorMessage } from '../../../lib/format';
import { makeToken } from '../../../lib/token';
import { Badge } from '../../../components/ui/badge';
import { Button } from '../../../components/ui/button';
import { Checkbox } from '../../../components/ui/checkbox';
import { Input } from '../../../components/ui/input';
import { Textarea } from '../../../components/ui/textarea';
import { buttonSecondary, buttonSecondarySmall, notice } from '../../../components/ui/classes';
import { IconCopy, IconFile } from '../../../components/ui/icons';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../../../components/ui/dialog';
import { ConfirmDialog } from '../../../components/ui/confirm-dialog';
import { ResponsibleSetupPdfDialog } from './ResponsibleSetupPdfDialog';
import { downloadTextFile, installerFileBase, personalUbuntuInstaller, personalWindowsInstaller, type IssuedCredentials } from './responsible-installation';

const fieldBase = 'rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[#344054]';
const fieldBox = `${fieldBase} text-[11px]`;
const stackLabel = 'grid gap-1.5 text-[10px] font-semibold text-[#566275]';
const fieldset = 'grid min-w-0 gap-2 rounded-ui-md border border-line px-4 py-3';
const legend = 'px-1.5 text-ui-xs font-bold text-ink-2';
const kindLine = 'grid items-start gap-1.5 py-1.5 text-ui-sm leading-relaxed font-semibold text-[#566275]';
const kindCheckbox = 'mt-0.5 size-4 shrink-0';
const kindText = 'grid gap-0.5';
const kindHint = 'text-ui-xs text-muted-strong';
const issuedMono = 'font-[family-name:ui-monospace,monospace] leading-[normal] font-normal';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function issuedText(issued: IssuedCredentials) {
  return [
    `Responsável: ${issued.email}`,
    issued.agent ? `Token de agente (acesso global das automações): ${issued.agent.token}` : '',
    issued.person ? `Token de acesso (pessoa) — projetos: ${issued.person.projects.join(', ')}\n${issued.person.token}` : '',
    issued.admin ? `Token humano (administrador do sistema; acesso global): ${issued.admin.token}` : ''
  ].filter(Boolean).join('\n\n');
}

/**
 * Cadastra um responsável: gera o token de agente e/ou o token de acesso de pessoa e define os projetos.
 * Os segredos são criados no navegador e exibidos uma única vez, no fim do fluxo.
 */
export function ResponsibleRegistration({ open, onOpenChange, token, projects, currentProjectId, systemAdmin, knownEmails, notify, onChanged }: {
  open: boolean; onOpenChange: (open: boolean) => void;
  token: string; projects: Project[]; currentProjectId: string; systemAdmin: boolean; knownEmails: string[];
  notify: (message: string, kind?: string) => void; onChanged: () => void | Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [wantsAgent, setWantsAgent] = useState(systemAdmin);
  const [humanCredential, setHumanCredential] = useState<'person' | 'admin' | 'none'>('person');
  const [selected, setSelected] = useState<string[]>(currentProjectId ? [currentProjectId] : []);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<IssuedCredentials | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [pdfOpen, setPdfOpen] = useState(false);
  const normalized = email.trim();
  const exists = knownEmails.some(item => item.toLowerCase() === normalized.toLowerCase());
  // Vários projetos num único token só podem ser concedidos por administrador do sistema (grant_credential_project).
  const multiProject = systemAdmin;

  function toggleProject(projectId: string, checked: boolean) {
    setSelected(current => !checked ? current.filter(id => id !== projectId) : multiProject ? [...current, projectId] : [projectId]);
  }

  function validateInput() {
    setError('');
    if (!emailPattern.test(normalized)) { setError('Informe um e-mail válido.'); return false; }
    if (!wantsAgent && humanCredential === 'none') { setError('Escolha uma credencial humana ou um token de agente.'); return false; }
    if (humanCredential === 'admin' && !systemAdmin) { setError('Somente um administrador do sistema pode emitir o token administrativo.'); return false; }
    if (humanCredential === 'person' && selected.length === 0) { setError('Escolha ao menos um projeto para o token de acesso.'); return false; }
    return true;
  }

  function requestSubmit(event: FormEvent) {
    event.preventDefault();
    if (validateInput()) setConfirming(true);
  }

  async function submit() {
    if (!validateInput()) { setConfirming(false); return; }
    const chosen = selected.map(id => projects.find(project => project._id === id)).filter((project): project is Project => Boolean(project));
    setConfirming(false);
    setBusy(true);
    const result: IssuedCredentials = { email: normalized, failures: [] };
    try {
      if (wantsAgent) {
        const secret = makeToken();
        try {
          const created = await request<{ credentialId: string }>(token, '/admin', { body: { action: 'issue', operationId: operationId(), userId: normalized, scope: 'agent', systemAdmin: false, token: secret } });
          result.agent = { token: secret, credentialId: created.credentialId };
        } catch (failure) { result.failures.push(`Token de agente: ${errorMessage(failure)}`); }
      }
      if (humanCredential === 'admin') {
        const secret = makeToken();
        try {
          const created = await request<{ credentialId: string }>(token, '/admin', { body: { action: 'issue', operationId: operationId(), userId: normalized, scope: 'human', systemAdmin: true, token: secret } });
          result.admin = { token: secret, credentialId: created.credentialId };
        } catch (failure) { result.failures.push(`Token administrativo: ${errorMessage(failure)}`); }
      } else if (humanCredential === 'person') {
        const [first, ...others] = chosen;
        const secret = makeToken();
        try {
          const created = await request<{ credentialId: string }>(token, '/admin', { body: { action: 'issue_project_member', operationId: operationId(), projectId: first._id, version: first.version, userId: normalized, token: secret } });
          result.person = { token: secret, credentialId: created.credentialId, projects: [first.name] };
          for (const project of others) {
            try {
              await request(token, '/admin', { body: { action: 'grant_credential_project', operationId: operationId(), projectId: project._id, version: project.version, credentialId: created.credentialId } });
              result.person.projects.push(project.name);
            } catch (failure) { result.failures.push(`Acesso ao projeto ${project.name}: ${errorMessage(failure)}`); }
          }
        } catch (failure) { result.failures.push(`Token de acesso: ${errorMessage(failure)}`); }
      }
      if (result.agent || result.person || result.admin) {
        setIssued(result);
        setEmail('');
        notify('Responsável cadastrado. Copie os tokens agora; eles não serão exibidos novamente.', result.failures.length ? 'info' : 'success');
        try {
          await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin-credentials'] }), queryClient.invalidateQueries({ queryKey: ['assignees'] }), onChanged()]);
        } catch {
          notify('Os tokens foram gerados, mas a listagem não atualizou. Atualize a página para ver o responsável.', 'info');
        }
      } else setError(result.failures.join(' '));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally { setBusy(false); }
  }

  async function copy(label: string, text: string) {
    if (await copyToClipboard(text)) { setCopied(label); window.setTimeout(() => setCopied(''), 1500); }
    else notify('Não foi possível copiar automaticamente. Selecione e copie o token.', 'error');
  }

  const humanSummary = humanCredential === 'person'
    ? `token de pessoa para ${selected.map(id => projects.find(project => project._id === id)?.name).filter(Boolean).join(', ')}`
    : humanCredential === 'admin' ? 'token humano de administrador do sistema' : '';
  const scopeSummary = [wantsAgent ? 'token de agente' : '', humanSummary].filter(Boolean).join(' e ');

  return <>
    <Dialog open={open} onOpenChange={nextOpen => { if (!busy && !confirming) onOpenChange(nextOpen); }}>
      <DialogContent className="flex max-h-[min(90dvh,820px)] w-[calc(100%-1.5rem)] max-w-3xl flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-5 py-5 sm:px-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">Workspace · cadastros</p>
          <DialogTitle className="mt-1">Novo responsável</DialogTitle>
          <DialogDescription>Cadastre a pessoa e gere suas credenciais. Os tokens aparecem uma única vez nesta tela.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
    {!issued ? <form id="responsible-registration-form" className="grid max-w-[720px] gap-[13px]" onSubmit={requestSubmit} autoComplete="off" noValidate>
      <label className={stackLabel}>E-mail do responsável<Input className={`w-full ${fieldBox}`} type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={320} placeholder="pessoa@empresa.com" /></label>
      {exists && <p className={notice.info} role="note">Já existe uma credencial para este e-mail. Gerar outro token não revoga os anteriores; o acesso aos projetos é compartilhado entre os tokens do mesmo e-mail.</p>}
      <fieldset className={fieldset}><legend className={legend}>Tokens a gerar</legend>
        <fieldset className="grid gap-1.5"><legend className={kindHint}>Credencial humana</legend>
          <label className={kindLine}><input className={`${kindCheckbox} accent-primary focus-visible:ring-2 focus-visible:ring-ring`} type="radio" name="human-credential-kind" checked={humanCredential === 'person'} onChange={() => setHumanCredential('person')} /><span className={kindText}><strong>Token de acesso (pessoa)</strong><small className={kindHint}>Entrar no painel e acompanhar os projetos escolhidos.</small></span></label>
          {systemAdmin && <label className={kindLine}><input className={`${kindCheckbox} accent-primary focus-visible:ring-2 focus-visible:ring-ring`} type="radio" name="human-credential-kind" checked={humanCredential === 'admin'} onChange={() => setHumanCredential('admin')} /><span className={kindText}><strong>Token de administrador</strong><small className={kindHint}>Acesso administrativo global ao painel.</small></span></label>}
          <label className={kindLine}><input className={`${kindCheckbox} accent-primary focus-visible:ring-2 focus-visible:ring-ring`} type="radio" name="human-credential-kind" checked={humanCredential === 'none'} onChange={() => setHumanCredential('none')} /><span className={kindText}><strong>Não gerar token humano</strong><small className={kindHint}>Use quando o responsável precisar somente da automação.</small></span></label>
        </fieldset>
        <label className={systemAdmin ? kindLine : `${kindLine} opacity-60`}><Checkbox className={kindCheckbox} checked={wantsAgent} disabled={!systemAdmin} onChange={event => setWantsAgent(event.target.checked)} /><span className={kindText}><strong>Token de agente</strong><small className={kindHint}>{systemAdmin ? 'Para Claude Code, Codex ou outra automação assumir tarefas (acesso global).' : 'Somente administradores do sistema emitem tokens de agente.'}</small></span></label>
      </fieldset>
      {humanCredential === 'person' && <fieldset className={fieldset} aria-describedby="project-access-hint"><legend className={legend}>Projetos com acesso</legend>
        <small className={kindHint} id="project-access-hint">{multiProject ? 'Marque todos os projetos que o token de acesso deve alcançar.' : 'Você pode conceder um projeto por vez; para vários, peça a um administrador do sistema.'}</small>
        <div className="grid max-h-[240px] gap-1 overflow-y-auto">{projects.map(project => <label className="flex cursor-pointer items-center gap-2.5 rounded-ui-sm border border-line px-2.5 py-2 text-ui-sm font-normal text-[#566275] has-[input:checked]:border-focus has-[input:checked]:bg-tone-blue-bg" key={project._id}>{multiProject ? <Checkbox className="size-4 shrink-0" checked={selected.includes(project._id)} onChange={event => toggleProject(project._id, event.target.checked)} /> : <input className="size-4 shrink-0 accent-primary focus-visible:ring-2 focus-visible:ring-ring" type="radio" name="project-access" checked={selected.includes(project._id)} onChange={event => toggleProject(project._id, event.target.checked)} />}<span className="min-w-0 flex-1 wrap-anywhere">{project.name}</span><Badge variant={project.visibility === 'private' ? 'warning' : 'success'}>{project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</Badge></label>)}</div>
      </fieldset>}
      {error && <p className="mt-1 text-ui-xs font-semibold text-tone-red" role="alert">{error}</p>}
      <div className="flex items-center gap-2"><Button type="submit" disabled={busy}>{busy ? 'Gerando…' : 'Cadastrar e gerar tokens'}</Button></div>
    </form> : <div className="mt-4 grid gap-[11px] rounded-[9px] border border-[#d8e9e1] bg-[#f7fcf9] p-3" role="status">
      <div className="grid gap-[3px] text-[10px] text-[#354e43]"><strong>Responsável cadastrado · {issued.email}</strong><small className={`${issuedMono} text-[9px] text-[#718279]`}>Copie agora: os tokens só aparecem nesta tela.</small></div>
      {issued.agent && <label className="grid gap-2 text-[10px] font-semibold text-[#566275]">Token de agente<Textarea className={`w-full ${fieldBase} wrap-anywhere ${issuedMono} text-[10px]`} readOnly rows={2} value={issued.agent.token} onFocus={event => event.currentTarget.select()} /><Button type="button" variant="outline" className={buttonSecondarySmall} onClick={() => void copy('agent', issued.agent!.token)}><IconCopy size={12} /> {copied === 'agent' ? 'Copiado' : 'Copiar token de agente'}</Button></label>}
      {issued.person && <label className="grid gap-2 text-[10px] font-semibold text-[#566275]">Token de acesso · {issued.person.projects.join(', ')}<Textarea className={`w-full ${fieldBase} wrap-anywhere ${issuedMono} text-[10px]`} readOnly rows={2} value={issued.person.token} onFocus={event => event.currentTarget.select()} /><Button type="button" variant="outline" className={buttonSecondarySmall} onClick={() => void copy('person', issued.person!.token)}><IconCopy size={12} /> {copied === 'person' ? 'Copiado' : 'Copiar token de acesso'}</Button></label>}
      {issued.admin && <label className="grid gap-2 text-[10px] font-semibold text-[#566275]">Token humano · administrador do sistema<Textarea className={`w-full ${fieldBase} wrap-anywhere ${issuedMono} text-[10px]`} readOnly rows={2} value={issued.admin.token} onFocus={event => event.currentTarget.select()} /><Button type="button" variant="outline" className={buttonSecondarySmall} onClick={() => void copy('admin', issued.admin!.token)}><IconCopy size={12} /> {copied === 'admin' ? 'Copiado' : 'Copiar token de administrador'}</Button></label>}
      <div className="grid gap-2">
        <p className={notice.info} role="note">{issued.agent ? 'O instalador Windows contém o token de agente; o instalador Ubuntu pede esse token no terminal sem exibi-lo. Envie os scripts apenas ao responsável por um canal seguro e execute-os uma vez.' : 'Os instaladores não contêm tokens. Se selecionar Bearer durante a instalação, será necessário informar um token de agente válido.'}</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" className={buttonSecondary} onClick={() => downloadTextFile(`${installerFileBase(issued.email)}.ps1`, personalWindowsInstaller(issued.email, issued.agent?.token))}><IconFile size={13} /> Baixar instalador Windows (.ps1)</Button>
          <Button type="button" variant="outline" className={buttonSecondary} onClick={() => downloadTextFile(`${installerFileBase(issued.email)}.sh`, personalUbuntuInstaller(issued.email, Boolean(issued.agent)))}><IconFile size={13} /> Baixar instalador Ubuntu (.sh)</Button>
          <Button type="button" onClick={() => setPdfOpen(true)}><IconFile size={13} /> Gerar PDF de instalação</Button>
        </div>
      </div>
      {issued.failures.length > 0 && <div className={notice.error} role="alert"><strong>Parte do cadastro falhou:</strong><ul className="mt-1 pl-[18px]">{issued.failures.map(failure => <li key={failure}>{failure}</li>)}</ul></div>}
      <div className="flex items-center gap-2"><Button type="button" variant="outline" className={buttonSecondary} onClick={() => void copy('all', issuedText(issued))}><IconCopy size={13} /> {copied === 'all' ? 'Copiado' : 'Copiar tudo'}</Button></div>
    </div>}
        </div>
        <DialogFooter className="shrink-0 border-t border-border bg-muted/20 px-5 py-3 sm:px-6"><Button type="button" variant="outline" className={buttonSecondary} onClick={() => onOpenChange(false)} disabled={busy}>{issued ? 'Concluir' : 'Cancelar'}</Button></DialogFooter>
      </DialogContent>
    </Dialog>
    <ConfirmDialog open={confirming} title="Confirmar cadastro?" description={`Serão gerados ${scopeSummary} para ${normalized}.`} confirmLabel="Gerar credenciais" pendingLabel="Gerando…" pending={busy} onOpenChange={setConfirming} onConfirm={() => void submit()} />
    {issued && <ResponsibleSetupPdfDialog open={pdfOpen} onOpenChange={setPdfOpen} issued={issued} notify={notify} />}
  </>;
}
