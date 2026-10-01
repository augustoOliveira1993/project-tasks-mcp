export type ToolDoc = readonly [group: string, name: string, description: string, mode: 'Leitura' | 'Gravação'];

export const toolDocs: readonly ToolDoc[] = [
  ['Contexto e consulta', 'get_session_context', 'Mostra o projeto e a área configurados para a conversa.', 'Leitura'],
  ['Contexto e consulta', 'list_records', 'Lista projetos, funcionalidades ou tarefas; permite filtrar por status, área, responsável e outros campos.', 'Leitura'],
  ['Contexto e consulta', 'list_pending', 'Lista tarefas abertas disponíveis para planejamento ou execução.', 'Leitura'],
  ['Contexto e consulta', 'get_record', 'Busca um projeto, funcionalidade ou tarefa específica pelo ID.', 'Leitura'],
  ['Contexto e consulta', 'get_task_context', 'Busca um contexto de tarefa tipado e limitado; documentos e conteúdo extenso são consultados sob demanda.', 'Leitura'],
  ['Contexto e consulta', 'get_history', 'Consulta o histórico de alterações de um projeto ou registro.', 'Leitura'],
  ['Contexto e consulta', 'get_summary', 'Resume tarefas e andamento do projeto ou de uma funcionalidade.', 'Leitura'],
  ['Contexto e consulta', 'get_project_area_summary', 'Resume quantidade e andamento das tarefas por área do projeto.', 'Leitura'],
  ['Contexto e consulta', 'get_project_sync_report', 'Resume status, atividade Git, perguntas abertas e tasks não lidas; aceita filtro por feature.', 'Leitura'],
  ['Contexto e consulta', 'get_task_markdown_summary', 'Gera um resumo Markdown do contexto de uma tarefa.', 'Leitura'],
  ['Contexto e consulta', 'get_project_novelties', 'Lista eventos recentes de outros participantes do projeto.', 'Leitura'],
  ['Contexto e consulta', 'get_automation_status', 'Consulta execuções, liberações e estado da automação do projeto.', 'Leitura'],
  ['Projetos e tarefas', 'create_project', 'Cria um projeto e registra seus repositórios e regras de trabalho.', 'Gravação'],
  ['Projetos e tarefas', 'create_feature', 'Cria uma funcionalidade com objetivo, contexto e critérios de aceite.', 'Gravação'],
  ['Projetos e tarefas', 'create_task', 'Registra uma tarefa com área, repositório, prioridade e dependências.', 'Gravação'],
  ['Projetos e tarefas', 'edit_record', 'Atualiza campos de um projeto, funcionalidade ou tarefa; exige a versão atual.', 'Gravação'],
  ['Projetos e tarefas', 'archive_record', 'Arquiva um projeto, funcionalidade ou tarefa sem apagar seu histórico.', 'Gravação'],
  ['Execução de tarefas', 'claim_task', 'Assume uma tarefa e inicia uma execução de agente.', 'Gravação'],
  ['Execução de tarefas', 'heartbeat_task', 'Renova a atividade e a reserva da execução em andamento.', 'Gravação'],
  ['Execução de tarefas', 'record_progress', 'Registra uma atualização de progresso na execução atual.', 'Gravação'],
  ['Execução de tarefas', 'block_task', 'Marca a execução como bloqueada e registra o motivo.', 'Gravação'],
  ['Execução de tarefas', 'submit_task', 'Envia o resultado concluído para revisão com arquivos, verificações e evidências.', 'Gravação'],
  ['Execução de tarefas', 'set_task_status', 'Altera o status em transições administrativas permitidas, usando versão e motivo.', 'Gravação'],
  ['Documentos Markdown', 'save_markdown', 'Cria um documento Markdown associado a uma tarefa ou funcionalidade.', 'Gravação'],
  ['Documentos Markdown', 'update_markdown', 'Atualiza um documento Markdown se a revisão-base ainda for a atual.', 'Gravação'],
  ['Documentos Markdown', 'list_markdowns', 'Lista documentos Markdown ligados a uma tarefa ou funcionalidade.', 'Leitura'],
  ['Documentos Markdown', 'get_markdown', 'Lê um documento Markdown ou parte dele.', 'Leitura'],
  ['Documentos Markdown', 'list_markdown_revisions', 'Lista as revisões de um documento Markdown.', 'Leitura'],
  ['Diffs Git', 'record_task_diff', 'Registra commits, branch e arquivos alterados para uma tarefa; patch é opcional.', 'Gravação'],
  ['Diffs Git', 'list_task_diffs', 'Lista diffs Git registrados para uma tarefa.', 'Leitura'],
  ['Diffs Git', 'get_task_diff', 'Busca os metadados e, se armazenado, o patch de um diff específico.', 'Leitura'],
  ['Colaboração', 'send_task_message', 'Envia uma mensagem de mudança, pergunta, resposta, decisão, bloqueio, contrato ou progresso ligada à execução da tarefa.', 'Gravação'],
  ['Colaboração', 'send_collaboration_message', 'Envia mensagem tipada na task como membro autorizado; respostas podem ser vinculadas automaticamente a perguntas abertas.', 'Gravação'],
  ['Colaboração', 'list_task_messages', 'Consulta mensagens e decisões registradas para uma tarefa.', 'Leitura'],
  ['Conversas com IA', 'create_conversation', 'Inicia uma conversa compartilhada no escopo do projeto.', 'Gravação'],
  ['Conversas com IA', 'open_task_conversation', 'Abre ou cria uma conversa multi-turno vinculada à tarefa; use send_task_message para progresso pontual.', 'Gravação'],
  ['Conversas com IA', 'list_conversations', 'Retoma conversas compartilhadas do projeto.', 'Leitura'],
  ['Conversas com IA', 'get_conversation', 'Consulta mensagens e propostas de uma conversa.', 'Leitura'],
  ['Conversas com IA', 'send_conversation_message', 'Envia uma mensagem para a conversa compartilhada.', 'Gravação'],
  ['Conversas com IA', 'create_action_proposal', 'Prepara proposta vinculada à tarefa e versão; a execução aguarda aprovação humana.', 'Gravação'],
  ['Colaboração', 'mark_project_read', 'Avança o cursor de novidades já lidas para a identidade atual.', 'Gravação'],
  ['Colaboração', 'mark_task_read', 'Marca como lidos os eventos de uma task até o cursor informado, sem afetar outras tasks.', 'Gravação'],
  ['Eventos em tempo real', 'subscribe_project_events', 'Inicia a assinatura de eventos do projeto com filtros opcionais.', 'Leitura'],
  ['Eventos em tempo real', 'wait_project_events', 'Espera novos eventos do projeto e retorna quando houver mudança ou o prazo terminar.', 'Leitura'],
  ['Eventos em tempo real', 'unsubscribe_project_events', 'Encerra a assinatura de eventos do projeto.', 'Leitura'],
  ['Eventos em tempo real', 'subscribe_task_events', 'Inicia a assinatura de eventos de uma tarefa.', 'Leitura'],
  ['Eventos em tempo real', 'wait_task_events', 'Espera novos eventos de uma tarefa, como progresso, mensagens ou mudança de status.', 'Leitura'],
  ['Eventos em tempo real', 'list_executions', 'Lista execuções anteriores e atuais de uma tarefa.', 'Leitura'],
  ['Bridge local opcional', 'status', 'Lê o contexto Git do checkout local e procura o projeto correspondente. Requer executar a bridge no repositório.', 'Leitura'],
  ['Bridge local opcional', 'publish_task_diff', 'Publica metadados do diff do checkout Git local para uma tarefa. Requer executar a bridge no repositório.', 'Gravação'],
  ['Bridge local opcional', 'read_repository_file', 'Lê um arquivo pequeno dentro do checkout autorizado, sem executar comandos. Requer bridge local com repositório selecionado.', 'Leitura']
];

const bridgeHttpOnly = new Set(['get_session_context', 'record_task_diff', 'get_project_novelties', 'mark_project_read', 'create_conversation', 'open_task_conversation', 'list_conversations', 'get_conversation', 'send_conversation_message', 'create_action_proposal']);
const bridgeOnly = new Set(['status', 'publish_task_diff', 'read_repository_file']);

export function toolServers(name: string) {
  const servers = [];
  if (!bridgeOnly.has(name)) servers.push('MCP HTTP');
  if (bridgeOnly.has(name) || !bridgeHttpOnly.has(name)) servers.push('Bridge Git');
  return servers;
}
