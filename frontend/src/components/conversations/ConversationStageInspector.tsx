import { operationId } from '../../api';
import type { ConversationField, ConversationStage } from './conversation-types';

const labelClass = 'grid min-w-0 gap-1 text-[11px] font-semibold text-[#566275]';
const inputClass = 'min-h-9 w-full min-w-0 rounded-[7px] border border-[#d9deea] bg-white px-2.5 py-2 text-[12px] text-[#344054] focus:border-[#4b4fcb] focus:outline-none';
const buttonClass = 'inline-flex min-h-8 items-center justify-center rounded-[7px] border border-[#d9deea] bg-white px-2.5 text-[11px] font-semibold text-[#566275] transition hover:bg-[#f6f7fa] disabled:cursor-not-allowed disabled:opacity-40';
const stageLabels: Record<ConversationStage['kind'], string> = { instruction: 'Instrução', form: 'Formulário', condition: 'Condição', approval: 'Aprovação' };

function fieldDraft(): ConversationField {
  return { id: operationId(), label: 'Novo campo', helpText: '', type: 'text', required: false, options: [] };
}

export function ConversationStageInspector({ stage, order, stageCount, previousFields, readOnly, onChange, onKindChange, onMove, onRemove }: {
  stage: ConversationStage;
  order: number;
  stageCount: number;
  previousFields: ConversationField[];
  readOnly: boolean;
  onChange: (patch: Partial<ConversationStage>) => void;
  onKindChange: (kind: ConversationStage['kind']) => void;
  onMove: (offset: -1 | 1) => void;
  onRemove: () => void;
}) {
  const changeField = (fieldIndex: number, patch: Partial<ConversationField>) => onChange({ fields: (stage.fields ?? []).map((field, index) => index === fieldIndex ? { ...field, ...patch } : field) });

  return <div className="grid content-start gap-3" aria-label={`Editar etapa ${order}`}>
    <div className="flex items-center justify-between gap-2">
      <div><p className="text-[9px] font-bold uppercase tracking-[.12em] text-[#5261d4]">Etapa selecionada · {order}</p><h3 className="mt-0.5 font-display text-[14px] font-bold text-ink-2">{stageLabels[stage.kind]}</h3></div>
      <div className="flex gap-1"><button type="button" className={buttonClass} aria-label="Mover etapa para cima" title="Mover para cima" disabled={readOnly || order <= 1} onClick={() => onMove(-1)}>↑</button><button type="button" className={buttonClass} aria-label="Mover etapa para baixo" title="Mover para baixo" disabled={readOnly || order >= stageCount} onClick={() => onMove(1)}>↓</button><button type="button" className={`${buttonClass} text-[#a63942]`} aria-label="Remover etapa" disabled={readOnly || stageCount <= 1} onClick={onRemove}>Remover</button></div>
    </div>

    <label className={labelClass}>Título<input className={inputClass} value={stage.title} onChange={event => onChange({ title: event.target.value })} disabled={readOnly} maxLength={120} /></label>
    <label className={labelClass}>Tipo da etapa<select className={inputClass} value={stage.kind} disabled={readOnly} onChange={event => onKindChange(event.target.value as ConversationStage['kind'])}><option value="instruction">Instrução</option><option value="form">Formulário</option><option value="approval">Aprovação</option><option value="condition" disabled={!previousFields.length}>Condição · requer formulário anterior</option></select></label>
    <label className={labelClass}>Orientação<textarea className={`${inputClass} min-h-[60px] resize-y`} value={stage.description} onChange={event => onChange({ description: event.target.value })} disabled={readOnly} maxLength={2000} placeholder="O que a pessoa verá nesta etapa?" /></label>

    {stage.kind === 'instruction' && <label className={labelClass}>Instrução para a IA<textarea className={`${inputClass} min-h-[130px] resize-y`} value={stage.instruction ?? ''} onChange={event => onChange({ instruction: event.target.value })} disabled={readOnly} maxLength={10000} placeholder="Explique o que a IA deve fazer nesta etapa." /></label>}
    {stage.kind === 'approval' && <label className={labelClass}>Texto da autorização<input className={inputClass} value={stage.approvalLabel ?? ''} onChange={event => onChange({ approvalLabel: event.target.value, required: true })} disabled={readOnly} maxLength={120} /><small className="font-normal text-tone-amber">A autorização humana antes da execução continua obrigatória em todos os tipos.</small></label>}

    {stage.kind === 'form' && <section className="grid gap-2 rounded-[9px] border border-[#e5e8ef] bg-[#fbfcfe] p-2.5" aria-label="Campos do formulário">
      <div className="flex items-center justify-between gap-2"><strong className="text-[10.5px] text-ink-2">Campos do formulário</strong><button type="button" className={buttonClass} disabled={readOnly || (stage.fields?.length ?? 0) >= 30} onClick={() => onChange({ fields: [...(stage.fields ?? []), fieldDraft()] })}>+ Campo</button></div>
      {(stage.fields ?? []).map((field, fieldIndex) => <div className="grid gap-1.5 rounded-[7px] border border-[#e5e8ef] bg-white p-2 sm:grid-cols-2" key={field.id}>
        <label className={labelClass}>Rótulo<input className={inputClass} value={field.label} onChange={event => changeField(fieldIndex, { label: event.target.value })} disabled={readOnly} maxLength={120} /></label>
        <label className={labelClass}>Formato<select className={inputClass} value={field.type} disabled={readOnly} onChange={event => changeField(fieldIndex, { type: event.target.value as ConversationField['type'], options: event.target.value === 'select' ? field.options : [] })}><option value="text">Texto</option><option value="textarea">Texto longo</option><option value="number">Número</option><option value="checkbox">Confirmação</option><option value="select">Seleção</option></select></label>
        <label className={`${labelClass} sm:col-span-2`}>Ajuda<textarea className={`${inputClass} min-h-9 resize-y`} value={field.helpText} onChange={event => changeField(fieldIndex, { helpText: event.target.value })} disabled={readOnly} maxLength={1000} placeholder="Texto auxiliar para o preenchimento." /></label>
        {field.type === 'select' && <label className={`${labelClass} sm:col-span-2`}>Opções · uma por linha<textarea className={`${inputClass} min-h-14 resize-y`} value={field.options.join('\n')} onChange={event => changeField(fieldIndex, { options: event.target.value.split('\n').map(value => value.trim()).filter(Boolean) })} disabled={readOnly} placeholder={'Aberto\nEm andamento\nResolvido'} /></label>}
        <label className="flex items-center gap-2 text-[10.5px] text-ink-2 sm:col-span-2"><input type="checkbox" checked={field.required} disabled={readOnly} onChange={event => changeField(fieldIndex, { required: event.target.checked })} />Obrigatório</label>
        <button type="button" className={`${buttonClass} justify-self-start text-[#a63942]`} disabled={readOnly} onClick={() => onChange({ fields: (stage.fields ?? []).filter((_, index) => index !== fieldIndex) })}>Remover campo</button>
      </div>)}
    </section>}

    {stage.kind === 'condition' && <section className="grid gap-2 rounded-[9px] border border-[#f0d9a8] bg-[#fffaf0] p-2.5 sm:grid-cols-2" aria-label="Regra da etapa sequencial">
      <p className="text-[10px] leading-[1.45] text-[#7d6741] sm:col-span-2">A condição é avaliada nesta posição da sequência. Ela não cria caminhos separados.</p>
      <label className={labelClass}>Campo anterior<select className={inputClass} value={stage.condition?.fieldId ?? ''} disabled={readOnly || !previousFields.length} onChange={event => onChange({ condition: { ...stage.condition!, fieldId: event.target.value } })}><option value="">Escolha um campo</option>{previousFields.map(field => <option key={field.id} value={field.id}>{field.label}</option>)}</select></label>
      <label className={labelClass}>Regra<select className={inputClass} value={stage.condition?.operator ?? 'is_set'} disabled={readOnly} onChange={event => onChange({ condition: { ...stage.condition!, operator: event.target.value as NonNullable<ConversationStage['condition']>['operator'], ...(event.target.value === 'is_set' || event.target.value === 'is_not_set' ? {} : { value: stage.condition?.value ?? '' }) } })}><option value="is_set">Está preenchido</option><option value="is_not_set">Está vazio</option><option value="equals">É igual a</option><option value="not_equals">É diferente de</option><option value="contains">Contém</option></select></label>
      {stage.condition && !['is_set', 'is_not_set'].includes(stage.condition.operator) && <label className={`${labelClass} sm:col-span-2`}>Valor<input className={inputClass} value={stage.condition.value ?? ''} onChange={event => onChange({ condition: { ...stage.condition!, value: event.target.value } })} disabled={readOnly} maxLength={1000} /></label>}
    </section>}

    {stage.kind !== 'approval' && <label className="flex items-center gap-2 text-[10.5px] text-ink-2"><input type="checkbox" checked={stage.required} disabled={readOnly} onChange={event => onChange({ required: event.target.checked })} />Etapa obrigatória</label>}
  </div>;
}
