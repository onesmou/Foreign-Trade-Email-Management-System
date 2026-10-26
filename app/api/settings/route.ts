import { assertSameOrigin, requireApiUser } from "../../../lib/auth";
import { activeProvider, providerPresets } from "../../../lib/ai";
import {
  companyProfile,
  saveCompanyProfile,
  CompanyInputError,
} from "../../../lib/company-profile";
import { listKnowledge } from "../../../lib/knowledge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireApiUser();
  if (!auth.user) return auth.response;
  const profile = companyProfile();
  const provider = activeProvider();
  const files = listKnowledge(auth.user);
  const knowledge = {
    files: files.filter((f) => f.is_current).length,
    chunks: files.reduce((n, f) => n + Number(f.chunk_count), 0),
  };
  return Response.json({
    profile,
    preview: process.env.CRM_PREVIEW === "1",
    activeProvider: provider
      ? {
          id: provider.id,
          name: provider.name,
          model: provider.model,
          providerKey: provider.providerKey,
        }
      : null,
    knowledge,
    presets: providerPresets,
    user: auth.user,
  });
}

export async function PATCH(request: Request) {
  const auth = await requireApiUser(["admin"]);
  if (!auth.user) return auth.response;
  try {
    assertSameOrigin(request);
    const profile = await saveCompanyProfile(request, auth.user.id);
    return Response.json({ ok: true, profile });
  } catch (error) {
    if (error instanceof CompanyInputError)
      return Response.json({ error: error.message }, { status: error.status });
    if (error instanceof Error && error.message === "请求来源验证失败")
      return Response.json({ error: error.message }, { status: 403 });
    console.error("Company configuration save failed");
    return Response.json(
      { error: "保存失败，原有配置未更改，请稍后重试" },
      { status: 500 },
    );
  }
}
