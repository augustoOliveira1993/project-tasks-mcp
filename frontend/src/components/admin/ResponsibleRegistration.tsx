import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { operationId, request } from '../../api';
import type { Project } from '../../api';
import { copyToClipboard } from '../../lib/clipboard';
import { errorMessage } from '../../lib/format';
import { makeToken } from '../../lib/token';
import { Badge } from '../ui/Badge';
import { IconCopy } from '../ui/icons';

type Issued = {
  email: string;
  agent?: { token: string; credentialId: string };
  person?: { token: string; credentialId: string; projects: string[] };
  failures: string[];
};

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

  return <section className="panel-card wide-card responsible-registration" aria-labelledby="responsible-title">
    <div className="section-heading"><div><p className="eyebrow">CADASTRO</p><h2 id="responsible-title">Novo responsável</h2></div></div>
    <p className="muted-text">Cadastre quem pode receber tarefas. O responsável passa a aparecer nas listas de atribuição e os tokens são gerados no final.</p>
    {!issued ? <form className="stack-form" onSubmit={event => void submit(event)} autoComplete="off">
      <label>E-mail do responsável<input type="email" value={email} onChange={event => setEmail(event.target.value)} required maxLength={320} placeholder="pessoa@empresa.com" /></label>
      {exists && <p className="notice" role="note">Já existe uma credencial para este e-mail. Gerar outro token não revoga os anteriores; o acesso aos projetos é compartilhado entre os tokens do mesmo e-mail.</p>}
      <fieldset className="token-kinds"><legend>Tokens a gerar</legend>
        <label className="confirm-line"><input type="checkbox" checked={wantsPerson} onChange={event => setWantsPerson(event.target.checked)} /><span><strong>Token de acesso (pessoa)</strong><small>Entrar no painel e acompanhar os projetos escolhidos.</small></span></label>
        <label className={'confirm-line' + (systemAdmin ? '' : ' disabled')}><input type="checkbox" checked={wantsAgent} disabled={!systemAdmin} onChange={event => setWantsAgent(event.target.checked)} /><span><strong>Token de agente</strong><small>{systemAdmin ? 'Para Claude Code, Codex ou outra automação assumir tarefas (acesso global).' : 'Somente administradores do sistema emitem tokens de agente.'}</small></span></label>
      </fieldset>
      {wantsPerson && <fieldset className="project-access" aria-describedby="project-access-hint"><legend>Projetos com acesso</legend>
        <small id="project-access-hint">{multiProject ? 'Marque todos os projetos que o token de acesso deve alcançar.' : 'Você pode conceder um projeto por vez; para vários, peça a um administrador do sistema.'}</small>
        <div className="project-access-list">{projects.map(project => <label className="project-access-item" key={project._id}><input type={multiProject ? 'checkbox' : 'radio'} name="project-access" checked={selected.includes(project._id)} onChange={event => toggleProject(project._id, event.target.checked)} /><span>{project.name}</span><Badge tone={project.visibility === 'private' ? 'amber' : 'green'}>{project.visibility === 'private' ? 'Privado' : 'Compartilhado'}</Badge></label>)}</div>
      </fieldset>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="button-row"><button className="button primary" disabled={busy}>{busy ? 'Gerando…' : 'Cadastrar e gerar tokens'}</button></div>
    </form> : <div className="issued-token responsible-result" role="status">
      <div><strong>Responsável cadastrado · {issued.email}</strong><small>Copie agora: os tokens só aparecem nesta tela.</small></div>
      {issued.agent && <label>Token de agente<textarea readOnly rows={2} value={issued.agent.token} onFocus={event => event.currentTarget.select()} /><button type="button" className="button secondary small-button" onClick={() => void copy('agent', issued.agent!.token)}><IconCopy size={12} /> {copied === 'agent' ? 'Copiado' : 'Copiar token de agente'}</button></label>}
      {issued.person && <label>Token de acesso · {issued.person.projects.join(', ')}<textarea readOnly rows={2} value={issued.person.token} onFocus={event => event.currentTarget.select()} /><button type="button" className="button secondary small-button" onClick={() => void copy('person', issued.person!.token)}><IconCopy size={12} /> {copied === 'person' ? 'Copiado' : 'Copiar token de acesso'}</button></label>}
      {issued.failures.length > 0 && <div className="notice error" role="alert"><strong>Parte do cadastro falhou:</strong><ul>{issued.failures.map(failure => <li key={failure}>{failure}</li>)}</ul></div>}
      <div className="button-row"><button type="button" className="button secondary" onClick={() => void copy('all', issuedText(issued))}><IconCopy size={13} /> {copied === 'all' ? 'Copiado' : 'Copiar tudo'}</button><button type="button" className="button ghost" onClick={() => { setIssued(null); setSelected(currentProjectId ? [currentProjectId] : []); }}>Concluir e cadastrar outro</button></div>
    </div>}
  </section>;
}
