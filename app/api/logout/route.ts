import { NextResponse } from 'next/server';
import { ACCESS_COOKIE } from '@/lib/access';

export const runtime = 'nodejs';

function clearAndRedirect(request: Request) {
  const res = NextResponse.redirect(new URL('/login', request.url));
  res.cookies.set(ACCESS_COOKIE, '', { path: '/', maxAge: 0 });
  return res;
}

export async function POST(request: Request) {
  return clearAndRedirect(request);
}

export async function GET(request: Request) {
  return clearAndRedirect(request);
}
