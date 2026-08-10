import type { Metadata } from 'next';

import { safeNextPath } from '@/lib/auth/paths';
import { LoginForm } from '@/components/auth/LoginForm';

export const metadata: Metadata = { title: 'Unlock' };

/**
 * The door, outside the shell.
 *
 * This page lives outside the `(os)` route group on purpose: the shell layout
 * reads the workspace, and nothing of the workspace may render before the
 * access key has been presented. What loads here is a wordmark and a field.
 */
export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  return (
    <main className="login">
      <div className="login-card">
        <div className="row" style={{ gap: 'var(--s-3)', alignItems: 'center' }}>
          <span className="rail-mark" aria-hidden="true">
            OS
          </span>
          <strong>OmniOS</strong>
        </div>
        <p className="hint">
          This workspace is locked. Enter the access key — your phone can remember it for you.
        </p>
        <LoginForm next={safeNextPath(params.next ?? null)} />
      </div>
    </main>
  );
}
