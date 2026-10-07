export function isKnownAgentClient(clientName?: string | null) {
  const client = clientName?.trim().toLocaleLowerCase('en-US');
  return Boolean(client?.startsWith('codex') || client?.startsWith('claude'));
}

const iconTones = { codex: 'text-[#16836f]', claude: 'text-[#cf6848]', generic: 'text-[#647087]' };

export function AgentClientIcon({ clientName }: { clientName?: string | null }) {
  const client = clientName?.trim().toLocaleLowerCase('en-US');
  const variant = client?.startsWith('codex') ? 'codex' : client?.startsWith('claude') ? 'claude' : 'generic';

  return <svg className={`size-[15px] flex-[0_0_15px] ${iconTones[variant]}`} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
    {variant === 'codex' ? <path d="m8 6-6 6 6 6m8-12 6 6-6 6m-2-16-4 20" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.2" />
      : variant === 'claude' ? <><path d="M12 2.25 14.15 9.85 21.75 12l-7.6 2.15L12 21.75l-2.15-7.6L2.25 12l7.6-2.15L12 2.25Z" fill="currentColor" /><path d="M19 2.5v4m2-2h-4" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" /></>
        : <><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.8" /><path d="M12 8v8m-4-4h8" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="1.8" /></>}
  </svg>;
}
