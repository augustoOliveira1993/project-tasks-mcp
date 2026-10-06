import { errorHint, errorMessage } from '../../lib/format';

export function ErrorNotice({ error, onRetry, retrying = false, title }: { error: unknown; onRetry?: () => void; retrying?: boolean; title?: string }) {
  const hint = errorHint(error);
  return <div className="notice error error-notice" role="alert">
    <div className="error-notice-copy">
      {title && <strong>{title}</strong>}
      <span>{errorMessage(error)}</span>
      {hint && <small>{hint}</small>}
    </div>
    {onRetry && <button type="button" className="button secondary small-button" onClick={onRetry} disabled={retrying}>{retrying ? 'Tentando…' : 'Tentar novamente'}</button>}
  </div>;
}
