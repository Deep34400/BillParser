import type { StructuringModel } from './types.js';
import { STRUCTURING_PROMPT } from './types.js';
import { normalizeStructured } from './index.js';
import { httpErrorBody } from '../lib/http.js';
import { structuringTokenCost } from './pricing.js';
export const mistralStructModel = (model: string): StructuringModel => ({
  provider: 'mistral', model,
  async structure(markdown, creds) {
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${creds.apiKey}` },
      body: JSON.stringify({ model, messages: [
        { role: 'system', content: STRUCTURING_PROMPT }, { role: 'user', content: markdown },
      ] }),
    });
    if (!res.ok) throw new Error(`Mistral structuring HTTP ${res.status}${await httpErrorBody(res)}`);
    const j: any = await res.json();
    const structuringCost = structuringTokenCost(model, j.usage?.prompt_tokens, j.usage?.completion_tokens);
    return { ...normalizeStructured(j.choices?.[0]?.message?.content ?? '{}', markdown), structuringCost };
  },
});
