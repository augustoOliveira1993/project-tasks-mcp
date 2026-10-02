type OriginActor = { scope?: string; clientName?: string };

export function eventOrigin(actor: OriginActor) {
  const clientName = typeof actor.clientName === 'string' ? actor.clientName.trim().slice(0, 100) : '';
  if (clientName) return clientName;
  if (actor.scope === 'system') return 'Sistema';
  if (actor.scope === 'agent') return 'Agente MCP';
  if (actor.scope === 'trusted_local') return 'MCP local';
  if (actor.scope === 'human') return 'Painel administrativo';
  return 'Origem não identificada';
}
