import { requireApiUser } from "../../../lib/auth";
import { getDb } from "../../../lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  const logo = getDb()
    .prepare("SELECT logo,sha256 FROM company_branding WHERE id=1")
    .get() as { logo: Uint8Array; sha256: string } | undefined;
  const version = new URL(request.url).searchParams.get("v");
  if (!logo || (version && version !== logo.sha256))
    return new Response(null, {
      status: 404,
      headers: { "Cache-Control": "no-store" },
    });
  const headers = {
    "Content-Type": "image/webp",
    "Cache-Control": "private, no-cache",
    "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "default-src 'none'; sandbox",
    ETag: `"${logo.sha256}"`,
    Vary: "Cookie",
  };
  if (request.headers.get("if-none-match") === headers.ETag)
    return new Response(null, { status: 304, headers });
  return new Response(new Uint8Array(logo.logo), { headers });
}
