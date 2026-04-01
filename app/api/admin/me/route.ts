import { NextRequest, NextResponse } from 'next/server';
import { verifyAdmin } from '@/lib/admin-auth';

export async function GET(req: NextRequest): Promise<Response> {
  const user = verifyAdmin(req.headers.get('x-telegram-init-data') ?? '');
  if (!user) {
    return NextResponse.json({ isAdmin: false }, { status: 401 });
  }
  return NextResponse.json({ isAdmin: true });
}
