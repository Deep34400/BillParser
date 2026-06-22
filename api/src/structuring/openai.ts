import OpenAI from 'openai';
import type { StructuringModel } from './types.js';
import { STRUCTURING_PROMPT } from './types.js';
import { normalizeStructured } from './index.js';
import { structuringTokenCost } from './pricing.js';
export const openaiModel = (model: string): StructuringModel => ({
  provider: 'openai', model,
  async structure(markdown, creds) {
    const client = new OpenAI({ apiKey: creds.apiKey });
    const res = await client.chat.completions.create({
      model, messages: [
        { role: 'system', content: STRUCTURING_PROMPT },
        { role: 'user', content: markdown },
      ],
    });
    const structuringCost = structuringTokenCost(model, res.usage?.prompt_tokens, res.usage?.completion_tokens);
    return { ...normalizeStructured(res.choices[0]?.message?.content ?? '{}'), structuringCost };
  },
});
