import { useState, type FormEvent } from 'react';
import type { Project } from '../../api';
import { copyToClipboard } from '../../lib/clipboard';
import { Badge } from '../ui/Badge';
import { IconAlert, IconCheck, IconCopy } from '../ui/icons';

type Repository = NonNullable<Project['repositories']>[number];

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const URL_PATTERN = /^(https?:\/\/|ssh:\/\/|git@).+/i;

export function isValidRootCommit(value: string) { return COMMIT_PATTERN.test(value.trim()); }
export function isValidRemoteUrl(value: string) { return URL_PATTERN.test(value.trim()); }

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="copy-inline" aria-label={label} title={label} onClick={async () => { if (await copyToClipboard(text)) { setCopied(true); window.setTimeout(() => setCopied(false), 1500); } }}>{copied ? <IconCheck size={12} /> : <IconCopy size={12} />}<span>{copied ? 'Copiado' : 'Copiar'}</span></button>;
}

function BindingCard({ repository, busy, onSave }: { repository: Repository; busy: boolean; onSave: (repositoryId: string, remoteUrl: string, rootCommit: string) => Promise<boolean> }) {
  const bound = Boolean(repository.git);
  const [editing, setEditing] = useState(!bound);
  const [remoteUrl, setRemoteUrl] = useState(repository.git?.canonicalRemoteUrl ?? repository.url ?? '');
  const [rootCommit, setRootCommit] = useState(repository.git?.rootCommit ?? '');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const urlOk = isValidRemoteUrl(remoteUrl);
  const commitOk = isValidRootCommit(rootCommit);
  const changed = remoteUrl.trim() !== (repository.git?.canonicalRemoteUrl ?? '') || rootCommit.trim().toLowerCase() !== (repository.git?.rootCommit ?? '');
  const canSave = urlOk && commitOk && changed && !busy && !saving;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSave) return;
    setSaving(true);
    const done = await onSave(repository.id, remoteUrl.trim(), rootCommit.trim().toLowerCase());
    setSaving(false);
    if (done) { setSaved(true); setEditing(false); window.setTimeout(() => setSaved(false), 4000); }
  }

  return <article className={'git-card' + (bound ? ' bound' : ' unbound')} aria-label={`Repositório ${repository.name}`}>
    <header className="git-card-head">
      <div><strong>{repository.name}</strong><small title={repository.url}>{repository.url}</small></div>
      {bound ? <Badge tone="green">✓ vinculado</Badge> : <Badge tone="amber">sem vínculo</Badge>}
    </header>
    {saved && <p className="criterion-ok" role="status">Vínculo salvo.</p>}
    {bound && !editing ? <>
      <dl className="git-facts">
        <div><dt>URL Git canônica</dt><dd><span title={repository.git!.canonicalRemoteUrl}>{repository.git!.canonicalRemoteUrl}</span><CopyButton text={repository.git!.canonicalRemoteUrl} label="Copiar URL Git" /></dd></div>
        <div><dt>Commit raiz</dt><dd><code title={repository.git!.rootCommit}>{repository.git!.rootCommit.slice(0, 12)}…</code><CopyButton text={repository.git!.rootCommit} label="Copiar commit raiz" /></dd></div>
      </dl>
      <div className="button-row"><button type="button" className="button secondary small-button" onClick={() => setEditing(true)}>Editar vínculo</button></div>
    </> : <form className="git-form" onSubmit={event => void submit(event)} noValidate>
      {!bound && <p className="git-warning"><IconAlert size={13} /> Sem vínculo, a ponte Git não reconhece este repositório e não publica diffs na tarefa.</p>}
      <label>URL Git canônica
        <input value={remoteUrl} onChange={event => setRemoteUrl(event.target.value)} placeholder="https://github.com/org/repo.git" aria-invalid={Boolean(remoteUrl) && !urlOk} autoComplete="off" spellCheck={false} />
        {remoteUrl && !urlOk ? <small className="field-error">Use uma URL https://, ssh:// ou git@host:org/repo.git.</small> : <small>Endereço do remoto <code>origin</code>. Pode copiar com <code>git remote get-url origin</code>.</small>}
      </label>
      <label>Commit raiz
        <span className="git-commit-field"><input value={rootCommit} onChange={event => setRootCommit(event.target.value.trim())} placeholder="40 caracteres hexadecimais" maxLength={40} aria-invalid={Boolean(rootCommit) && !commitOk} autoComplete="off" spellCheck={false} /><span className={'git-counter' + (commitOk ? ' ok' : '')} aria-live="polite">{rootCommit.length}/40</span></span>
        {rootCommit && !commitOk ? <small className="field-error">O commit raiz tem exatamente 40 caracteres de 0 a 9 e a a f.</small> : null}
      </label>
      <div className="git-help" role="note">
        <span>Para achar o commit raiz, rode na pasta do repositório:</span>
        <span className="git-command"><code>git rev-list --max-parents=0 HEAD</code><CopyButton text="git rev-list --max-parents=0 HEAD" label="Copiar comando" /></span>
        <span>Cole aqui o hash de 40 caracteres que ele devolver.</span>
      </div>
      <div className="button-row">
        <button className="button primary" disabled={!canSave}>{saving ? 'Salvando…' : 'Salvar vínculo'}</button>
        {bound && <button type="button" className="button ghost" disabled={saving} onClick={() => { setEditing(false); setRemoteUrl(repository.git!.canonicalRemoteUrl); setRootCommit(repository.git!.rootCommit); }}>Cancelar</button>}
        {!changed && bound && <small className="muted-text">Altere um campo para salvar.</small>}
      </div>
    </form>}
  </article>;
}

/** Vínculo de cada repositório do projeto com o repositório Git local (usado pela ponte Git). */
export function RepositoryGitBinding({ project, busy, onSave }: { project: Project; busy: boolean; onSave: (repositoryId: string, remoteUrl: string, rootCommit: string) => Promise<boolean> }) {
  const repositories = project.repositories ?? [];
  const boundCount = repositories.filter(repository => repository.git).length;
  return <section className="panel-card wide-card git-binding" aria-labelledby="git-binding-title">
    <div className="section-heading"><div><p className="eyebrow">REPOSITÓRIOS</p><h2 id="git-binding-title">Vincular repositórios Git</h2></div>
      {repositories.length > 0 && <Badge tone={boundCount === repositories.length ? 'green' : 'amber'}>{boundCount} de {repositories.length} {repositories.length === 1 ? 'repositório vinculado' : 'repositórios vinculados'}</Badge>}
    </div>
    <p className="muted-text">O vínculo permite que a ponte Git identifique o projeto pelo repositório aberto no seu computador e publique os diffs na tarefa certa. Ele não concede permissões: o acesso continua sendo controlado pelo projeto.</p>
    {repositories.length ? <div className="git-card-list">{repositories.map(repository => <BindingCard key={repository.id + (repository.git?.rootCommit ?? '')} repository={repository} busy={busy} onSave={onSave} />)}</div> : <div className="empty-state compact"><h3>Este projeto não tem repositórios</h3><p>Cadastre repositórios em Cadastros › Projetos para vinculá-los aqui.</p></div>}
  </section>;
}
