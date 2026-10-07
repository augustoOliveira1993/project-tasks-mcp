import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { operationId, request } from '../../api';
import type { Project } from '../../api';
import { errorMessage } from '../../lib/format';
import { buttonSecondary, textButton } from '../ui/classes';

const sectionEmbedded = 'grid min-w-0 gap-[18px] [section+&]:border-t [section+&]:border-t-[#e7eaf0] [section+&]:pt-6';
const sectionStandalone = 'col-span-full min-w-0 rounded-xl border border-slate-200 bg-white p-[17px] shadow-sm max-[760px]:col-auto max-[760px]:p-3';
const eyebrowInHeading = 'font-display text-[10px] leading-[normal] font-bold tracking-[.11em] text-[#7180d8]';
const addInput = 'min-h-9 w-full rounded-[7px] border border-[#e1e5ed] bg-white px-2.5 py-[9px] text-[11px] text-[#344054]';
const editInput = 'min-h-8 w-[min(100%,260px)] rounded-[7px] border border-[#e1e5ed] px-2 py-1.5 text-[10px] text-[#344054] focus:border-[#929ef2]';
const th = 'border-y border-y-[#edf0f5] bg-[#f8f9fc] px-2.5 py-[9px] text-[8px] font-bold tracking-[.04em] whitespace-nowrap text-[#8792a2] uppercase';
const td = 'border-b border-b-[#edf0f5] p-2.5 align-middle text-[9px] text-[#596576]';
const rowAction = `${textButton} whitespace-nowrap`;
const rowDanger = 'px-0 py-1 text-[11px] font-semibold whitespace-nowrap text-tone-red enabled:hover:bg-tone-red-bg';

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
  return <section className={embedded ? sectionEmbedded : sectionStandalone} aria-labelledby={titleId}>
    {embedded ? <div><div><h3 id={titleId} className="m-0 flex flex-wrap items-center gap-2.5 text-[14px] font-[650] text-[#253858]">Áreas do projeto</h3><p className="mt-1.5 text-[12px] leading-[1.6] text-[#68778d]">As áreas aparecem no contexto da IA e nos formulários de tarefa. Uma área em uso precisa ser reatribuída ou arquivada antes de ser removida.</p></div></div> : <>
      <div className="mb-3 flex items-start justify-between gap-3.5"><div><p className={eyebrowInHeading}>ÁREAS DO PROJETO</p><h2 id={titleId} className="mb-1 font-display text-[14px] leading-[normal] font-bold tracking-[-.02em] text-[#273245]">Gerenciar áreas</h2></div></div>
      <p className="mb-[13px] text-[10px] leading-[1.6] text-muted-strong">As áreas cadastradas aparecem na pergunta de contexto da IA e nos formulários de tarefa. Uma área em uso precisa ser reatribuída ou arquivada antes de ser removida.</p>
    </>}
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2.5 max-[760px]:grid-cols-[1fr]" role="group" aria-label="Adicionar área">
      <label className="grid gap-1.5 text-[10px] font-semibold text-[#566275]" htmlFor={`new-project-area-${project._id}`}>Nova área<input className={addInput} id={`new-project-area-${project._id}`} value={areaDraft} onChange={event => setAreaDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); addArea(); } }} maxLength={80} placeholder="Ex.: dados, operações" /></label>
      <button type="button" className={buttonSecondary} disabled={areaMutation.isPending || areas.length >= 100 || !areaDraft.trim()} onClick={addArea}>{areaMutation.isPending ? 'Salvando…' : 'Adicionar área'}</button>
    </div>
    <div className={embedded ? 'overflow-x-auto max-[760px]:overflow-visible' : 'overflow-x-auto'}><table className="w-full min-w-[700px] border-collapse text-left"><thead><tr><th className={`${th} text-left`}>Área</th><th className={`${th} w-[220px] text-right`}>Ações</th></tr></thead><tbody>
      {areas.map(area => <tr key={area} className="hover:bg-[#fbfcff]"><td className={td}>{editingArea === area ? <input className={editInput} value={editDraft} onChange={event => setEditDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); saveRename(area); } }} maxLength={80} aria-label={`Nome da área ${area}`} /> : <strong className="text-[10px] text-[#3e4a5e]">{area === 'backend' ? 'Backend' : area === 'frontend' ? 'Frontend' : area === 'outro' ? 'Outro' : area}</strong>}</td><td className={`${td} w-[220px] text-right whitespace-nowrap`}><div className="flex min-w-0 flex-nowrap items-center justify-end gap-2">{editingArea === area ? <><button type="button" className={rowAction} disabled={areaMutation.isPending} onClick={() => saveRename(area)}>{areaMutation.isPending ? 'Salvando…' : 'Salvar'}</button><button type="button" className={rowAction} disabled={areaMutation.isPending} onClick={() => { setEditingArea(null); setEditDraft(''); }}>Cancelar</button></> : <><button type="button" className={rowAction} disabled={areaMutation.isPending} onClick={() => { setEditingArea(area); setEditDraft(area); }}>Editar</button><button type="button" className={rowDanger} disabled={areaMutation.isPending || areas.length <= 1} onClick={() => removeArea(area)} aria-label={`Remover área ${area}`}>Remover</button></>}</div></td></tr>)}
    </tbody></table></div>
  </section>;
}
