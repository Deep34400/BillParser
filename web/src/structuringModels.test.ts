import { it, expect } from 'vitest';
import { STRUCTURING_MODEL_SUGGESTIONS, modelForProvider } from './structuringModels.js';

it('keeps a model that already belongs to the selected provider', () => {
  expect(modelForProvider('mistral', 'mistral-large-latest')).toBe('mistral-large-latest');
  expect(modelForProvider('ollama', 'qwen2.5:3b')).toBe('qwen2.5:3b');
});

it('resets a foreign model to the provider default (the qwen-on-mistral bug)', () => {
  expect(modelForProvider('mistral', 'qwen2.5:3b')).toBe(STRUCTURING_MODEL_SUGGESTIONS.mistral[0]);
  expect(modelForProvider('anthropic', 'mistral-large-latest')).toBe(STRUCTURING_MODEL_SUGGESTIONS.anthropic[0]);
});

it('defaults an empty model to the provider default', () => {
  expect(modelForProvider('openai', '')).toBe(STRUCTURING_MODEL_SUGGESTIONS.openai[0]);
});

it('leaves an unknown/custom model untouched (e.g. a custom local Ollama model)', () => {
  expect(modelForProvider('ollama', 'llama3.2:latest')).toBe('llama3.2:latest');
});
