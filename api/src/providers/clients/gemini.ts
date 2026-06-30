import { GoogleGenerativeAI, type GenerationConfig } from '@google/generative-ai';

export type GeminiPart = { inlineData: { data: string; mimeType: string } };

export async function geminiGenerate(
  apiKey: string,
  model: string,
  prompt: string,
  parts: GeminiPart[],
  signal?: AbortSignal,
  generationConfig?: GenerationConfig,
): Promise<{ text: string; raw: unknown; inputTokens?: number; outputTokens?: number }> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const m = genAI.getGenerativeModel({ model, generationConfig });
  const res = await m.generateContent(
    [{ text: prompt }, ...parts],
    signal ? { signal } : undefined,
  );
  const meta = res.response.usageMetadata;
  return {
    text: res.response.text(),
    raw: res,
    inputTokens: meta?.promptTokenCount,
    outputTokens: meta?.candidatesTokenCount,
  };
}
