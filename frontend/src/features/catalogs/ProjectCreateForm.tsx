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
  const createProject = useMutation({
    mutationFn: (data: Record<string, unknown>) => request<Project>(token, '/admin/projects', { body: { operationId: operationId(), data } }),
    onSuccess: async project => {
      await queryClient.invalidateQueries({ queryKey: ['admin-projects', nonce] });
      notify(`Projeto “${project.name}” criado.`, 'success');
      onCreated(project);
    }
  });

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const areas = String(form.get('areas') ?? '').split(/[\n,]/).map(value => value.trim()).filter(Boolean);
    const uniqueAreas = new Set(areas.map(value => value.toLocaleLowerCase('pt-BR')));
    if (!areas.length || uniqueAreas.size !== areas.length) {
      notify('Informe pelo menos uma área e remova nomes duplicados.', 'error');
      return;
    }
    createProject.mutate({
      name: String(form.get('name') ?? '').trim(),
      description: String(form.get('description') ?? '').trim(),
      instructions: String(form.get('instructions') ?? '').trim(),
      repositories: [{
        id: operationId(),
        name: String(form.get('repositoryName') ?? '').trim(),
        url: String(form.get('repositoryUrl') ?? '').trim(),
        instructions: String(form.get('repositoryInstructions') ?? '').trim()
      }],
      areas,
      visibility,
      ...(visibility === 'private' ? { accessToken: String(form.get('accessToken') ?? '') } : {})
    });
  }

  return <section className="panel-card catalog-create-card" aria-labelledby="create-project-title">
    <div className="section-heading"><div><p className="eyebrow">PROJETO</p><h2 id="create-project-title">Cadastrar projeto</h2></div></div>
    <p className="muted-text">Cadastre o workspace e seu primeiro repositório para começar.</p>
    {createProject.isError && <div className="notice error" role="alert">{errorMessage(createProject.error)}</div>}
    <form className="stack-form catalog-project-form" onSubmit={submit}>
      <label>Nome do projeto<input name="name" required maxLength={20000} placeholder="Ex.: Plataforma interna" /></label>
      <label>Descrição<input name="description" required maxLength={20000} placeholder="Resumo do projeto" /></label>
      <label>Instruções<textarea name="instructions" required maxLength={20000} rows={3} placeholder="Regras de trabalho e contexto do projeto" /></label>
      <fieldset className="catalog-repository-fields">
        <legend>Primeiro repositório</legend>
        <label>Nome<input name="repositoryName" required maxLength={20000} placeholder="Ex.: backend" /></label>
        <label>URL<input name="repositoryUrl" type="url" required maxLength={2048} placeholder="https://github.com/organizacao/repositorio" /></label>
        <label>Instruções do repositório<textarea name="repositoryInstructions" required maxLength={20000} rows={2} placeholder="Instruções para trabalhar neste repositório" /></label>
      </fieldset>
      <label>Áreas iniciais<textarea name="areas" required rows={2} defaultValue="backend\nfrontend\noutro" aria-describedby="project-areas-help" /></label>
      <small id="project-areas-help" className="muted-text">Separe as áreas por linha ou vírgula.</small>
      <label>Visibilidade<select name="visibility" value={visibility} onChange={event => setVisibility(event.target.value as 'public' | 'private')}><option value="public">Compartilhado</option><option value="private">Privado</option></select></label>
      {visibility === 'private' && <label>Token de acesso privado<input name="accessToken" type="password" minLength={16} maxLength={512} required autoComplete="new-password" /><small className="muted-text">Use pelo menos 16 caracteres. O servidor guarda somente o hash.</small></label>}
      <button className="button primary" disabled={createProject.isPending}>{createProject.isPending ? 'Salvando…' : 'Criar projeto'}</button>
    </form>
  </section>;
}
