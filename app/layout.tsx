import type { Metadata } from 'next';
import './globals.css';
import { AuthProvider } from '@/lib/hooks/use-auth';

export const metadata: Metadata = {
  title: 'Data Entry Agent',
  description: 'AI-powered Salesforce field extraction and write-back agent.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
