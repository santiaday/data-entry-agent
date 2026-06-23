import Link from 'next/link';

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="w-full max-w-md space-y-4 rounded-xl border bg-card p-6 text-center shadow-sm">
        <div className="space-y-1">
          <p className="text-5xl font-semibold tracking-tight text-emerald-600">404</p>
          <h1 className="text-lg font-semibold tracking-tight">Page not found</h1>
          <p className="text-sm text-muted-foreground">
            The page you are looking for doesn&apos;t exist or may have been moved.
          </p>
        </div>
        <Link
          href="/data-entry"
          className="inline-flex w-full items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-emerald-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
        >
          Back to Dashboard
        </Link>
      </div>
    </div>
  );
}
