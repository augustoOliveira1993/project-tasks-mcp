import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { operationId, request } from '../../api';
import type { Project } from '../../api';
import { copyToClipboard } from '../../lib/clipboard';
import { errorMessage } from '../../lib/format';

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
  return <section className={inDialog ? 'project-create-dialog-body' : 'panel-card catalog-create-card project-create-card'} aria-labelledby={inDialog ? dialogTitleId : 'create-project-title'}>
    {!inDialog && <div className="section-heading"><div><p className="eyebrow">PROJETO</p><h2 id="create-project-title">Cadastrar projeto</h2></div></div>}
    {!inDialog && <p className="muted-text">Reúna as informações, os repositórios e as regras de trabalho do seu projeto.</p>}
    {saveProject.isError && <div className="notice error" role="alert">{project && errorMessage(saveProject.error).includes('Area is still used') ? 'Esta área ainda está em uso por uma ou mais tarefas. Reatribua ou arquive essas tarefas antes de removê-la.' : errorMessage(saveProject.error)}</div>}
    <form className="stack-form catalog-project-form" onSubmit={submit}>
      <section className="project-form-section" aria-labelledby="project-details-title">
      <div className="project-section-heading"><div><h3 id="project-details-title">Dados do projeto</h3><p>Defina o objetivo e as orientações para a equipe. Todos os campos são obrigatórios.</p></div></div>
      <div className="project-form-grid">
      <label>Nome do projeto<input name="name" required maxLength={20000} autoFocus={inDialog} defaultValue={project?.name ?? ''} placeholder="Ex.: Plataforma interna" /></label>
      <label>Descrição<input name="description" required maxLength={20000} defaultValue={project?.description ?? ''} placeholder="Resumo do projeto" /></label>
      </div>
      <label>Instruções<textarea name="instructions" required maxLength={20000} rows={3} defaultValue={project?.instructions ?? ''} placeholder="Regras de trabalho e contexto do projeto" /></label>
      </section>
      <section className="project-form-section" aria-labelledby="project-repositories-title">
      <div className="project-section-heading"><div><h3 id="project-repositories-title">Repositórios <span className="project-repository-count">{repositories.length}/100</span></h3><p>Adicione um ou mais repositórios, como backend, frontend ou aplicativo.</p></div></div>
      {repositories.map((repository, index) => <div className="project-repository-card" key={repository.id}>
      <fieldset className="catalog-repository-fields">
        <legend>Repositório {index + 1}</legend>
        <div className="project-form-grid">
        <label>Nome<input value={repository.name} onChange={event => updateRepository(index, 'name', event.target.value)} required maxLength={20000} placeholder="Ex.: backend" /></label>
        <label>URL<input value={repository.url} onChange={event => updateRepository(index, 'url', event.target.value)} type="url" required maxLength={2048} placeholder="https://github.com/organizacao/repositorio" /></label>
        </div>
        <label>Instruções do repositório<textarea value={repository.instructions ?? ''} onChange={event => updateRepository(index, 'instructions', event.target.value)} required maxLength={20000} rows={2} placeholder="Como executar, testar e trabalhar neste repositório" /></label>
        <div className="project-repository-actions"><button type="button" className="text-button danger-text" aria-label={`Remover repositório ${index + 1}`} disabled={saveProject.isPending || repositories.length <= 1} onClick={() => setRepositories(current => current.filter(item => item.id !== repository.id))}>Remover repositório</button></div>
      </fieldset>
      </div>)}
      <button type="button" className="button secondary project-add-repository" disabled={saveProject.isPending || repositories.length >= 100} onClick={() => setRepositories(current => [...current, { id: operationId(), name: '', url: '', instructions: '' }])}>+ Adicionar repositório</button>
      </section>
      <section className="project-form-section" aria-labelledby="project-access-title">
      <div className="project-section-heading"><div><h3 id="project-access-title">Organização e acesso</h3><p>Escolha as áreas de trabalho e a visibilidade do projeto.</p></div></div>
      <div className="project-form-grid">
      <div className="project-field-group">
      <label htmlFor="project-area-draft">Áreas do projeto</label>
      <div className="project-area-editor">
        <ul className="project-area-badges" aria-label="Áreas adicionadas">
          {areas.map(area => <li key={area} className="project-area-badge">{editingArea === area ? <>
            <input className="project-area-edit-input" autoFocus value={editDraft} aria-label={`Renomear área ${area}`} onChange={event => { setEditDraft(event.target.value); setAreaError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); renameArea(area); } else if (event.key === 'Escape') { event.preventDefault(); setEditingArea(null); setEditDraft(''); setAreaError(''); } }} />
            <button type="button" aria-label={`Salvar nome da área ${area}`} disabled={saveProject.isPending} onClick={() => renameArea(area)}>✓</button>
            <button type="button" aria-label={`Cancelar edição da área ${area}`} disabled={saveProject.isPending} onClick={() => { setEditingArea(null); setEditDraft(''); setAreaError(''); }}>×</button>
          </> : <>
            <span>{area}</span>
            <button type="button" aria-label={`Renomear área ${area}`} title={`Renomear ${area}`} disabled={saveProject.isPending} onClick={() => { setEditingArea(area); setEditDraft(area); setAreaError(''); }}>✎</button>
            <button type="button" aria-label={`Remover área ${area}`} title={areas.length <= 1 ? 'Mantenha pelo menos uma área' : `Remover ${area}`} disabled={saveProject.isPending || areas.length <= 1} onClick={() => { setAreas(current => current.filter(value => value !== area)); setAreaError(''); }}>×</button>
          </>}</li>)}
        </ul>
        <div className="project-area-entry">
          <input id="project-area-draft" value={areaDraft} maxLength={80} placeholder="Ex.: design ou infraestrutura" disabled={saveProject.isPending || areas.length >= 100} aria-invalid={!!areaError} aria-describedby={`project-areas-help${areaError ? ' project-areas-error' : ''}`} onChange={event => { setAreaDraft(event.target.value); setAreaError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addArea(); } }} />
          <button type="button" className="button secondary" disabled={saveProject.isPending || areas.length >= 100 || !areaDraft.trim()} onClick={addArea}>+ Adicionar</button>
        </div>
      </div>
      <small id="project-areas-help" className="muted-text">{project ? 'Áreas em uso precisam ser reatribuídas ou arquivadas antes de serem removidas. Mantenha pelo menos uma área.' : 'Digite uma área e pressione Enter ou Adicionar. Mantenha pelo menos uma área.'}</small>
      {areaError && <small id="project-areas-error" className="danger-text" role="alert">{areaError}</small>}
      </div><div className="project-field-group">
      <fieldset className="project-visibility"><legend>Visibilidade</legend><div className="project-visibility-options">
        <label className="project-visibility-option"><input type="radio" name="visibility" value="public" checked={visibility === 'public'} onChange={() => setVisibility('public')} />
          <span className="project-visibility-card"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 3a5 5 0 0 1 3 4v3" /></svg><span><strong>Compartilhado</strong><small>Acesso compartilhado à equipe</small></span></span>
        </label>
        <label className="project-visibility-option"><input type="radio" name="visibility" value="private" checked={visibility === 'private'} onChange={() => setVisibility('private')} />
          <span className="project-visibility-card"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><rect x="4" y="10" width="16" height="11" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" /></svg><span><strong>Privado</strong><small>Protegido por token de acesso</small></span></span>
        </label>
      </div></fieldset>
      {needsNewAccessToken && <div className="project-field-group">
        <label>Token de acesso privado<input name="accessToken" type={showAccessToken ? 'text' : 'password'} value={accessToken} onChange={event => setAccessToken(event.target.value)} minLength={16} maxLength={512} required autoComplete="new-password" spellCheck={false} aria-describedby="project-token-help" /></label>
        <div className="button-row">
          <button type="button" className="button secondary" disabled={saveProject.isPending} onClick={() => {
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            setAccessToken(Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''));
            notify(`Novo token gerado. Copie e guarde antes de ${project ? 'salvar' : 'criar'} o projeto.`, 'success');
          }}>{accessToken ? 'Gerar novo token' : 'Gerar token'}</button>
          <button type="button" className="button secondary" disabled={!accessToken} aria-pressed={showAccessToken} onClick={() => setShowAccessToken(current => !current)}>{showAccessToken ? 'Ocultar' : 'Mostrar'}</button>
          <button type="button" className="button secondary" disabled={!accessToken} onClick={async () => {
            if (await copyToClipboard(accessToken)) notify('Token copiado.', 'success');
            else notify('Não foi possível copiar. Use Mostrar e copie o token manualmente.', 'error');
          }}>Copiar token</button>
        </div>
        <small id="project-token-help" className="muted-text">Gere um token ou informe pelo menos 16 caracteres. Cada geração substitui o valor atual. Guarde o token: o servidor armazena somente o hash.</small>
      </div>}
      </div></div>
      </section>
      <div className="project-form-footer">
      <span className="muted-text" role="status">{repositories.length} {repositories.length === 1 ? 'repositório será vinculado ao projeto' : 'repositórios serão vinculados ao projeto'}</span>
      {inDialog && <button type="button" className="button secondary" disabled={saveProject.isPending} onClick={onCancel}>Cancelar</button>}
      <button className="button primary" disabled={saveProject.isPending}>{saveProject.isPending ? 'Salvando…' : project ? 'Salvar projeto' : 'Criar projeto'}</button>
      </div>
    </form>
  </section>;
}
