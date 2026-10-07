import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { operationId, request } from '../../api';
import type { Project } from '../../api';
import { copyToClipboard } from '../../lib/clipboard';
import { errorMessage } from '../../lib/format';
import { buttonBase, notice } from '../../components/ui/classes';
import { primaryTone, secondaryTone } from './catalogClasses';

/** Formulário de projeto: cada fragmento é uma string literal completa para o Tailwind gerar as classes. */
const label = 'grid min-w-0 gap-2 text-[12px] font-semibold text-[#566275]';
const fieldBase = 'min-w-0 resize-y rounded-[9px] border border-[#e1e5ed] bg-white text-[13px] leading-[1.5] text-[#344054] focus-visible:border-[#626ce2]';
const field = `${fieldBase} min-h-[42px] w-full px-[13px] py-[11px]`;
const areaEntryField = `${field} flex-1`;
const areaEditField = `${fieldBase} min-h-8 w-[min(160px,30vw)] px-1.5 py-1`;
const radioInput = `${fieldBase} peer absolute h-px min-h-0 w-px p-0 opacity-0`;
const secondaryButton = `${buttonBase} min-h-[35px] px-3 ${secondaryTone} disabled:opacity-50`;
const addRepositoryButton = `${buttonBase} min-h-[40px] justify-self-start px-3 ${secondaryTone} disabled:opacity-50 max-[700px]:w-full`;
const areaAddButton = `${buttonBase} min-h-[42px] shrink-0 px-3 ${secondaryTone} disabled:opacity-50`;
const cancelButton = `${buttonBase} min-h-[44px] min-w-[160px] px-3 ${secondaryTone} disabled:opacity-50 max-[700px]:w-full`;
const submitButton = `${buttonBase} min-h-[44px] min-w-[160px] px-3 ${primaryTone} disabled:opacity-50 max-[700px]:w-full`;
const removeRepositoryButton = 'px-0 py-1 text-[11px] font-semibold text-tone-red enabled:hover:bg-tone-red-bg disabled:opacity-50';
const areaChipButton = 'grid size-7 shrink-0 place-items-center rounded-[5px] bg-transparent text-[18px] text-inherit enabled:hover:bg-[#dde2fc] disabled:opacity-50';
const section = 'grid min-w-0 gap-[18px]';
const sectionDivided = `${section} border-t border-[#e7eaf0] pt-6`;
const sectionTitle = 'flex flex-wrap items-center gap-2.5 text-[14px] font-[650] text-[#253858]';
const sectionHelp = 'mt-1.5 text-[12px] leading-[1.6] text-[#68778d]';
const repositoryCountBadge = 'rounded-[20px] bg-[#eef0ff] px-[9px] py-[3px] text-[11px] text-[#505cc9]';
const formGrid = 'grid grid-cols-2 items-start gap-5 max-[700px]:grid-cols-1 max-[700px]:gap-[18px]';
const fieldGroup = 'grid min-w-0 gap-3';
const helpText = 'text-[12px] leading-[1.5] text-muted-strong';
const errorText = 'text-[12px] leading-[1.5] text-tone-red hover:bg-tone-red-bg';
const repositoryFields = 'grid min-w-0 gap-[18px] rounded-xl border border-[#e7eaf0] bg-[#fafbfe] p-5 max-[700px]:p-3.5';
const visibilityCard = 'flex h-full min-h-[82px] items-center gap-2.5 rounded-ui-md border border-[#e1e5ed] bg-white p-3.5 text-[#68778d] peer-checked:border-[#626ce2] peer-checked:bg-[#f1f3ff] peer-checked:text-[#424db5] peer-checked:shadow-[0_0_0_1px_#626ce2] peer-focus-visible:outline-3 peer-focus-visible:outline-offset-3 peer-focus-visible:outline-[#a5adff]';

