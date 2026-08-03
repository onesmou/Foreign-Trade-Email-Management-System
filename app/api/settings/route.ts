import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

export async function GET() {
  const values = env as unknown as Record<string, string | undefined>;
  return Response.json({
    aiConfigured: Boolean(values.OPENAI_API_KEY),
    provider: values.OPENAI_BASE_URL ? "OpenAI compatible" : "OpenAI",
    model: values.OPENAI_MODEL || "gpt-5.6-terra",
    inboundConfigured: Boolean(values.INBOUND_EMAIL_SECRET),
  });
}
