import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { operationId, request } from '../../api';
import type { Project } from '../../api';
import { copyToClipboard } from '../../lib/clipboard';
import { errorMessage } from '../../lib/format';
import { makeToken } from '../../lib/token';
import { Badge } from '../ui/Badge';
import { buttonGhost, buttonPrimary, buttonSecondary, buttonSecondarySmall, notice } from '../ui/classes';
import { IconCopy } from '../ui/icons';

type Issued = {
  email: string;
  agent?: { token: string; credentialId: string };
  person?: { token: string; credentialId: string; projects: string[] };
  failures: string[];
};

const fieldBase = 'rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[#344054]';
const fieldBox = `${fieldBase} text-[11px]`;
const stackLabel = 'grid gap-1.5 text-[10px] font-semibold text-[#566275]';
const fieldset = 'grid min-w-0 gap-2 rounded-ui-md border border-line px-4 py-3';
const legend = 'px-1.5 text-ui-xs font-bold text-ink-2';
const kindLine = 'grid items-start gap-1.5 py-1.5 text-ui-sm leading-relaxed font-semibold text-[#566275]';
const kindCheckbox = `mt-0.5 h-3.5 w-full shrink-0 accent-indigo-600 ${fieldBox}`;
const kindText = 'grid gap-0.5';
const kindHint = 'text-ui-xs text-muted-strong';
const issuedMono = 'font-[family-name:ui-monospace,monospace] leading-[normal] font-normal';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function issuedText(issued: Issued) {
  return [
    `Responsável: ${issued.email}`,
    issued.agent ? `Token de agente (acesso global das automações): ${issued.agent.token}` : '',
    issued.person ? `Token de acesso (pessoa) — projetos: ${issued.person.projects.join(', ')}\n${issued.person.token}` : ''
  ].filter(Boolean).join('\n\n');
}

/**
 * Cadastra um responsável: gera o token de agente e/ou o token de acesso de pessoa e define os projetos.
 * Os segredos são criados no navegador e exibidos uma única vez, no fim do fluxo.
 */
