import { useState, type FormEvent } from 'react';
import type { Project } from '../../api';
import { copyToClipboard } from '../../lib/clipboard';
import { Badge } from '../ui/Badge';
import { buttonGhost, buttonPrimary, buttonSecondarySmall } from '../ui/classes';
import { IconAlert, IconCheck, IconCopy } from '../ui/icons';

type Repository = NonNullable<Project['repositories']>[number];

const COMMIT_PATTERN = /^[0-9a-f]{40}$/i;
const URL_PATTERN = /^(https?:\/\/|ssh:\/\/|git@).+/i;

const cardBase = 'grid gap-3 rounded-ui-md border border-line border-l-4 p-4';
const cardBound = `${cardBase} border-l-[#1f9d5b] bg-white`;
const cardUnbound = `${cardBase} border-l-[#d99a1e] bg-[#fffdf8]`;
const gitCode = 'font-code text-[12px] leading-[normal] font-semibold';
const gitLabel = 'grid gap-[5px] text-ui-xs font-bold text-ink-2';
const gitHint = 'text-ui-xs font-normal text-muted-strong';
const gitInput = 'min-h-10 w-full rounded-ui-sm border border-line-strong bg-white px-3 font-code text-[13px] leading-[normal] font-normal aria-invalid:border-[#d4767f] aria-invalid:bg-[#fffafa]';

export function isValidRootCommit(value: string) { return COMMIT_PATTERN.test(value.trim()); }
export function isValidRemoteUrl(value: string) { return URL_PATTERN.test(value.trim()); }

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return <button type="button" className="inline-flex flex-none items-center gap-1 rounded-ui-sm border border-line-strong bg-white px-2 py-[3px] text-ui-xs font-semibold text-ink-2 hover:border-focus hover:text-tone-blue" aria-label={label} title={label} onClick={async () => { if (await copyToClipboard(text)) { setCopied(true); window.setTimeout(() => setCopied(false), 1500); } }}>{copied ? <IconCheck size={12} /> : <IconCopy size={12} />}<span>{copied ? 'Copiado' : 'Copiar'}</span></button>;
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

  return <article className={bound ? cardBound : cardUnbound} aria-label={`Repositório ${repository.name}`}>
    <header className="flex items-start justify-between gap-3">
      <div className="grid min-w-0 gap-0.5"><strong className="text-ui-md text-ink">{repository.name}</strong><small className="truncate text-ui-xs text-muted-strong" title={repository.url}>{repository.url}</small></div>
      {bound ? <Badge tone="green">✓ vinculado</Badge> : <Badge tone="amber">sem vínculo</Badge>}
    </header>
    {saved && <p className="text-[12px] font-semibold text-tone-green" role="status">Vínculo salvo.</p>}
    {bound && !editing ? <>
      <dl className="grid grid-cols-2 gap-3 max-[760px]:grid-cols-[minmax(0,1fr)]">
        <div className="grid min-w-0 gap-1 rounded-ui-sm bg-[#f6f8fb] px-3 py-2.5"><dt className="text-ui-xs font-bold text-muted-strong">URL Git canônica</dt><dd className="flex min-w-0 items-center justify-between gap-2 text-ui-sm text-ink-2"><span className="truncate" title={repository.git!.canonicalRemoteUrl}>{repository.git!.canonicalRemoteUrl}</span><CopyButton text={repository.git!.canonicalRemoteUrl} label="Copiar URL Git" /></dd></div>
        <div className="grid min-w-0 gap-1 rounded-ui-sm bg-[#f6f8fb] px-3 py-2.5"><dt className="text-ui-xs font-bold text-muted-strong">Commit raiz</dt><dd className="flex min-w-0 items-center justify-between gap-2 text-ui-sm text-ink-2"><code className={`truncate ${gitCode}`} title={repository.git!.rootCommit}>{repository.git!.rootCommit.slice(0, 12)}…</code><CopyButton text={repository.git!.rootCommit} label="Copiar commit raiz" /></dd></div>
      </dl>
      <div className="flex items-center gap-2"><button type="button" className={buttonSecondarySmall} onClick={() => setEditing(true)}>Editar vínculo</button></div>
    </> : <form className="grid max-w-[760px] gap-3" onSubmit={event => void submit(event)} noValidate>
      {!bound && <p className="flex items-start gap-1.5 text-ui-xs font-semibold text-tone-amber"><IconAlert size={13} /> Sem vínculo, a ponte Git não reconhece este repositório e não publica diffs na tarefa.</p>}
      <label className={gitLabel}>URL Git canônica
        <input className={gitInput} value={remoteUrl} onChange={event => setRemoteUrl(event.target.value)} placeholder="https://github.com/org/repo.git" aria-invalid={Boolean(remoteUrl) && !urlOk} autoComplete="off" spellCheck={false} />
        {remoteUrl && !urlOk ? <small className={`mt-1 ${gitHint}`}>Use uma URL https://, ssh:// ou git@host:org/repo.git.</small> : <small className={gitHint}>Endereço do remoto <code className={gitCode}>origin</code>. Pode copiar com <code className={gitCode}>git remote get-url origin</code>.</small>}
      </label>
      <label className={gitLabel}>Commit raiz
        <span className="relative block"><input className={gitInput} value={rootCommit} onChange={event => setRootCommit(event.target.value.trim())} placeholder="40 caracteres hexadecimais" maxLength={40} aria-invalid={Boolean(rootCommit) && !commitOk} autoComplete="off" spellCheck={false} /><span className={`absolute top-1/2 right-2.5 -translate-y-1/2 bg-white pl-1.5 font-[family-name:ui-monospace,monospace] text-[11px] leading-[normal] font-semibold ${commitOk ? 'text-tone-green' : 'text-muted-strong'}`} aria-live="polite">{rootCommit.length}/40</span></span>
        {rootCommit && !commitOk ? <small className={`mt-1 ${gitHint}`}>O commit raiz tem exatamente 40 caracteres de 0 a 9 e a a f.</small> : null}
      </label>
      <div className="grid gap-1.5 rounded-ui-sm border border-[#dbe5ff] bg-[#f7f8ff] px-3 py-2.5 text-ui-xs leading-normal text-ink-2" role="note">
        <span>Para achar o commit raiz, rode na pasta do repositório:</span>
        <span className="flex items-center justify-between gap-2 rounded-ui-sm bg-white px-2 py-1.5"><code className={gitCode}>git rev-list --max-parents=0 HEAD</code><CopyButton text="git rev-list --max-parents=0 HEAD" label="Copiar comando" /></span>
        <span>Cole aqui o hash de 40 caracteres que ele devolver.</span>
      </div>
      <div className="flex items-center gap-2">
        <button className={buttonPrimary} disabled={!canSave}>{saving ? 'Salvando…' : 'Salvar vínculo'}</button>
        {bound && <button type="button" className={buttonGhost} disabled={saving} onClick={() => { setEditing(false); setRemoteUrl(repository.git!.canonicalRemoteUrl); setRootCommit(repository.git!.rootCommit); }}>Cancelar</button>}
        {!changed && bound && <small className="text-[10px] leading-[1.6] text-muted-strong">Altere um campo para salvar.</small>}
      </div>
    </form>}
  </article>;
}

