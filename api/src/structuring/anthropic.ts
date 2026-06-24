import Anthropic from '@anthropic-ai/sdk';
import type { StructuringModel } from './types.js';
import { STRUCTURING_PROMPT } from './types.js';
import { normalizeStructured } from './index.js';
import { structuringTokenCost } from './pricing.js';
export const anthropicModel = (model: string): StructuringModel => ({
  provider: 'anthropic', model,
  async structure(markdown, creds) {
    const client = new Anthropic({ apiKey: creds.apiKey });
    const msg = await client.messages.create({
      model, max_tokens: 4096,
      messages: [{ role: 'user', content: `${STRUCTURING_PROMPT}\n\nOCR markdown:\n${markdown}` }],
    });
    const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
    const structuringCost = structuringTokenCost(model, msg.usage?.input_tokens, msg.usage?.output_tokens);
    return { ...normalizeStructured(text, markdown), structuringCost };
  },
});
