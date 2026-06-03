import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, isAccessEnabled, tokenForPassword } from '@/lib/access';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  if (!isAccessEnabled()) {
    // No gate configured — nothing to log into.
    return NextResponse.json({ ok: true });
  }

  const body = (await request.json().catch(() => ({}))) as { password?: unknown };
  const password = typeof body.password === 'string' ? body.password : '';
  const expected = process.env.APP_ACCESS_PASSWORD ?? '';

  if (!password || password !== expected) {
    return NextResponse.json({ error: 'Invalid password' }, { status: 401 });
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(ACCESS_COOKIE, await tokenForPassword(expected), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
  return res;
}
