import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/hooks/use-auth';

export const metadata: Metadata = {
  title: {
    default: 'Data Entry Agent',
    template: '%s · Data Entry Agent',
  },
  description: 'AI-powered Salesforce field extraction and write-back agent.',
};

// Render at REQUEST time so the runtime config below reflects the deploy-time
// environment. Without this, Next could prerender this layout at BUILD time and
// bake an empty config into the HTML (the browser would then have no bearer).
export const dynamic = 'force-dynamic';

/**
 * Runtime config injected onto `window.__DATA_ENTRY_CONFIG__` for the browser
 * API client (lib/api/client.ts). This is read on the SERVER at request time —
 * not inlined at build — so a runtime-only platform (DeployBay sets env at
 * container start, not at `next build`) can configure the panel without a
 * rebuild. The base URL is non-secret; the token is the data-entry bearer
 * (browser-exposed by design, same as the former NEXT_PUBLIC_* approach).
 */
function runtimeConfigScript(): string {
  const config = {
    base:
      process.env.DATA_ENTRY_API_BASE ||
      process.env.NEXT_PUBLIC_DATA_ENTRY_API_BASE ||
      '',
    token:
      process.env.DATA_ENTRY_API_TOKEN ||
      process.env.NEXT_PUBLIC_DATA_ENTRY_API_TOKEN ||
      '',
  };
  // JSON-encode and neutralize any "<" so the value can never break out of the
  // <script> element. (Our config has none, but this stays XSS-safe regardless.)
  const json = JSON.stringify(config).replace(/</g, '\\u003c');
  return `window.__DATA_ENTRY_CONFIG__=${json};`;
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        {/* Must run before hydration so apiFetch (client) sees the config. */}
        <script dangerouslySetInnerHTML={{ __html: runtimeConfigScript() }} />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
