import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { operationId, request } from '../../api';
import type { Project } from '../../api';
import { errorMessage } from '../../lib/format';

export function ProjectCreateForm({ token, nonce, onCreated, notify }: {
  token: string;
  nonce: string;
  onCreated: (project: Project) => void;
  notify: (message: string, kind?: string) => void;
}) {
  const queryClient = useQueryClient();
  const [visibility, setVisibility] = useState<'public' | 'private'>('public');
  const [repositoryIds, setRepositoryIds] = useState(() => [operationId()]);
  const [areas, setAreas] = useState(['backend', 'frontend', 'outro']);
  const [areaDraft, setAreaDraft] = useState('');
  const [areaError, setAreaError] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [showAccessToken, setShowAccessToken] = useState(false);
  const createProject = useMutation({
    mutationFn: (data: Record<string, unknown>) => request<Project>(token, '/admin/projects', { body: { operationId: operationId(), data } }),
    onSuccess: async project => {
      await queryClient.invalidateQueries({ queryKey: ['admin-projects', nonce] });
      notify(`Projeto “${project.name}” criado.`, 'success');
      onCreated(project);
    }
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

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (areaDraft.trim()) {
      setAreaError('Adicione a área digitada ou limpe o campo antes de criar o projeto.');
      return;
    }
    const uniqueAreas = new Set(areas.map(value => value.toLocaleLowerCase('pt-BR')));
    if (!areas.length || uniqueAreas.size !== areas.length) {
      notify('Informe pelo menos uma área e remova nomes duplicados.', 'error');
      return;
    }
    createProject.mutate({
      name: String(form.get('name') ?? '').trim(),
      description: String(form.get('description') ?? '').trim(),
      instructions: String(form.get('instructions') ?? '').trim(),
      repositories: repositoryIds.map(id => ({
        id,
        name: String(form.get(`repositoryName-${id}`) ?? '').trim(),
        url: String(form.get(`repositoryUrl-${id}`) ?? '').trim(),
        instructions: String(form.get(`repositoryInstructions-${id}`) ?? '').trim()
      })),
      areas,
      visibility,
      ...(visibility === 'private' ? { accessToken: String(form.get('accessToken') ?? '') } : {})
    });
  }

  return <section className="panel-card catalog-create-card project-create-card" aria-labelledby="create-project-title">
    <div className="section-heading"><div><p className="eyebrow">PROJETO</p><h2 id="create-project-title">Cadastrar projeto</h2></div></div>
    <p className="muted-text">Reúna as informações, os repositórios e as regras de trabalho do seu projeto.</p>
    {createProject.isError && <div className="notice error" role="alert">{errorMessage(createProject.error)}</div>}
    <form className="stack-form catalog-project-form" onSubmit={submit}>
      <section className="project-form-section" aria-labelledby="project-details-title">
      <div className="project-section-heading"><div><h3 id="project-details-title">Dados do projeto</h3><p>Defina o objetivo e as orientações para a equipe. Todos os campos são obrigatórios.</p></div></div>
      <div className="project-form-grid">
      <label>Nome do projeto<input name="name" required maxLength={20000} placeholder="Ex.: Plataforma interna" /></label>
      <label>Descrição<input name="description" required maxLength={20000} placeholder="Resumo do projeto" /></label>
      </div>
      <label>Instruções<textarea name="instructions" required maxLength={20000} rows={3} placeholder="Regras de trabalho e contexto do projeto" /></label>
      </section>
      <section className="project-form-section" aria-labelledby="project-repositories-title">
      <div className="project-section-heading"><div><h3 id="project-repositories-title">Repositórios <span className="project-repository-count">{repositoryIds.length}/100</span></h3><p>Adicione um ou mais repositórios, como backend, frontend ou aplicativo.</p></div></div>
      {repositoryIds.map((id, index) => <div className="project-repository-card" key={id}>
      <fieldset className="catalog-repository-fields">
        <legend>Repositório {index + 1}</legend>
        <div className="project-form-grid">
        <label>Nome<input name={`repositoryName-${id}`} required maxLength={20000} placeholder="Ex.: backend" /></label>
        <label>URL<input name={`repositoryUrl-${id}`} type="url" required maxLength={2048} placeholder="https://github.com/organizacao/repositorio" /></label>
        </div>
        <label>Instruções do repositório<textarea name={`repositoryInstructions-${id}`} required maxLength={20000} rows={2} placeholder="Como executar, testar e trabalhar neste repositório" /></label>
        <div className="project-repository-actions"><button type="button" className="text-button danger-text" aria-label={`Remover repositório ${index + 1}`} disabled={createProject.isPending || repositoryIds.length <= 1} onClick={() => setRepositoryIds(current => current.filter(item => item !== id))}>Remover repositório</button></div>
      </fieldset>
      </div>)}
      <button type="button" className="button secondary project-add-repository" disabled={createProject.isPending || repositoryIds.length >= 100} onClick={() => setRepositoryIds(current => [...current, operationId()])}>+ Adicionar repositório</button>
      </section>
      <section className="project-form-section" aria-labelledby="project-access-title">
      <div className="project-section-heading"><div><h3 id="project-access-title">Organização e acesso</h3><p>Escolha as áreas de trabalho e a visibilidade do projeto.</p></div></div>
      <div className="project-form-grid">
      <div className="project-field-group">
      <label htmlFor="project-area-draft">Áreas iniciais</label>
      <div className="project-area-editor">
        <ul className="project-area-badges" aria-label="Áreas adicionadas">
          {areas.map(area => <li key={area} className="project-area-badge"><span>{area}</span><button type="button" aria-label={`Remover área ${area}`} title={areas.length <= 1 ? 'Mantenha pelo menos uma área' : `Remover ${area}`} disabled={createProject.isPending || areas.length <= 1} onClick={() => { setAreas(current => current.filter(value => value !== area)); setAreaError(''); }}>×</button></li>)}
        </ul>
        <div className="project-area-entry">
          <input id="project-area-draft" value={areaDraft} maxLength={80} placeholder="Ex.: design ou infraestrutura" disabled={createProject.isPending || areas.length >= 100} aria-invalid={!!areaError} aria-describedby={`project-areas-help${areaError ? ' project-areas-error' : ''}`} onChange={event => { setAreaDraft(event.target.value); setAreaError(''); }} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addArea(); } }} />
          <button type="button" className="button secondary" disabled={createProject.isPending || areas.length >= 100 || !areaDraft.trim()} onClick={addArea}>+ Adicionar</button>
        </div>
      </div>
      <small id="project-areas-help" className="muted-text">Digite uma área e pressione Enter ou Adicionar. Mantenha pelo menos uma área.</small>
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
      {visibility === 'private' && <div className="project-field-group">
        <label>Token de acesso privado<input name="accessToken" type={showAccessToken ? 'text' : 'password'} value={accessToken} onChange={event => setAccessToken(event.target.value)} minLength={16} maxLength={512} required autoComplete="new-password" spellCheck={false} aria-describedby="project-token-help" /></label>
        <div className="button-row">
          <button type="button" className="button secondary" disabled={createProject.isPending} onClick={() => {
            const bytes = crypto.getRandomValues(new Uint8Array(32));
            setAccessToken(Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join(''));
            notify('Novo token gerado. Copie e guarde antes de criar o projeto.', 'success');
          }}>{accessToken ? 'Gerar novo token' : 'Gerar token'}</button>
          <button type="button" className="button secondary" disabled={!accessToken} aria-pressed={showAccessToken} onClick={() => setShowAccessToken(current => !current)}>{showAccessToken ? 'Ocultar' : 'Mostrar'}</button>
          <button type="button" className="button secondary" disabled={!accessToken} onClick={async () => {
            try { await navigator.clipboard.writeText(accessToken); notify('Token copiado.', 'success'); }
            catch { notify('Não foi possível copiar. Use Mostrar e copie o token manualmente.', 'error'); }
          }}>Copiar token</button>
        </div>
        <small id="project-token-help" className="muted-text">Gere um token ou informe pelo menos 16 caracteres. Cada geração substitui o valor atual. Guarde o token: o servidor armazena somente o hash.</small>
      </div>}
      </div></div>
      </section>
      <div className="project-form-footer">
      <span className="muted-text" role="status">{repositoryIds.length} {repositoryIds.length === 1 ? 'repositório será vinculado ao projeto' : 'repositórios serão vinculados ao projeto'}</span>
      <button className="button primary" disabled={createProject.isPending}>{createProject.isPending ? 'Salvando…' : 'Criar projeto'}</button>
      </div>
    </form>
  </section>;
}
