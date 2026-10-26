import "server-only";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { validateProvider, type ProviderConfig } from "./ai";

export function sdkModel(config: ProviderConfig) {
  validateProvider(config);
  if (config.providerKey === "anthropic")
    return createAnthropic({ apiKey: config.apiKey, baseURL: config.baseUrl })(
      config.model,
    );
  if (config.providerKey === "gemini")
    return createGoogleGenerativeAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    })(config.model);
  if (config.apiStyle === "responses")
    return createOpenAI({
      apiKey: config.apiKey || "local",
      baseURL: config.baseUrl,
    }).responses(config.model);
  return createOpenAICompatible({
    name: config.name,
    apiKey: config.apiKey || undefined,
    baseURL: config.baseUrl,
  }).chatModel(config.model);
}
