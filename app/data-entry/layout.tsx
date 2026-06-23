import { DataEntryNav } from '@/components/data-entry/DataEntryNav';
import { isAccessEnabled } from '@/lib/access';

export default function DataEntryLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const showSignOut = isAccessEnabled();

  return (
    <main className="min-h-screen bg-background">
      <header className="sticky top-0 z-10 border-b bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80">
        <div className="mx-auto flex max-w-7xl items-center gap-6 px-6 py-3">
          <h1 className="text-lg font-semibold tracking-tight">Data Entry Agent</h1>
          <DataEntryNav />
          {showSignOut && (
            <a
              href="/api/logout"
              className="ml-auto rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground"
            >
              Sign out
            </a>
          )}
        </div>
      </header>
      <div className="mx-auto max-w-7xl px-6 py-6">{children}</div>
    </main>
  );
}
