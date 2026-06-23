'use client';

import { useEffect } from 'react';

export default function DataEntryError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md space-y-4 rounded-xl border bg-card p-6 text-center shadow-sm">
      <div className="space-y-1">
        <h2 className="text-base font-semibold tracking-tight">Unable to load this view</h2>
        <p className="text-sm text-muted-foreground">
          Something went wrong while loading this page. You can retry, or use the
          navigation above to go elsewhere.
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
  );
}
