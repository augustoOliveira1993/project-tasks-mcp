import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, operationId } from '../../api';
import { errorMessage } from '../../lib/format';
import { buttonBase, buttonSecondarySmall, notice as noticeTone } from '../ui/classes';
import { archiveConversationType, createConversationType, duplicateConversationType, listConversationTypes, updateConversationType } from './conversation-actions';
import { ConversationFlowCanvas } from './ConversationFlowCanvas';
import { ConversationStageInspector } from './ConversationStageInspector';
import type { ConversationField, ConversationStage, ConversationType } from './conversation-types';

type TypeDraft = { name: string; description: string; stages: ConversationStage[] };
const pane = 'min-w-0 rounded-[13px] border border-[#e1e5ed] bg-white p-4';
const labelClass = 'grid min-w-0 gap-1 text-[11px] font-semibold text-[#566275]';
const inputClass = 'min-h-9 w-full min-w-0 rounded-[7px] border border-[#d9deea] bg-white px-2.5 py-2 text-[12px] text-[#344054] focus:border-[#4b4fcb] focus:outline-none';
const smallButton = `${buttonBase} min-h-8 px-2.5 text-[11px]`;
const secondaryButton = `${buttonSecondarySmall} min-h-8 px-2.5 text-[11px]`;

function fieldDraft(): ConversationField {
  return { id: operationId(), label: 'Novo campo', helpText: '', type: 'text', required: false, options: [] };
}

function stageDraft(kind: ConversationStage['kind'], priorFields: ConversationField[] = []): ConversationStage {
  const common = { id: operationId(), title: kind === 'approval' ? 'Autorização' : 'Nova etapa', description: '', kind, required: kind === 'approval' } as const;
  if (kind === 'instruction') return { ...common, kind, instruction: '' };
  if (kind === 'form') return { ...common, kind, fields: [fieldDraft()] };
  if (kind === 'approval') return { ...common, kind, approvalLabel: 'Autorizar proposta' };
  return { ...common, kind, required: false, condition: { fieldId: priorFields[0]?.id ?? '', operator: 'is_set' } };
}

function blankDraft(): TypeDraft {
  return { name: '', description: '', stages: [stageDraft('instruction')] };
}

function isBlankDraft(draft: TypeDraft) {
  return !draft.name.trim() && !draft.description.trim() && draft.stages.length === 1
    && draft.stages[0].kind === 'instruction' && draft.stages[0].title === 'Nova etapa' && !draft.stages[0].description.trim() && !draft.stages[0].instruction?.trim();
}

function draftFromType(type: ConversationType): TypeDraft {
  return { name: type.name, description: type.description ?? '', stages: type.stages.map(stage => ({
    ...stage,
    ...(stage.fields ? { fields: stage.fields.map(field => ({ ...field, options: [...(field.options ?? [])] })) } : {}),
    ...(stage.condition ? { condition: { ...stage.condition } } : {})
  })) };
}

export function validateConversationTypeDraft(draft: TypeDraft): string[] {
  const errors: string[] = [];
  if (!draft.name.trim()) errors.push('Informe o nome do tipo.');
  if (draft.stages.length === 0) errors.push('Adicione pelo menos uma etapa.');
  if (draft.stages.length > 30) errors.push('O fluxo aceita no máximo 30 etapas.');
  const stageIds = new Set<string>();
  const fieldIds = new Set<string>();
  draft.stages.forEach((stage, index) => {
    const number = index + 1;
    if (!stage.title.trim()) errors.push(`Defina o título da etapa ${number}.`);
    if (stageIds.has(stage.id)) errors.push(`A etapa ${number} repete o identificador de outra etapa.`);
    stageIds.add(stage.id);
    if (stage.kind === 'instruction' && !stage.instruction?.trim()) errors.push(`Escreva a orientação da etapa ${number}.`);
    if (stage.kind === 'form') {
      if (!stage.fields?.length) errors.push(`Adicione ao menos um campo à etapa ${number}.`);
      for (const field of stage.fields ?? []) {
        if (!field.label.trim()) errors.push(`Dê um rótulo a todos os campos da etapa ${number}.`);
        if (fieldIds.has(field.id)) errors.push('Os identificadores dos campos precisam ser únicos.');
        fieldIds.add(field.id);
        const options = field.options.map(option => option.trim()).filter(Boolean);
        if (field.type === 'select' && options.length === 0) errors.push(`Adicione opções ao seletor “${field.label || `etapa ${number}`}”.`);
        if (new Set(options.map(option => option.toLocaleLowerCase('pt-BR'))).size !== options.length) errors.push(`Remova as opções repetidas de “${field.label}”.`);
        if (field.type !== 'select' && options.length) errors.push(`Opções só são usadas em campos de seleção (“${field.label}”).`);
      }
    }
    if (stage.kind === 'approval' && (!stage.required || !stage.approvalLabel?.trim())) errors.push(`A etapa de aprovação ${number} precisa de um rótulo e é sempre obrigatória.`);
    if (stage.kind === 'condition') {
      if (!stage.condition || !fieldIds.has(stage.condition.fieldId)) errors.push(`A condição da etapa ${number} deve usar um campo de formulário anterior.`);
      if (stage.condition && ['equals', 'not_equals', 'contains'].includes(stage.condition.operator) && stage.condition.value === undefined) errors.push(`Informe o valor da condição na etapa ${number}.`);
    }
  });
  return [...new Set(errors)];
}

