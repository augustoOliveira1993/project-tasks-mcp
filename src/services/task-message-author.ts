export function isKnownAiMcpClient(clientName?: string | null) {
  const normalized = clientName?.trim().toLocaleLowerCase('en-US') ?? '';
  return /^(codex|claude)(?:$|[\s._-])/.test(normalized);
}

export function taskMessageAuthorMetadata(actor: { scope: string; clientName?: string }) {
  const clientName = actor.clientName?.trim().slice(0, 100) || null;
  return {
    authorType: actor.scope === 'agent' || isKnownAiMcpClient(clientName) ? 'agent' as const : 'human' as const,
    clientName
  };
}
