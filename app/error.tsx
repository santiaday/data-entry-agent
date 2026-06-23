'use client';

import { useEffect } from 'react';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface the error in the console for debugging; the UI shows a friendly message.
    console.error(error);
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 text-center shadow-sm">
        <div className="space-y-1">
          <h1 className="text-lg font-semibold tracking-tight">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">
            An unexpected error occurred. You can try again, and if the problem
            persists, contact your administrator.
          </p>
        </div>
        {error.message && (
          <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-left text-sm text-destructive">
            {error.message}
          </p>
        )}
        {error.digest && (
          <p className="text-xs text-muted-foreground">Reference: {error.digest}</p>
        )}
        <button
          type="button"
          onClick={() => reset()}
          className="w-full rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
