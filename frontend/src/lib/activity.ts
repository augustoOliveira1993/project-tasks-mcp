/** Normaliza os eventos do histórico para pt-BR e separa o ruído técnico (leituras MCP, heartbeats). */

const kindLabels: Record<string, string> = {
  'task.created': 'Tarefa criada',
  'feature.created': 'Feature criada',
  'project.created': 'Projeto criado',
  'task.message.created': 'Mensagem na tarefa',
  'conversation.created': 'Conversa criada',
  'conversation.title.updated': 'Título da conversa alterado',
  'conversation.task.linked': 'Conversa vinculada à tarefa',
  'conversation.deleted': 'Conversa excluída',
  'conversation.message.created': 'Mensagem na conversa',
  'conversation.action_proposal.created': 'Proposta de execução criada',
  'conversation.action_proposal.approved': 'Execução autorizada',
  'mcp.tool.called': 'Chamada MCP',
  'body.updated': 'Documento atualizado',
  'task.diff.published': 'Diff Git publicado',
  'task.submitted': 'Enviada para revisão',
  'task.claimed': 'Assumida por agente',
  'task.progressed': 'Progresso registrado',
  'task.acceptance.progressed': 'Critério de aceite atualizado',
  'task.blocked': 'Bloqueada',
  'task.approved': 'Aprovada',
  'task.status.changed': 'Status alterado',
  'task.check.changed': 'Conferência alterada',
  'task.transferred': 'Tarefa transferida',
  'task.deleted': 'Tarefa excluída',
  'project.deleted': 'Projeto excluído',
  'task.question.open': 'Pergunta aberta',
  'task.updated': 'Tarefa atualizada',
  'project.create_project': 'Projeto criado',
  'project.create_feature': 'Feature criada',
  'project.create_task': 'Tarefa criada',
  'project.claim_task': 'Assumida por agente',
  'project.record_progress': 'Progresso registrado',
  'project.submit_task': 'Enviada para revisão',
  'project.set_task_status': 'Status alterado',
  'project.record_task_diff': 'Diff Git publicado',
  'project.send_task_message': 'Mensagem na tarefa',
  'project.create_conversation': 'Conversa criada',
  'project.send_conversation_message': 'Mensagem na conversa',
  'project.heartbeat_task': 'Heartbeat da execução',
  'project.grant_credential_project': 'Acesso ao projeto concedido',
  'project.issue': 'Credencial emitida',
  'project.issue_project_member': 'Acesso de membro emitido',
  'project.revoke': 'Credencial revogada',
  'project.bind_repository_git': 'Repositório Git vinculado',
  'project.edit_record': 'Registro editado',
  'project.archive_record': 'Registro arquivado',
  'project.block_task': 'Bloqueada',
  'project.approve': 'Aprovada',
  'project.manual_status_change': 'Status alterado',
  'project.expired': 'Reserva de execução expirada',
  'project.auto_member': 'Membro adicionado automaticamente',
  'project.transfer_task': 'Tarefa transferida',
  'project.save_markdown': 'Documento criado',
  'project.update_markdown': 'Documento atualizado',
  'project.set_acceptance_criterion': 'Critério de aceite atualizado',
  'project.set_task_checked': 'Conferência alterada'
};

const toolLabels: Record<string, string> = {
  list_records: 'Listou registros',
  get_record: 'Consultou um registro',
  get_summary: 'Consultou o resumo',
  get_task_context: 'Consultou o contexto da tarefa',
  get_session_context: 'Abriu o contexto da sessão',
  list_pending: 'Listou tarefas pendentes',
  list_conversations: 'Listou conversas',
  get_conversation: 'Abriu uma conversa',
  list_project_activity: 'Consultou a atividade do projeto',
  get_global_activity: 'Consultou a atividade global',
  get_project_sync_report: 'Consultou o relatório de sincronização',
  get_project_area_summary: 'Consultou o resumo por área',
  get_task_markdown_summary: 'Gerou o resumo da tarefa',
  list_task_messages: 'Listou mensagens da tarefa',
  list_task_diffs: 'Listou diffs da tarefa',
  list_markdowns: 'Listou documentos',
  get_markdown: 'Leu um documento',
  list_executions: 'Listou execuções',
  resolve_project_context: 'Resolveu o projeto do workspace',
  wait_project_events: 'Aguardou eventos do projeto',
  wait_task_events: 'Aguardou eventos da tarefa',
  subscribe_project_events: 'Assinou eventos do projeto',
  subscribe_task_events: 'Assinou eventos da tarefa',
  heartbeat_task: 'Heartbeat da execução',
  mark_task_read: 'Marcou tarefa como lida',
  mark_project_read: 'Marcou projeto como lido',
  mark_conversation_read: 'Marcou conversa como lida'
};

const noiseToolPattern = /^(list_|get_|wait_|subscribe_|unsubscribe_|resolve_|preview_|mark_|status$)/;

function humanize(value: string) {
  const words = value.replace(/^(project|task|mcp)\./, '').replace(/[._-]+/g, ' ').trim();
  return words ? words[0].toLocaleUpperCase('pt-BR') + words.slice(1) : 'Evento do projeto';
}

export function eventKindLabel(kind?: string) {
  if (!kind) return 'Evento do projeto';
  return kindLabels[kind] ?? humanize(kind);
}

export function toolLabel(toolName?: string | null) {
  if (!toolName) return '';
  return toolLabels[toolName] ?? humanize(toolName);
}

type EventLike = { kind?: string; toolName?: string | null; summary?: string };

/** Chamadas MCP de leitura e heartbeats: úteis para auditoria, ruins para acompanhamento. */
export function isTechnicalEvent(event: EventLike) {
  if (event.kind === 'project.heartbeat_task' || event.toolName === 'heartbeat_task') return true;
  return event.kind === 'mcp.tool.called' && noiseToolPattern.test(event.toolName ?? '');
}

/** O servidor devolve o código da ação como resumo quando não há texto próprio; troca por rótulo legível. */
export function eventSummary(event: EventLike) {
  const summary = event.summary?.trim();
  if (event.kind === 'mcp.tool.called' && event.toolName) return toolLabel(event.toolName);
  if (!summary || /^[a-z]+(_[a-z]+)*$/.test(summary)) return eventKindLabel(event.kind);
  return summary;
}

export function originLabel(origin?: string | null) {
  const value = origin?.trim();
  if (!value || value === 'Origem não identificada') return 'Origem desconhecida';
  if (/^claude/i.test(value)) return 'Claude Code';
  if (/^codex/i.test(value)) return 'Codex';
  return value[0].toLocaleUpperCase('pt-BR') + value.slice(1);
}
