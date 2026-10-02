import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { operationId, request } from '../../api';
import type { Project } from '../../api';
import { errorMessage } from '../../lib/format';

export function ProjectAreasManager({ token, project, onChanged, notify, embedded = false }: {
  token: string;
  project: Project;
  onChanged: () => void;
  notify: (message: string, kind?: string) => void;
  embedded?: boolean;
}) {
  const [areas, setAreas] = useState<string[]>(project.areas?.length ? project.areas : ['backend', 'frontend', 'outro']);
  const [areasVersion, setAreasVersion] = useState(project.version);
  const [areaDraft, setAreaDraft] = useState('');
  const [editingArea, setEditingArea] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState('');
  const areaMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) => request<{ version: number; areas: string[] }>(token, '/admin', { body })
  });

  useEffect(() => {
    setAreas(project.areas?.length ? project.areas : ['backend', 'frontend', 'outro']);
    setAreasVersion(project.version);
    setEditingArea(null);
    setEditDraft('');
  }, [project._id, project.version, project.areas]);

  async function saveAreas(nextAreas: string[]) {
    try {
      const updated = await areaMutation.mutateAsync({ action: 'project_areas', operationId: operationId(), projectId: project._id, version: areasVersion, areas: nextAreas });
      setAreas(updated.areas);
      setAreasVersion(updated.version);
      setAreaDraft('');
      setEditingArea(null);
      setEditDraft('');
      notify('Áreas do projeto atualizadas.', 'success');
      onChanged();
    } catch (error) {
      const message = errorMessage(error);
      notify(message.includes('Area is still used') ? 'Esta área ainda está em uso por uma ou mais tarefas. Reatribua ou arquive essas tarefas antes de removê-la.' : message, 'error');
    }
  }

  function addArea() {
    const area = areaDraft.trim();
    if (!area) return;
    if (areas.some(existing => existing.toLocaleLowerCase('pt-BR') === area.toLocaleLowerCase('pt-BR'))) {
      notify('Essa área já está cadastrada.', 'error');
      return;
    }
    if (areas.length >= 100) {
      notify('O projeto já atingiu o limite de 100 áreas.', 'error');
      return;
    }
    void saveAreas([...areas, area]);
  }

  function removeArea(area: string) {
    if (areas.length <= 1) return notify('O projeto precisa manter pelo menos uma área.', 'error');
    if (!window.confirm(`Remover a área “${area}” deste projeto?`)) return;
    void saveAreas(areas.filter(item => item !== area));
  }

  function saveRename(area: string) {
    const next = editDraft.trim();
    if (!next) return notify('Informe um nome para a área.', 'error');
    if (areas.some(existing => existing !== area && existing.toLocaleLowerCase('pt-BR') === next.toLocaleLowerCase('pt-BR'))) return notify('Essa área já está cadastrada.', 'error');
    if (next.toLocaleLowerCase('pt-BR') === area.toLocaleLowerCase('pt-BR')) { setEditingArea(null); return; }
    void saveAreas(areas.map(existing => existing === area ? next : existing));
  }

  const titleId = `project-areas-title-${project._id}`;
  return <section className={embedded ? 'project-form-section project-areas-manager' : 'panel-card catalog-table-card wide-card'} aria-labelledby={titleId}>
    {embedded ? <div className="project-section-heading"><div><h3 id={titleId}>Áreas do projeto</h3><p>As áreas aparecem no contexto da IA e nos formulários de tarefa. Uma área em uso precisa ser reatribuída ou arquivada antes de ser removida.</p></div></div> : <>
      <div className="section-heading"><div><p className="eyebrow">ÁREAS DO PROJETO</p><h2 id={titleId}>Gerenciar áreas</h2></div></div>
      <p className="muted-text">As áreas cadastradas aparecem na pergunta de contexto da IA e nos formulários de tarefa. Uma área em uso precisa ser reatribuída ou arquivada antes de ser removida.</p>
    </>}
    <div className="area-add-form" role="group" aria-label="Adicionar área">
      <label htmlFor={`new-project-area-${project._id}`}>Nova área<input id={`new-project-area-${project._id}`} value={areaDraft} onChange={event => setAreaDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addArea(); } }} maxLength={80} placeholder="Ex.: dados, operações" /></label>
      <button type="button" className="button secondary" disabled={areaMutation.isPending || areas.length >= 100 || !areaDraft.trim()} onClick={addArea}>{areaMutation.isPending ? 'Salvando…' : 'Adicionar área'}</button>
    </div>
    <div className="table-scroll"><table className="catalog-table area-catalog-table"><thead><tr><th>Área</th><th>Ações</th></tr></thead><tbody>
      {areas.map(area => <tr key={area}><td>{editingArea === area ? <input className="area-edit-input" value={editDraft} onChange={event => setEditDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); saveRename(area); } }} maxLength={80} aria-label={`Nome da área ${area}`} /> : <strong>{area === 'backend' ? 'Backend' : area === 'frontend' ? 'Frontend' : area === 'outro' ? 'Outro' : area}</strong>}</td><td><div className="catalog-row-actions">{editingArea === area ? <><button type="button" className="text-button" disabled={areaMutation.isPending} onClick={() => saveRename(area)}>{areaMutation.isPending ? 'Salvando…' : 'Salvar'}</button><button type="button" className="text-button" disabled={areaMutation.isPending} onClick={() => { setEditingArea(null); setEditDraft(''); }}>Cancelar</button></> : <><button type="button" className="text-button" disabled={areaMutation.isPending} onClick={() => { setEditingArea(area); setEditDraft(area); }}>Editar</button><button type="button" className="text-button danger-text" disabled={areaMutation.isPending || areas.length <= 1} onClick={() => removeArea(area)} aria-label={`Remover área ${area}`}>Remover</button></>}</div></td></tr>)}
    </tbody></table></div>
  </section>;
}