export function ProjectCreateForm({ token, nonce, project, onSaved, notify, inDialog = false, dialogTitleId = 'create-project-dialog-title', onCancel, onSavingChange }: {
  token: string;
  nonce: string;
  project?: Project;
  onSaved: (project: Project) => void;
  notify: (message: string, kind?: string) => void;
  inDialog?: boolean;
  dialogTitleId?: string;
  onCancel?: () => void;
  onSavingChange?: (saving: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [visibility, setVisibility] = useState<'public' | 'private'>(() => project?.visibility === 'private' ? 'private' : 'public');
  const [repositories, setRepositories] = useState<NonNullable<Project['repositories']>>(() => project?.repositories?.map(repository => ({ ...repository })) ?? [{ id: operationId(), name: '', url: '', instructions: '' }]);
  const [areas, setAreas] = useState(project?.areas?.length ? project.areas : ['backend', 'frontend', 'outro']);
  const [areaDraft, setAreaDraft] = useState('');
  const [areaError, setAreaError] = useState('');
  const [editingArea, setEditingArea] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showAccessToken, setShowAccessToken] = useState(false);
  const saveProject = useMutation({
    mutationFn: (data: Record<string, unknown>) => project
      ? request<Project>(token, '/admin/records/edit', { body: { operationId: operationId(), projectId: project._id, kind: 'project', id: project._id, version: project.version, data } })
      : request<Project>(token, '/admin/projects', { body: { operationId: operationId(), data } }),
    onMutate: () => onSavingChange?.(true),
    onSuccess: async result => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['admin-projects', nonce] }),
        ...(project ? [queryClient.invalidateQueries({ queryKey: ['catalog-project-record', nonce, project._id] })] : [])
      ]);
      notify(`Projeto “${result.name}” ${project ? 'atualizado' : 'criado'}.`, 'success');
      onSaved(result);
    },
    onSettled: () => onSavingChange?.(false)
  });

  function addArea() {
    const area = areaDraft.trim();
    if (!area) return;
    if (areas.length >= 100) { setAreaError('Você pode adicionar até 100 áreas.'); return; }
    if (area.length > 80 || /[\r\n]/.test(area)) { setAreaError('Use até 80 caracteres em uma única linha.'); return; }
    if (areas.some(value => value.toLocaleLowerCase('pt-BR') === area.toLocaleLowerCase('pt-BR'))) {
      setAreaError('Essa área já foi adicionada.');
      return;
    }
    setAreas(current => [...current, area]);
    setAreaDraft('');
    setAreaError('');
  }

  function renameArea(area: string) {
    const next = editDraft.trim();
    if (!next || next.length > 80 || /[\r\n]/.test(next)) { setAreaError('Use um nome de até 80 caracteres em uma única linha.'); return; }
    if (areas.some(existing => existing !== area && existing.toLocaleLowerCase('pt-BR') === next.toLocaleLowerCase('pt-BR'))) { setAreaError('Essa área já foi adicionada.'); return; }
    setAreas(current => current.map(existing => existing === area ? next : existing));
    setEditingArea(null);
    setEditDraft('');
    setAreaError('');
  }

  function updateRepository(index: number, key: 'name' | 'url' | 'instructions', value: string) {
    setRepositories(current => current.map((repository, position) => position !== index ? repository : {
      ...repository, [key]: value, ...(key === 'url' && repository.url !== value ? { git: undefined } : {})
    }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (editingArea !== null) {
      setAreaError('Salve ou cancele a edição do nome da área antes de salvar o projeto.');
      return;
    }
    if (areaDraft.trim()) {
      setAreaError('Adicione a área digitada ou limpe o campo antes de salvar o projeto.');
      return;
    }
    const uniqueAreas = new Set(areas.map(value => value.toLocaleLowerCase('pt-BR')));
    if (!areas.length || uniqueAreas.size !== areas.length) {
      notify('Informe pelo menos uma área e remova nomes duplicados.', 'error');
      return;
    }
    const data: Record<string, unknown> = {
      name: String(form.get('name') ?? '').trim(),
      description: String(form.get('description') ?? '').trim(),
      instructions: String(form.get('instructions') ?? '').trim(),
      repositories: repositories.map(repository => ({ ...repository, name: repository.name.trim(), url: repository.url.trim(), instructions: (repository.instructions ?? '').trim() })),
      areas,
      visibility
    };
    if (visibility === 'private' && (!project || project.visibility !== 'private')) data.accessToken = String(form.get('accessToken') ?? '');
    saveProject.mutate(data);
  }

  const needsNewAccessToken = visibility === 'private' && (!project || project.visibility !== 'private');
  return <section className={inDialog ? 'min-h-0 overflow-auto px-[23px] pt-5 pb-[22px]' : 'min-w-0 rounded-xl border border-slate-200 bg-white p-[clamp(18px,3vw,32px)] shadow-sm wrap-anywhere'} aria-labelledby={inDialog ? dialogTitleId : 'create-project-title'}>
    {!inDialog && <div className="mb-[11px] flex items-center justify-between gap-3.5"><div><p className="m-0 font-display text-[10px] leading-[normal] font-bold tracking-[.11em] text-[#7180d8]">PROJETO</p><h2 id="create-project-title" className="mb-1 font-display text-[14px] leading-[normal] font-bold tracking-[-.02em] text-[#273245]">Cadastrar projeto</h2></div></div>}
    {!inDialog && <p className="mb-6 text-[12px] leading-[1.5] text-muted-strong">Reúna as informações, os repositórios e as regras de trabalho do seu projeto.</p>}
    {saveProject.isError && <div className={notice.error} role="alert">{project && errorMessage(saveProject.error).includes('Area is still used') ? 'Esta área ainda está em uso por uma ou mais tarefas. Reatribua ou arquive essas tarefas antes de removê-la.' : errorMessage(saveProject.error)}</div>}
    <form className={inDialog ? 'grid gap-6' : 'grid gap-7'} onSubmit={submit}>
      <section className={section} aria-labelledby="project-details-title">
      <div><div><h3 id="project-details-title" className={sectionTitle}>Dados do projeto</h3><p className={sectionHelp}>Defina o objetivo e as orientações para a equipe. Todos os campos são obrigatórios.</p></div></div>
      <div className={formGrid}>
      <label className={label}>Nome do projeto<input className={field} name="name" required maxLength={20000} autoFocus={inDialog} defaultValue={project?.name ?? ''} placeholder="Ex.: Plataforma interna" /></label>
      <label className={label}>Descrição<input className={field} name="description" required maxLength={20000} defaultValue={project?.description ?? ''} placeholder="Resumo do projeto" /></label>
      </div>
      <label className={label}>Instruções<textarea className={field} name="instructions" required maxLength={20000} rows={3} defaultValue={project?.instructions ?? ''} placeholder="Regras de trabalho e contexto do projeto" /></label>
      </section>
      <section className={sectionDivided} aria-labelledby="project-repositories-title">
      <div><div><h3 id="project-repositories-title" className={sectionTitle}>Repositórios <span className={repositoryCountBadge}>{repositories.length}/100</span></h3><p className={sectionHelp}>Adicione um ou mais repositórios, como backend, frontend ou aplicativo.</p></div></div>
      {repositories.map((repository, index) => <div className="min-w-0" key={repository.id}>
      <fieldset className={repositoryFields}>
        <legend className="px-2 text-[12px] font-[650] text-[#435270]">Repositório {index + 1}</legend>
        <div className={formGrid}>
        <label className={label}>Nome<input className={field} value={repository.name} onChange={event => updateRepository(index, 'name', event.target.value)} required maxLength={20000} placeholder="Ex.: backend" /></label>
        <label className={label}>URL<input className={field} value={repository.url} onChange={event => updateRepository(index, 'url', event.target.value)} type="url" required maxLength={2048} placeholder="https://github.com/organizacao/repositorio" /></label>
        </div>
        <label className={label}>Instruções do repositório<textarea className={field} value={repository.instructions ?? ''} onChange={event => updateRepository(index, 'instructions', event.target.value)} required maxLength={20000} rows={2} placeholder="Como executar, testar e trabalhar neste repositório" /></label>
        <div className="flex justify-end"><button type="button" className={removeRepositoryButton} aria-label={`Remover repositório ${index + 1}`} disabled={saveProject.isPending || repositories.length <= 1} onClick={() => setRepositories(current => current.filter(item => item.id !== repository.id))}>Remover repositório</button></div>
      </fieldset>
      </div>)}
      <button type="button" className={addRepositoryButton} disabled={saveProject.isPending || repositories.length >= 100} onClick={() => setRepositories(current => [...current, { id: operationId(), name: '', url: '', instructions: '' }])}>+ Adicionar repositório</button>
      </section>
      <section className={sectionDivided} aria-labelledby="project-access-title">
      <div><div><h3 id="project-access-title" className={sectionTitle}>Organização e acesso</h3><p className={sectionHelp}>Escolha as áreas de trabalho e a visibilidade do projeto.</p></div></div>
      <div className={formGrid}>
      <div className={fieldGroup}>
      <label className={label} htmlFor="project-area-draft">Áreas do projeto</label>
      <div className="grid gap-3.5 rounded-ui-md border border-[#e1e5ed] bg-[#fafbfe] p-3.5">
        <ul className="flex flex-wrap gap-2" aria-label="Áreas adicionadas">
          {areas.map(area => <li key={area} className="inline-flex max-w-full items-center gap-[7px] rounded-[8px] border border-[#dce0fb] bg-[#eef0ff] py-1 pr-1.5 pl-[11px] text-[12px] text-[#4652ac]">{editingArea === area ? <>
            <input className={areaEditField} autoFocus value={editDraft} aria-label={`Renomear área ${area}`} onChange={event => { setEditDraft(event.target.value); setAreaError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); renameArea(area); } else if (event.key === 'Escape') { event.preventDefault(); setEditingArea(null); setEditDraft(''); setAreaError(''); } }} />
            <button type="button" className={areaChipButton} aria-label={`Salvar nome da área ${area}`} disabled={saveProject.isPending} onClick={() => renameArea(area)}>✓</button>
            <button type="button" className={areaChipButton} aria-label={`Cancelar edição da área ${area}`} disabled={saveProject.isPending} onClick={() => { setEditingArea(null); setEditDraft(''); setAreaError(''); }}>×</button>
          </> : <>
            <span className="min-w-0 wrap-anywhere">{area}</span>
            <button type="button" className={areaChipButton} aria-label={`Renomear área ${area}`} title={`Renomear ${area}`} disabled={saveProject.isPending} onClick={() => { setEditingArea(area); setEditDraft(area); setAreaError(''); }}>✎</button>
            <button type="button" className={areaChipButton} aria-label={`Remover área ${area}`} title={areas.length <= 1 ? 'Mantenha pelo menos uma área' : `Remover ${area}`} disabled={saveProject.isPending || areas.length <= 1} onClick={() => { setAreas(current => current.filter(value => value !== area)); setAreaError(''); }}>×</button>
          </>}</li>)}
        </ul>
        <div className="flex items-center gap-2 max-[420px]:flex-col max-[420px]:items-stretch">
          <input className={areaEntryField} id="project-area-draft" value={areaDraft} maxLength={80} placeholder="Ex.: design ou infraestrutura" disabled={saveProject.isPending || areas.length >= 100} aria-invalid={!!areaError} aria-describedby={`project-areas-help${areaError ? ' project-areas-error' : ''}`} onChange={event => { setAreaDraft(event.target.value); setAreaError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addArea(); } }} />
          <button type="button" className={areaAddButton} disabled={saveProject.isPending || areas.length >= 100 || !areaDraft.trim()} onClick={addArea}>+ Adicionar</button>
        </div>
      </div>
      <small id="project-areas-help" className={helpText}>{project ? 'Áreas em uso precisam ser reatribuídas ou arquivadas antes de serem removidas. Mantenha pelo menos uma área.' : 'Digite uma área e pressione Enter ou Adicionar. Mantenha pelo menos uma área.'}</small>
      {areaError && <small id="project-areas-error" className={errorText} role="alert">{areaError}</small>}
      </div><div className={fieldGroup}>
      <fieldset className="min-w-0"><legend className="mb-3 text-[12px] font-semibold text-[#566275]">Visibilidade</legend><div className="grid grid-cols-2 gap-2.5 max-[1000px]:grid-cols-1">
        <label className={`${label} relative cursor-pointer`}><input className={radioInput} type="radio" name="visibility" value="public" checked={visibility === 'public'} onChange={() => setVisibility('public')} />
          <span className={visibilityCard}><svg className="size-[23px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3" /></svg><span className="grid min-w-0 gap-[5px]"><strong className="text-[12px]">Compartilhado</strong><small className="text-[12px] leading-[1.5] font-normal">Acesso compartilhado à equipe</small></span></span>
        </label>
        <label className={`${label} relative cursor-pointer`}><input className={radioInput} type="radio" name="visibility" value="private" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
          <span className={visibilityCard}><svg className="size-[23px] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg><span className="grid min-w-0 gap-[5px]"><strong className="text-[12px]">Privado</strong><small className="text-[12px] leading-[1.5] font-normal">Protegido por token de acesso</small></span></span>
        </label>
      </div></fieldset>
      {needsNewAccessToken && <div className={fieldGroup}>
        <label className={label}>Token de acesso privado<input className={field} name="accessToken" type={showAccessToken ? 'text' : 'password'} value={accessToken} onChange={event => setAccessToken(event.target.value)} minLength={16} maxLength={512} required autoComplete="new-password" spellCheck={false} aria-describedby="project-token-help" /></label>
        <div className="flex items-center gap-2">
          <button type="button" className={secondaryButton} disabled={saveProject.isPending} onClick={() => {
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            setAccessToken(Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''));
            notify(`Novo token gerado. Copie e guarde antes de ${project ? 'salvar' : 'criar'} o projeto.`, 'success');
          }}>{accessToken ? 'Gerar novo token' : 'Gerar token'}</button>
          <button type="button" className={secondaryButton} disabled={!accessToken} aria-pressed={showAccessToken} onClick={() => setShowAccessToken(current => !current)}>{showAccessToken ? 'Ocultar' : 'Mostrar'}</button>
          <button type="button" className={secondaryButton} disabled={!accessToken} onClick={async () => {
            if (await copyToClipboard(accessToken)) notify('Token copiado.', 'success');
            else notify('Não foi possível copiar. Use Mostrar e copie o token manualmente.', 'error');
          }}>Copiar token</button>
        </div>
        <small id="project-token-help" className={helpText}>Gere um token ou informe pelo menos 16 caracteres. Cada geração substitui o valor atual. Guarde o token: o servidor armazena somente o hash.</small>
      </div>}
      </div></div>
      </section>
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-[#e7eaf0] pt-[22px] max-[700px]:flex-col max-[700px]:items-stretch">
      <span className="text-[12px] leading-[1.5] text-muted-strong" role="status">{repositories.length} {repositories.length === 1 ? 'repositório será vinculado ao projeto' : 'repositórios serão vinculados ao projeto'}</span>
      {inDialog && <button type="button" className={cancelButton} disabled={saveProject.isPending} onClick={onCancel}>Cancelar</button>}
      <button className={submitButton} disabled={saveProject.isPending}>{saveProject.isPending ? 'Salvando…' : project ? 'Salvar projeto' : 'Criar projeto'}</button>
      </div>
    </form>
  </section>;
}
