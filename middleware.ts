import { NextResponse, type NextRequest } from 'next/server';
import { ACCESS_COOKIE, expectedToken } from '@/lib/access';

// Paths reachable without the access cookie.
const PUBLIC_PATHS = ['/login', '/api/login', '/api/logout', '/api/health'];

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
  const passwordGate = !!process.env.APP_ACCESS_PASSWORD;
  // Operator asserts an external access boundary (e.g. DeployBay's ingress
  // grant) sits in front of the app.
  const externalGate = process.env.REVOPS_EXTERNAL_GATE === 'true';

  // No app-level password configured.
  if (!passwordGate) {
    if (externalGate) return NextResponse.next(); // the ingress is the gate
    // FAIL CLOSED: with neither a password nor a declared external gate, lock
    // everything except public paths instead of serving the full write surface
    // to anonymous callers.
    if (isPublic) return NextResponse.next();
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', pathname);
    url.searchParams.set('locked', '1');
    return NextResponse.redirect(url);
  }

  // Password gate configured: require the cookie.
  if (isPublic) return NextResponse.next();
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
