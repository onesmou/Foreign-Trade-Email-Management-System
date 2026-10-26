import { assertSameOrigin, requireApiUser } from "../../../../lib/auth";
import {
  chatImageBytes,
  chatImageFor,
  saveChatImage,
  CHAT_IMAGE_LIMIT,
} from "../../../../lib/chat-images";
import { boundedBytes } from "../../../../lib/whatsapp-media";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  const a = await requireApiUser(["admin", "sales"]);
  if (!a.user) return a.response;
  try {
    assertSameOrigin(request);
    if (!request.body) throw new Error("请先选择图片");
    const max = CHAT_IMAGE_LIMIT + 65536;
    if (Number(request.headers.get("content-length")) > max)
      throw new Error("单张图片须小于8MB");
    const bytes = await boundedBytes(request.body, max);
    const form = await new Request(request.url, {
      method: "POST",
      headers: request.headers,
      body: new Uint8Array(bytes),
    }).formData();
    const file = form.get("image");
    if (!(file instanceof File)) throw new Error("请先选择图片");
    const image = await saveChatImage(
      a.user,
      Number(form.get("customerId")),
      Number(form.get("projectId")),
      file.name,
      Buffer.from(await file.arrayBuffer()),
    );
    return Response.json({ image });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}
export async function GET(request: Request) {
  const a = await requireApiUser();
  if (!a.user) return a.response;
  try {
    const row = chatImageFor(
      a.user,
      new URL(request.url).searchParams.get("id") || "",
    );
    return new Response(new Uint8Array(await chatImageBytes(row)), {
      headers: {
        "Content-Type": "image/webp",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox; default-src 'none'",
      },
    });
  } catch {
    return Response.json({ error: "图片不存在或未获授权" }, { status: 404 });
  }
}
