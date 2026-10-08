import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  applyNodeChanges,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeChange,
  type NodeProps
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ConversationStage } from './conversation-types';

type FlowStageNode = Node<{ stage: ConversationStage; order: number }, 'flowStage'>;

const stageLabels: Record<ConversationStage['kind'], string> = {
  instruction: 'Instrução', form: 'Formulário', condition: 'Condição', approval: 'Aprovação'
};

const stageTones: Record<ConversationStage['kind'], { accent: string; surface: string; icon: string }> = {
  instruction: { accent: '#6366f1', surface: '#eef2ff', icon: '✦' },
  form: { accent: '#0e9f8a', surface: '#e8faf6', icon: '▤' },
  condition: { accent: '#db8a16', surface: '#fff6e5', icon: '◇' },
  approval: { accent: '#8a55c7', surface: '#f5edff', icon: '✓' }
};

function FlowStageCard({ data, selected }: NodeProps<FlowStageNode>) {
  const stage = data.stage;
  const tone = stageTones[stage.kind];
  const detail = stage.kind === 'form'
    ? `${stage.fields?.length ?? 0} ${(stage.fields?.length ?? 0) === 1 ? 'campo' : 'campos'}`
    : stage.kind === 'approval'
      ? stage.approvalLabel || 'Aguardar autorização'
      : stage.kind === 'condition'
        ? `${stage.condition?.operator.replaceAll('_', ' ') ?? 'definir condição'}`
        : stage.instruction || stage.description || 'Adicionar orientação para a IA';

  return <article className={'w-[248px] overflow-hidden rounded-xl border bg-white shadow-[0_5px_16px_#24334d12] transition ' + (selected ? 'border-[#625cf4] ring-2 ring-[#625cf4]/20' : 'border-[#dfe3ec] hover:border-[#b8c0d4]')}>
    <Handle type="target" position={Position.Left} isConnectable={false} className="!size-2.5 !border-2 !border-white !bg-[#a8b1c4]" />
    <header className="flex items-center gap-2.5 px-3 py-2.5" style={{ borderBottom: '1px solid #edf0f5' }}>
      <span className="grid size-8 shrink-0 place-items-center rounded-lg text-[14px] font-bold" style={{ background: tone.surface, color: tone.accent }}>{tone.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[9px] font-bold uppercase tracking-[.1em]" style={{ color: tone.accent }}>{stageLabels[stage.kind]}</span>
        <strong className="mt-0.5 block truncate text-[12px] text-[#29354a]">{stage.title.trim() || `Etapa ${data.order}`}</strong>
      </span>
      <span className="grid size-6 shrink-0 place-items-center rounded-full border border-[#e2e6ee] bg-[#fafbfe] text-[10px] font-bold text-[#748094]">{data.order}</span>
    </header>
    <p className="line-clamp-2 min-h-9 px-3 py-2 text-[10px] leading-[1.45] text-[#758095]">{detail}</p>
    <footer className="flex items-center justify-between border-t border-[#eff1f5] px-3 py-1.5 text-[9px] text-[#8791a2]">
      <span>{stage.required ? 'Obrigatória' : 'Opcional'}</span>
      {stage.kind === 'condition' && <span className="rounded-full bg-[#fff6e5] px-2 py-0.5 font-semibold text-[#9b5d00]">Regra</span>}
    </footer>
    <Handle type="source" position={Position.Right} isConnectable={false} className="!size-2.5 !border-2 !border-white !bg-[#a8b1c4]" />
  </article>;
}

const nodeTypes = { flowStage: FlowStageCard };

export function ConversationFlowCanvas({ stages, selectedStageId, disabled = false, onSelectStage, onReorder }: {
  stages: ConversationStage[];
  selectedStageId: string;
  disabled?: boolean;
  onSelectStage: (stageId: string) => void;
  onReorder: (stageIds: string[]) => void;
}) {
  const [nodes, setNodes] = useState<FlowStageNode[]>(() => stages.map((stage, index) => ({
    id: stage.id,
    type: 'flowStage',
    position: { x: 90 + index * 330, y: 110 },
    data: { stage, order: index + 1 },
    selected: stage.id === selectedStageId,
    draggable: !disabled,
    selectable: true,
    sourcePosition: Position.Right,
    targetPosition: Position.Left
  })));

  useEffect(() => {
    setNodes(current => {
      const positions = new Map(current.map(node => [node.id, node.position]));
      return stages.map((stage, index) => ({
        id: stage.id,
        type: 'flowStage',
        position: positions.get(stage.id) ?? { x: 90 + index * 330, y: 110 },
        data: { stage, order: index + 1 },
        selected: stage.id === selectedStageId,
        draggable: !disabled,
        selectable: true,
        sourcePosition: Position.Right,
        targetPosition: Position.Left
      }));
    });
  }, [stages, selectedStageId, disabled]);

  const edges = useMemo<Edge[]>(() => stages.slice(0, -1).map((stage, index) => ({
    id: `${stage.id}->${stages[index + 1].id}`,
    source: stage.id,
    target: stages[index + 1].id,
    type: 'smoothstep',
    markerEnd: { type: MarkerType.ArrowClosed, color: '#9aa5b7' },
    style: { stroke: '#aeb8c9', strokeWidth: 1.8 }
  })), [stages]);

  const onNodesChange = useCallback((changes: NodeChange<FlowStageNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current) as FlowStageNode[]);
  }, []);

  function finishReorder() {
    const ordered = [...nodes].sort((a, b) => a.position.x - b.position.x || a.data.order - b.data.order);
    const stageIds = ordered.map(node => node.id);
    if (stageIds.some((id, index) => id !== stages[index]?.id)) onReorder(stageIds);
    setNodes(ordered.map((node, index) => ({ ...node, position: { x: 90 + index * 330, y: 110 } })));
  }

  return <div className="relative h-[min(590px,calc(100vh-350px))] min-h-[390px] overflow-hidden rounded-xl border border-[#dfe4ed] bg-[#f8f9fc]" aria-label="Canvas do fluxo sequencial">
    <ReactFlow<FlowStageNode, Edge>
      nodes={nodes}
      edges={edges}
      nodeTypes={nodeTypes}
      onNodesChange={onNodesChange}
      onNodeClick={(_, node) => onSelectStage(node.id)}
      onNodeDragStop={finishReorder}
      nodesConnectable={false}
      nodesDraggable={!disabled}
      elementsSelectable
      fitView
      fitViewOptions={{ padding: 0.22, minZoom: 0.2, maxZoom: 1 }}
      minZoom={0.2}
      maxZoom={1.5}
      proOptions={{ hideAttribution: false }}
      className="conversation-flow-canvas"
    >
      <Background variant={BackgroundVariant.Dots} gap={19} size={1} color="#d7deea" />
      <Controls position="bottom-left" showInteractive={false} aria-label="Controles do fluxo" />
      <MiniMap position="bottom-right" nodeColor={node => stageTones[(node.data as FlowStageNode['data']).stage.kind].accent} nodeStrokeWidth={3} pannable zoomable ariaLabel="Visão geral do fluxo" />
    </ReactFlow>
    {!stages.length && <div className="pointer-events-none absolute inset-0 grid place-items-center text-center text-[12px] text-[#718096]">Adicione uma etapa para começar o fluxo.</div>}
  </div>;
}
