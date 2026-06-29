import { useState } from 'react';
import { cliExtSetConsent } from './kanban/api/client';

interface Props {
  onDone: () => void;
}

export default function CliExtConsentModal({ onDone }: Props) {
  const [pending, setPending] = useState<'install' | 'dismiss' | null>(null);
  const [error, setError] = useState<string | null>(null);

  const decide = async (install: boolean) => {
    setPending(install ? 'install' : 'dismiss');
    setError(null);
    try {
      await cliExtSetConsent(install);
      onDone();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="kanso-alert-backdrop">
      <section
        className="kanso-alert"
        role="dialog"
        aria-modal="true"
        aria-labelledby="kanso-cli-ext-title"
      >
        <h2 id="kanso-cli-ext-title">Install Copilot CLI extension?</h2>
        <p>
          kanso can install its Copilot CLI extension and MCP server so assistants can read and
          update your local boards while the app is running.
        </p>
        {error && <p className="kanso-alert-error">{error}</p>}
        <div className="kanso-alert-actions">
          <button
            type="button"
            className="kanso-primary-btn"
            disabled={pending !== null}
            onClick={() => void decide(true)}
          >
            {pending === 'install' ? 'Installing…' : 'Install Copilot CLI extension'}
          </button>
          <button
            type="button"
            className="kanso-secondary-btn"
            disabled={pending !== null}
            onClick={() => void decide(false)}
          >
            {pending === 'dismiss' ? 'Saving…' : 'Not now'}
          </button>
        </div>
      </section>
    </div>
  );
}