export function ResponsibleRegistration({ token, projects, currentProjectId, systemAdmin, knownEmails, notify, onChanged }: {
  token: string; projects: Project[]; currentProjectId: string; systemAdmin: boolean; knownEmails: string[];
  notify: (message: string, kind?: string) => void; onChanged: () => void | Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState('');
  const [wantsAgent, setWantsAgent] = useState(systemAdmin);
  const [wantsPerson, setWantsPerson] = useState(true);
  const [selected, setSelected] = useState<string[]>(currentProjectId ? [currentProjectId] : []);
  const [busy, setBusy] = useState(false);
  const [issued, setIssued] = useState<Issued | null>(null);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState('');
  const normalized = email.trim();
  const exists = knownEmails.some(item => item.toLowerCase() === normalized.toLowerCase());
  // Vários projetos num único token só podem ser concedidos por administrador do sistema (grant_credential_project).
  const multiProject = systemAdmin;

  function toggleProject(projectId: string, checked: boolean) {
    setSelected(current => !checked ? current.filter(id => id !== projectId) : multiProject ? [...current, projectId] : [projectId]);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError('');
    if (!emailPattern.test(normalized)) return setError('Informe um e-mail válido.');
    if (!wantsAgent && !wantsPerson) return setError('Escolha ao menos um tipo de token.');
    if (wantsPerson && selected.length === 0) return setError('Escolha ao menos um projeto para o token de acesso.');
    const chosen = selected.map(id => projects.find(project => project._id === id)).filter((project): project is Project => Boolean(project));
    if (!window.confirm(`Gerar ${[wantsAgent && 'token de agente', wantsPerson && `token de acesso (${chosen.map(project => project.name).join(', ')})`].filter(Boolean).join(' e ')} para ${normalized}?`)) return;
    setBusy(true);
    const result: Issued = { email: normalized, failures: [] };
    try {
      if (wantsAgent) {
        const secret = makeToken();
        try {
          const created = await request<{ credentialId: string }>(token, '/admin', { body: { action: 'issue', operationId: operationId(), userId: normalized, scope: 'agent', systemAdmin: false, token: secret } });
          result.agent = { token: secret, credentialId: created.credentialId };
        } catch (failure) { result.failures.push(`Token de agente: ${errorMessage(failure)}`); }
      }
      if (wantsPerson) {
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
      await Promise.all([queryClient.invalidateQueries({ queryKey: ['admin-credentials'] }), queryClient.invalidateQueries({ queryKey: ['assignees'] })]);
      await onChanged();
      if (result.agent || result.person) {
        setIssued(result);
        setEmail('');
        notify('Responsável cadastrado. Copie os tokens agora; eles não serão exibidos novamente.', result.failures.length ? 'info' : 'success');
      } else setError(result.failures.join(' '));
    } finally { setBusy(false); }
  }

  async function copy(label: string, text: string) {
    if (await copyToClipboard(text)) { setCopied(label); window.setTimeout(() => setCopied(''), 1500); }
    else notify('Não foi possível copiar automaticamente. Selecione e copie o token.', 'error');
  }

  return <section className="col-span-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-[760px]:col-auto" aria-labelledby="responsible-title">
    <div className="mb-[11px] flex items-center justify-between gap-3.5"><div><p className="font-display text-[10px] leading-[normal] font-bold tracking-[.11em] text-[#7180d8]">CADASTRO</p><h2 className="mb-1 font-display text-[14px] leading-[normal] font-bold tracking-[-.02em] text-[#273245]" id="responsible-title">Novo responsável</h2></div></div>
    <p className="mb-4 text-ui-sm text-muted-strong">Cadastre quem pode receber tarefas. O responsável passa a aparecer nas listas de atribuição e os tokens são gerados no final.</p>
    {!issued ? <form className="grid max-w-[720px] gap-[13px]" onSubmit={event => void submit(event)} autoComplete="off">
      <label className={stackLabel}>E-mail do responsável<input className={`w-full ${fieldBox}`} type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={320} placeholder="pessoa@empresa.com" /></label>
      {exists && <p className={notice.info} role="note">Já existe uma credencial para este e-mail. Gerar outro token não revoga os anteriores; o acesso aos projetos é compartilhado entre os tokens do mesmo e-mail.</p>}
      <fieldset className={fieldset}><legend className={legend}>Tokens a gerar</legend>
        <label className={kindLine}><input className={kindCheckbox} type="checkbox" checked={wantsPerson} onChange={event => setWantsPerson(event.target.checked)} /><span className={kindText}><strong>Token de acesso (pessoa)</strong><small className={kindHint}>Entrar no painel e acompanhar os projetos escolhidos.</small></span></label>
        <label className={systemAdmin ? kindLine : `${kindLine} opacity-60`}><input className={kindCheckbox} type="checkbox" checked={wantsAgent} disabled={!systemAdmin} onChange={event => setWantsAgent(event.target.checked)} /><span className={kindText}><strong>Token de agente</strong><small className={kindHint}>{systemAdmin ? 'Para Claude Code, Codex ou outra automação assumir tarefas (acesso global).' : 'Somente administradores do sistema emitem tokens de agente.'}</small></span></label>
      </fieldset>
      {wantsPerson && <fieldset className={fieldset} aria-describedby="project-access-hint"><legend className={legend}>Projetos com acesso</legend>
        <small className={kindHint} id="project-access-hint">{multiProject ? 'Marque todos os projetos que o token de acesso deve alcançar.' : 'Você pode conceder um projeto por vez; para vários, peça a um administrador do sistema.'}</small>
        <div className="grid max-h-[240px] gap-1 overflow-y-auto">{projects.map(project => <label className="flex cursor-pointer items-center gap-2.5 rounded-ui-sm border border-line px-2.5 py-2 text-ui-sm font-normal text-[#566275] has-[input:checked]:border-focus has-[input:checked]:bg-tone-blue-bg" key={project._id}><input className={`w-auto flex-none ${fieldBase} text-[11px]`} type={multiProject ? 'checkbox' : 'radio'} name="project-access" checked={selected.includes(project._id)} onChange={event => toggleProject(project._id, event.target.checked)} /><span className="min-w-0 flex-1 wrap-anywhere">{project.name}</span><Badge tone={project.visibility === 'private' ? 'amber' : 'green'}>{project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</Badge></label>)}</div>
      </fieldset>}
      {error && <p className="mt-1 text-ui-xs font-semibold text-tone-red" role="alert">{error}</p>}
      <div className="flex items-center gap-2"><button className={buttonPrimary} disabled={busy}>{busy ? 'Gerando…' : 'Cadastrar e gerar tokens'}</button></div>
    </form> : <div className="mt-4 grid gap-[11px] rounded-[9px] border border-[#d8e9e1] bg-[#f7fcf9] p-3" role="status">
      <div className="grid gap-[3px] text-[10px] text-[#354e43]"><strong>Responsável cadastrado · {issued.email}</strong><small className={`${issuedMono} text-[9px] text-[#718279]`}>Copie agora: os tokens só aparecem nesta tela.</small></div>
      {issued.agent && <label className="grid gap-2 text-[10px] font-semibold text-[#566275]">Token de agente<textarea className={`w-full ${fieldBase} wrap-anywhere ${issuedMono} text-[10px]`} readOnly rows={2} value={issued.agent.token} onFocus={event => event.currentTarget.select()} /><button type="button" className={buttonSecondarySmall} onClick={() => void copy('agent', issued.agent!.token)}><IconCopy size={12} /> {copied === 'agent' ? 'Copiado' : 'Copiar token de agente'}</button></label>}
      {issued.person && <label className="grid gap-2 text-[10px] font-semibold text-[#566275]">Token de acesso · {issued.person.projects.join(', ')}<textarea className={`w-full ${fieldBase} wrap-anywhere ${issuedMono} text-[10px]`} readOnly rows={2} value={issued.person.token} onFocus={event => event.currentTarget.select()} /><button type="button" className={buttonSecondarySmall} onClick={() => void copy('person', issued.person!.token)}><IconCopy size={12} /> {copied === 'person' ? 'Copiado' : 'Copiar token de acesso'}</button></label>}
      {issued.failures.length > 0 && <div className={notice.error} role="alert"><strong>Parte do cadastro falhou:</strong><ul className="mt-1 pl-[18px]">{issued.failures.map(failure => <li key={failure}>{failure}</li>)}</ul></div>}
      <div className="flex items-center gap-2"><button type="button" className={buttonSecondary} onClick={() => void copy('all', issuedText(issued))}><IconCopy size={13} /> {copied === 'all' ? 'Copiado' : 'Copiar tudo'}</button><button type="button" className={buttonGhost} onClick={() => { setIssued(null); setSelected(currentProjectId ? [currentProjectId] : []); }}>Concluir e cadastrar outro</button></div>
    </div>}
  </section>;
}
