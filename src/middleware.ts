/**
 * 全站鉴权中间件（详设 §9）
 * - 有 Auth.js 凭据：校验 session，未登录 API 401、页面 302 → 登录
 * - 本地开发（无凭据）：放行（lib/auth.ts 的 dev 会话机制兜底）
 */
import { NextResponse, type NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(req: NextRequest) {
  const hasCredentials = !!process.env.AUTH_GITHUB_ID && !!process.env.AUTH_GITHUB_SECRET;
  if (!hasCredentials) return NextResponse.next(); // 本地开发

  const isApi = req.nextUrl.pathname.startsWith("/api/");
  const isAuthRoute = req.nextUrl.pathname.startsWith("/api/auth/");
  if (isAuthRoute) return NextResponse.next();

  const token = await getToken({ req, secret: process.env.AUTH_SECRET });
  if (token) return NextResponse.next();

  if (isApi) {
    return NextResponse.json({ error: { code: "UNAUTHORIZED" } }, { status: 401 });
  }
  return NextResponse.redirect(new URL("/api/auth/signin", req.url));
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|icons|manifest.json|sw.js|favicon.ico).*)"],
};
