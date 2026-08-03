import { assertSameOrigin, destroySession } from "../../../../lib/auth";

export async function POST(request: Request) {
  try { assertSameOrigin(request); await destroySession(); return Response.json({ ok: true }); }
  catch { return Response.json({ error: "退出失败" }, { status: 500 }); }
}
