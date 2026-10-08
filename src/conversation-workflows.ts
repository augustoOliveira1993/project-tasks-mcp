export const DEFAULT_CONVERSATION_TYPE_ID = '00000000-0000-4000-8000-000000000001';

export function defaultConversationType(projectId: string) {
  return {
    _id: DEFAULT_CONVERSATION_TYPE_ID, projectId, version: 0, archived: false, isDefault: true,
    name: 'Geral', description: 'Fluxo padrão para conversas existentes e conversas sem tipo especializado.',
    stages: [
      { id: '00000000-0000-4000-8000-000000000011', title: 'Esclarecer', description: 'Entender objetivo, restrições e dúvidas.', kind: 'instruction', required: false, instruction: 'Esclareça o pedido e reúna o contexto necessário.' },
      { id: '00000000-0000-4000-8000-000000000012', title: 'Proposta', description: 'Preparar uma proposta de trabalho.', kind: 'instruction', required: false, instruction: 'Apresente a proposta e os critérios para revisão.' },
      { id: '00000000-0000-4000-8000-000000000013', title: 'Autorização', description: 'Aguardar autorização humana antes de executar.', kind: 'approval', required: true, approvalLabel: 'Autorizar execução' },
      { id: '00000000-0000-4000-8000-000000000014', title: 'Execução', description: 'Acompanhar a execução autorizada.', kind: 'instruction', required: false, instruction: 'Execute somente após a autorização explícita.' }
    ],
    createdAt: null, updatedAt: null
  };
}

export function conversationTypeDto(item: any) {
  return {
    _id: item._id, projectId: item.projectId, name: item.name, description: item.description ?? '',
    version: item.version ?? 0, archived: item.archived ?? false, isDefault: item.isDefault ?? false,
    stages: item.stages ?? [], createdAt: item.createdAt ?? null, updatedAt: item.updatedAt ?? null
  };
}
