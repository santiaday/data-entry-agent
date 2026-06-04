import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, expectedToken } from '@/lib/access';

// Paths reachable without the access cookie. The webhook + queue processor have
// their own shared-secret auth and are called by machines, not browsers.
const PUBLIC_PATHS = [
  '/login',
  '/api/login',
  '/api/logout',
  '/api/health',
  '/api/admin/import',
  '/api/data-entry/webhook',
  '/api/data-entry/process-queue',
];

export async function middleware(req: NextRequest) {
  // Gate disabled when no password is configured.
  if (!process.env.APP_ACCESS_PASSWORD) return NextResponse.next();

  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return NextResponse.next();
  }

  const expected = await expectedToken();
  const got = req.cookies.get(ACCESS_COOKIE)?.value;
  if (expected && got === expected) return NextResponse.next();

  const url = req.nextUrl.clone();
  url.pathname = '/login';
  url.searchParams.set('next', pathname);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    // Run on everything except Next internals and static files.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