/** Vínculo de cada repositório do projeto com o repositório Git local (usado pela ponte Git). */
export function RepositoryGitBinding({ project, busy, onSave }: { project: Project; busy: boolean; onSave: (repositoryId: string, remoteUrl: string, rootCommit: string) => Promise<boolean> }) {
  const repositories = project.repositories ?? [];
  const boundCount = repositories.filter(repository => repository.git).length;
  return <section className="col-span-full rounded-xl border border-slate-200 bg-white p-6 shadow-sm max-[760px]:col-auto max-[760px]:p-4" aria-labelledby="git-binding-title">
    <div className="mb-3.5 flex items-start justify-between gap-3.5"><div><p className="font-display text-[10px] leading-[normal] font-bold tracking-[.11em] text-[#7180d8]">REPOSITÓRIOS</p><h2 className="mb-1 font-display text-[13px] leading-[normal] font-bold tracking-[-.02em] text-[#273245]" id="git-binding-title">Vincular repositórios Git</h2></div>
      {repositories.length > 0 && <Badge tone={boundCount === repositories.length ? 'green' : 'amber'}>{boundCount} de {repositories.length} {repositories.length === 1 ? 'repositório vinculado' : 'repositórios vinculados'}</Badge>}
    </div>
    <p className="mb-4 max-w-[80ch] text-ui-sm leading-[1.55] text-muted-strong">O vínculo permite que a ponte Git identifique o projeto pelo repositório aberto no seu computador e publique os diffs na tarefa certa. Ele não concede permissões: o acesso continua sendo controlado pelo projeto.</p>
    {repositories.length ? <div className="grid gap-3">{repositories.map(repository => <BindingCard key={repository.id + (repository.git?.rootCommit ?? '')} repository={repository} busy={busy} onSave={onSave} />)}</div> : <div className="grid justify-items-center gap-2 px-3.5 py-[30px] text-center"><h3 className="font-display text-[13px] leading-[normal] font-bold text-[#394558]">Este projeto não tem repositórios</h3><p className="mb-2 text-[11px] text-[#8993a3]">Cadastre repositórios em Cadastros › Projetos para vinculá-los aqui.</p></div>}
  </section>;
}
