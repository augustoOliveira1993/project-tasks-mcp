import { errorHint, errorMessage } from '../../lib/format';
import { buttonSecondarySmall, errorBox } from './classes';

export function ErrorNotice({ error, onRetry, retrying = false, title }: { error: unknown; onRetry?: () => void; retrying?: boolean; title?: string }) {
  const hint = errorHint(error);
  return <div className={`${errorBox} flex items-start justify-between gap-3 text-ui-sm`} role="alert">
    <div className="grid min-w-0 gap-[3px]">
      {title && <strong className="text-ui-sm">{title}</strong>}
      <span>{errorMessage(error)}</span>
      {hint && <small className="text-inherit text-ui-xs opacity-85">{hint}</small>}
    </div>
    {onRetry && <button type="button" className={buttonSecondarySmall} onClick={onRetry} disabled={retrying}>{retrying ? 'Tentando…' : 'Tentar novamente'}</button>}
  </div>;
}