export function ConversationTypesManager({ token, nonce, projectId, onClose }: { token: string; nonce: string; projectId: string; onClose: () => void }) {
  const client = useQueryClient();
  const queryKey = ['conversation-types', nonce, projectId];
  const types = useQuery({
    queryKey,
    enabled: Boolean(token && nonce && projectId),
    queryFn: () => listConversationTypes<ConversationType[]>(token, projectId),
    refetchOnWindowFocus: true
  });
  const items = types.data?.items ?? [];
  const [selectedId, setSelectedId] = useState('');
  const [selectedStageId, setSelectedStageId] = useState('');
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<TypeDraft>(blankDraft);
  const [duplicateName, setDuplicateName] = useState('');
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const selected = items.find(item => item._id === selectedId) ?? null;
  const immutable = Boolean(!creating && (selected?.isDefault || selected?.archived));
  const errors = useMemo(() => validateConversationTypeDraft(draft), [draft]);
  const selectedStageIndex = Math.max(0, draft.stages.findIndex(stage => stage.id === selectedStageId));
  const selectedStage = draft.stages[selectedStageIndex] ?? null;
  const priorFields = (stageIndex: number) => draft.stages.slice(0, stageIndex).flatMap(stage => stage.kind === 'form' ? stage.fields ?? [] : []);

  useEffect(() => {
    if (!selectedId && !creating && items.length) {
      const initial = items.find(item => item.isDefault) ?? items.find(item => !item.archived) ?? items[0];
      setSelectedId(initial._id);
      setDraft(draftFromType(initial));
      setSelectedStageId(initial.stages[0]?.id ?? '');
    }
  }, [items, selectedId, creating]);

  useEffect(() => {
    if (!draft.stages.some(stage => stage.id === selectedStageId)) setSelectedStageId(draft.stages[0]?.id ?? '');
  }, [draft.stages, selectedStageId]);

  function chooseType(type: ConversationType) {
    const dirty = creating ? !isBlankDraft(draft) : Boolean(selected && JSON.stringify(draft) !== JSON.stringify(draftFromType(selected)));
    if (dirty && !window.confirm('Descartar as alterações ainda não salvas?')) return;
    setCreating(false);
    setSelectedId(type._id);
    setDraft(draftFromType(type));
    setSelectedStageId(type.stages[0]?.id ?? '');
    setDuplicateName('');
    setConfirmArchive(false);
    setNotice(null);
  }

  function startNewType() {
    if ((creating && !isBlankDraft(draft)) || (!creating && selected && JSON.stringify(draft) !== JSON.stringify(draftFromType(selected)))) {
      if (!window.confirm('Descartar as alterações ainda não salvas?')) return;
    }
    setCreating(true);
    setSelectedId('');
    setDraft(blankDraft());
    setSelectedStageId('');
    setDuplicateName('');
    setConfirmArchive(false);
    setNotice(null);
  }

  function replaceStage(index: number, patch: Partial<ConversationStage>) {
    setDraft(current => ({ ...current, stages: current.stages.map((stage, stageIndex) => stageIndex === index ? { ...stage, ...patch } as ConversationStage : stage) }));
  }

  function changeStageKind(index: number, kind: ConversationStage['kind']) {
    const fields = priorFields(index);
    setDraft(current => ({ ...current, stages: current.stages.map((stage, stageIndex) => stageIndex === index ? { ...stageDraft(kind, fields), id: stage.id, title: stage.title, description: stage.description } : stage) }));
  }

  function addStage(kind: ConversationStage['kind']) {
    if (draft.stages.length >= 30 || (kind === 'condition' && !priorFields(draft.stages.length).length)) return;
    const stage = stageDraft(kind, priorFields(draft.stages.length));
    setDraft(current => ({ ...current, stages: [...current.stages, stage] }));
    setSelectedStageId(stage.id);
  }

  function moveStage(index: number, offset: -1 | 1) {
    const target = index + offset;
    if (target < 0 || target >= draft.stages.length) return;
    setDraft(current => {
      const stages = [...current.stages];
      [stages[index], stages[target]] = [stages[target], stages[index]];
      return { ...current, stages };
    });
  }

  function moveSelectedStage(offset: -1 | 1) {
    if (selectedStageIndex + offset < 0 || selectedStageIndex + offset >= draft.stages.length) return;
    moveStage(selectedStageIndex, offset);
  }

  function removeSelectedStage() {
    if (!selectedStage || draft.stages.length <= 1) return;
    const index = selectedStageIndex;
    const nextStage = draft.stages[index + 1] ?? draft.stages[index - 1];
    setDraft(current => ({ ...current, stages: current.stages.filter(stage => stage.id !== selectedStage.id) }));
    setSelectedStageId(nextStage?.id ?? '');
  }

  function reorderStages(stageIds: string[]) {
    setDraft(current => {
      const stageById = new Map(current.stages.map(stage => [stage.id, stage]));
      const reordered = stageIds.map(id => stageById.get(id)).filter((stage): stage is ConversationStage => Boolean(stage));
      return { ...current, stages: reordered.length === current.stages.length ? reordered : current.stages };
    });
  }

  const save = useMutation({
    mutationFn: () => creating
      ? createConversationType<ConversationType>(token, projectId, draft)
      : selected ? updateConversationType<ConversationType>(token, projectId, selected._id, selected.version, draft) : Promise.reject(new Error('Selecione um tipo de conversa.')),
    onSuccess: async type => {
      client.setQueryData<{ items: ConversationType[] }>(queryKey, current => ({ items: [...(current?.items ?? []).filter(item => item._id !== type._id), type].sort((a, b) => Number(a.archived) - Number(b.archived) || a.name.localeCompare(b.name, 'pt-BR')) }));
      setCreating(false);
      setSelectedId(type._id);
      setDraft(draftFromType(type));
      setSelectedStageId(type.stages[0]?.id ?? '');
      setNotice({ kind: 'success', text: 'Fluxo salvo.' });
      await client.invalidateQueries({ queryKey });
    },
    onError: error => setNotice({ kind: 'error', text: error instanceof ApiRequestError && error.status === 409
      ? creating ? 'Este nome já está em uso. Suas alterações continuam no formulário; escolha outro nome para tentar de novo.' : 'Conflito de versão ou nome: suas alterações continuam no formulário. Recarregue a versão salva para comparar.'
      : errorMessage(error) })
  });
  const duplicate = useMutation({
    mutationFn: () => selected ? duplicateConversationType<ConversationType>(token, projectId, selected._id, selected.version, duplicateName.trim()) : Promise.reject(new Error('Selecione um tipo ativo.')),
    onSuccess: async type => {
      client.setQueryData<{ items: ConversationType[] }>(queryKey, current => ({ items: [...(current?.items ?? []).filter(item => item._id !== type._id), type] }));
      setSelectedId(type._id);
      setDraft(draftFromType(type));
      setSelectedStageId(type.stages[0]?.id ?? '');
      setDuplicateName('');
      setNotice({ kind: 'success', text: 'Tipo duplicado. Edite a cópia e salve as alterações.' });
      await client.invalidateQueries({ queryKey });
    },
    onError: error => setNotice({ kind: 'error', text: error instanceof ApiRequestError && error.status === 409 ? 'A versão de origem mudou. Suas alterações continuam no formulário; atualize a lista para tentar de novo.' : errorMessage(error) })
  });
  const archive = useMutation({
    mutationFn: () => selected ? archiveConversationType<ConversationType>(token, projectId, selected._id, selected.version) : Promise.reject(new Error('Selecione um tipo ativo.')),
    onSuccess: async type => {
      client.setQueryData<{ items: ConversationType[] }>(queryKey, current => ({ items: (current?.items ?? []).map(item => item._id === type._id ? type : item) }));
      setConfirmArchive(false);
      setSelectedId(type._id);
      setDraft(draftFromType(type));
      setSelectedStageId(type.stages[0]?.id ?? '');
      setNotice({ kind: 'success', text: 'Tipo arquivado. Conversas vinculadas mantêm o fluxo salvo.' });
      await client.invalidateQueries({ queryKey });
    },
    onError: error => setNotice({ kind: 'error', text: error instanceof ApiRequestError && error.status === 409 ? 'Este tipo mudou em outra sessão. Suas alterações continuam no formulário; recarregue a versão salva para comparar.' : errorMessage(error) })
  });

  function reloadSavedType() {
    void types.refetch().then(result => {
      const fresh = result.data?.items.find(item => item._id === selectedId);
      if (fresh) { setDraft(draftFromType(fresh)); setSelectedStageId(fresh.stages[0]?.id ?? ''); setNotice({ kind: 'success', text: 'Versão salva carregada no editor.' }); }
    });
  }

  return <section className="flex min-h-[min(820px,calc(100vh-150px))] min-w-0 flex-col overflow-hidden rounded-[14px] border border-[#dfe3ec] bg-[#f7f8fb]" aria-label="Configurar tipos de conversa">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[#e5e8ef] bg-white px-5 py-4">
      <div><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[#5261d4]">Cadastros · Tipos de conversa</p><h2 className="mt-1 font-display text-[19px] font-bold text-ink">Editor de fluxos</h2><p className="mt-1 text-[12px] text-muted-strong">Monte as etapas em sequência e selecione um nó para configurar seus detalhes.</p></div>
      <button type="button" className={secondaryButton} onClick={onClose}>← Voltar às conversas</button>
    </header>

    <div className="grid min-h-0 flex-1 gap-3 overflow-y-auto p-3.5 xl:grid-cols-[220px_minmax(0,1fr)_330px] xl:items-start xl:overflow-hidden xl:p-4">
      <aside className={`${pane} grid content-start gap-2 xl:max-h-[calc(100vh-235px)] xl:overflow-y-auto`} aria-label="Tipos cadastrados">
        <div className="flex items-center justify-between gap-2"><h3 className="font-display text-[13px] font-bold text-ink-2">Tipos cadastrados</h3><span className="text-[10px] text-muted-strong">{items.filter(item => !item.archived).length} ativos</span></div>
        <button type="button" className={smallButton + ' justify-center border-transparent bg-accent text-white hover:bg-accent-dark'} onClick={startNewType}>+ Novo tipo</button>
        {types.isPending ? <p className="py-5 text-center text-[11px] text-muted-strong">Carregando tipos…</p> : types.isError ? <div className={noticeTone.error} role="alert">{errorMessage(types.error)} <button type="button" className="underline" onClick={() => void types.refetch()}>Tentar novamente</button></div> : <ul className="grid gap-1.5">{items.map(type => <li key={type._id}><button type="button" aria-current={selectedId === type._id ? 'true' : undefined} className="grid w-full gap-1 rounded-[8px] border border-[#e4e7ef] bg-[#fbfcfe] px-2.5 py-2 text-left aria-current:border-[#aeb5f7] aria-current:bg-[#f1f2ff]" onClick={() => chooseType(type)}><span className="flex items-center justify-between gap-2"><strong className="min-w-0 text-[11.5px] text-ink-2 wrap-anywhere">{type.name}</strong><span className="shrink-0 text-[9px] text-muted-strong">{type.archived ? 'Arquivado' : type.isDefault ? 'Padrão' : `v${type.version}`}</span></span><small className="text-[10px] text-muted-strong">{type.stages.length} {type.stages.length === 1 ? 'etapa' : 'etapas'}</small></button></li>)}</ul>}
        <p className="border-t border-[#eef0f4] pt-2 text-[10px] leading-[1.45] text-muted-strong">Tipos arquivados continuam visíveis em conversas existentes e não são oferecidos para novas conversas.</p>
      </aside>

      <main className="grid min-w-0 content-start gap-3 xl:max-h-[calc(100vh-235px)] xl:overflow-y-auto" aria-label="Montagem do fluxo">
        <section className={`${pane} grid gap-3`}>
          <div className="flex flex-wrap items-start justify-between gap-2"><div><p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#5261d4]">{creating ? 'Novo fluxo' : selected ? `Fluxo · versão ${selected.version}` : 'Fluxo'}</p><h3 className="mt-0.5 font-display text-[14px] font-bold text-ink-2">{creating ? 'Defina o tipo de conversa' : selected?.name ?? 'Escolha um tipo de conversa'}</h3></div>
            {selected && !selected.isDefault && !selected.archived && <div className="flex flex-wrap gap-1.5"><button type="button" className={secondaryButton} onClick={() => { setDuplicateName(`${selected.name} (cópia)`); setNotice(null); }}>Duplicar</button><button type="button" className={secondaryButton + ' border-[#f1d0d2] text-[#a63942] hover:bg-[#fff6f6]'} onClick={() => setConfirmArchive(true)}>Arquivar</button></div>}
          </div>
          {!creating && !selected && !types.isPending && <p className="rounded-[8px] bg-[#f6f7fa] p-3 text-[11px] text-muted-strong">Escolha um tipo à esquerda ou crie um novo.</p>}
          {(creating || selected) && <div className="grid gap-2 sm:grid-cols-2">
            <label className={labelClass}>Nome do tipo<input className={inputClass} maxLength={120} value={draft.name} onChange={event => setDraft(current => ({ ...current, name: event.target.value }))} disabled={immutable} placeholder="Ex.: Ajuste de tarefa" /></label>
            <label className={labelClass}>Orientação geral<input className={inputClass} maxLength={2000} value={draft.description} onChange={event => setDraft(current => ({ ...current, description: event.target.value }))} disabled={immutable} placeholder="Para que serve este fluxo?" /></label>
          </div>}
          {selected?.isDefault && <p className="rounded-[8px] border border-[#dbe1f6] bg-[#f5f6ff] p-2.5 text-[10.5px] leading-[1.45] text-[#59637a]">O tipo Geral é mantido pelo sistema para conversas antigas e não pode ser editado.</p>}
          {selected?.archived && <p className="rounded-[8px] border border-[#e4e7ef] bg-[#f6f7fa] p-2.5 text-[10.5px] text-muted-strong">Tipo arquivado. O fluxo existente pode ser consultado, mas não alterado.</p>}
        </section>

        {(creating || selected) && <section className={`${pane} grid min-w-0 gap-3`} aria-label="Etapas do fluxo">
          <div className="flex flex-wrap items-center justify-between gap-2"><div><h3 className="font-display text-[13px] font-bold text-ink-2">Sequência de etapas</h3><p className="mt-0.5 text-[10px] text-muted-strong">Arraste os nós para reordenar; as conexões seguem a ordem atual.</p></div><span className="text-[10px] font-semibold text-muted-strong">{draft.stages.length} / 30</span></div>
          <div className="flex flex-wrap gap-1.5" aria-label="Adicionar etapa">
            {([{ kind: 'instruction', label: '+ Instrução' }, { kind: 'form', label: '+ Formulário' }, { kind: 'condition', label: '+ Condição' }, { kind: 'approval', label: '+ Aprovação' }] as const).map(item => <button key={item.kind} type="button" className={secondaryButton} disabled={immutable || draft.stages.length >= 30 || item.kind === 'condition' && !priorFields(draft.stages.length).length} title={item.kind === 'condition' && !priorFields(draft.stages.length).length ? 'Adicione primeiro uma etapa de formulário.' : undefined} onClick={() => addStage(item.kind)}>{item.label}</button>)}
          </div>
          <ConversationFlowCanvas key={draft.stages.map(stage => stage.id).join('|')} stages={draft.stages} selectedStageId={selectedStage?.id ?? ''} disabled={immutable} onSelectStage={setSelectedStageId} onReorder={reorderStages} />
          <div className="flex flex-wrap items-start gap-2 rounded-[9px] border border-[#f0d9a8] bg-[#fffaf0] px-3 py-2.5"><span className="mt-px text-[12px] text-[#9a6b12]">◆</span><p className="min-w-0 flex-1 text-[10px] leading-[1.5] text-[#7d6741]"><strong>Autorização protegida.</strong> Toda execução continua exigindo autorização explícita. Condições são avaliadas como etapas sequenciais e não criam ramificações.</p></div>
        </section>}

        {duplicateName !== '' && selected && !selected.archived && !selected.isDefault && <form className="grid gap-2 rounded-[9px] border border-[#dfe3ec] bg-white p-3 sm:grid-cols-[1fr_auto] sm:items-end" onSubmit={event => { event.preventDefault(); if (duplicateName.trim()) duplicate.mutate(); }}><label className={labelClass}>Nome da cópia<input className={inputClass} value={duplicateName} onChange={event => setDuplicateName(event.target.value)} maxLength={120} /></label><div className="flex gap-1.5"><button type="submit" className={smallButton} disabled={!duplicateName.trim() || duplicate.isPending}>{duplicate.isPending ? 'Duplicando…' : 'Duplicar tipo'}</button><button type="button" className={secondaryButton} onClick={() => setDuplicateName('')}>Cancelar</button></div>{duplicate.isError && <p className={`${noticeTone.error} sm:col-span-2`} role="alert">{notice?.text ?? errorMessage(duplicate.error)}</p>}</form>}
        {confirmArchive && selected && <div className="grid gap-2 rounded-[9px] border border-[#f1d0d2] bg-[#fff8f8] p-3 text-[10.5px] text-[#7b3439]" role="alert"><strong>Arquivar “{selected.name}”?</strong><span>O tipo deixa de aparecer em conversas novas; as conversas abertas guardam o fluxo existente.</span><div className="flex gap-1.5"><button type="button" className={smallButton + ' border-transparent bg-[#aa3f48] text-white'} disabled={archive.isPending} onClick={() => archive.mutate()}>{archive.isPending ? 'Arquivando…' : 'Confirmar arquivamento'}</button><button type="button" className={secondaryButton} onClick={() => setConfirmArchive(false)}>Cancelar</button></div>{archive.isError && <p className="text-[#a63942]" role="alert">{notice?.text ?? errorMessage(archive.error)}</p>}</div>}
      </main>

      <aside className={`${pane} grid content-start gap-3 xl:max-h-[calc(100vh-235px)] xl:overflow-y-auto`} aria-label="Configuração da etapa selecionada">
        {selectedStage ? <>
          <ConversationStageInspector stage={selectedStage} order={selectedStageIndex + 1} stageCount={draft.stages.length} previousFields={priorFields(selectedStageIndex)} readOnly={immutable} onChange={patch => replaceStage(selectedStageIndex, patch)} onKindChange={kind => changeStageKind(selectedStageIndex, kind)} onMove={moveSelectedStage} onRemove={removeSelectedStage} />
          {!immutable && <div className="grid gap-2 border-t border-[#eef0f4] pt-3">
            {errors.length > 0 && <div className="rounded-[8px] border border-[#f4d6a6] bg-[#fffaf0] p-2.5 text-[10.5px] text-[#865d12]" role="status"><strong>Revise o fluxo antes de salvar</strong><ul className="mt-1 list-disc pl-4">{errors.slice(0, 5).map(error => <li key={error}>{error}</li>)}</ul></div>}
            {notice && <div className={notice.kind === 'error' ? noticeTone.error : noticeTone.info} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}{notice.kind === 'error' && !creating && notice.text.toLocaleLowerCase('pt-BR').includes('conflito') && <button type="button" className="ml-2 underline" onClick={reloadSavedType}>Carregar versão salva</button>}</div>}
            <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-[10px] text-muted-strong">{draft.stages.length} de 30 etapas</span><button type="button" className={smallButton + ' border-transparent bg-accent text-white hover:bg-accent-dark'} disabled={errors.length > 0 || save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Salvando…' : creating ? 'Criar tipo' : 'Salvar fluxo'}</button></div>
          </div>}
          {immutable && notice && <div className={notice.kind === 'error' ? noticeTone.error : noticeTone.info} role={notice.kind === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
        </> : <div className="grid min-h-36 place-items-center rounded-lg bg-[#f6f7fa] p-4 text-center text-[11px] leading-[1.5] text-muted-strong">Escolha um tipo e selecione uma etapa no canvas para editar seus detalhes.</div>}
        <div className="grid gap-1 rounded-[8px] border border-[#e4e8f0] bg-[#f8f9fc] p-2.5"><strong className="text-[10px] text-ink-2">Prévia do tipo</strong><p className="text-[10px] font-semibold text-[#43516a]">{draft.name.trim() || 'Nome do tipo'}</p><p className="text-[9.5px] leading-[1.45] text-muted-strong">{draft.description.trim() || 'A descrição aparecerá no catálogo de tipos.'}</p></div>
      </aside>
    </div>
  </section>;
}
