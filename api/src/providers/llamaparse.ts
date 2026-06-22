import type { ExtractionProvider, CanonicalResult } from './types.js';
import { getStructuringModel } from '../structuring/index.js';
import { httpErrorBody } from '../lib/http.js';

export const llamaparseProvider: ExtractionProvider = {
  name: 'llamaparse', displayName: 'LlamaParse', kind: 'markdown',
  requiredCredentials: ['apiKey'],
  isConfigured: (c) => !!c?.apiKey,
  async extract(file, creds, ctx) {
    const form = new FormData();
    form.append('file', new Blob([file as unknown as BlobPart], { type: 'application/pdf' }), ctx.fileName);
    const up = await fetch('https://api.cloud.llamaindex.ai/api/v1/parsing/upload', {
      method: 'POST', headers: { authorization: `Bearer ${creds.apiKey}` }, body: form });
    if (!up.ok) throw new Error(`LlamaParse upload HTTP ${up.status}${await httpErrorBody(up)}`);
    const { id }: any = await up.json();
    let markdown = '';
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 2000));
      const st = await fetch(`https://api.cloud.llamaindex.ai/api/v1/parsing/job/${id}`, {
        headers: { authorization: `Bearer ${creds.apiKey}` } });
      const j: any = await st.json();
      if (j.status === 'SUCCESS') {
        const md = await fetch(`https://api.cloud.llamaindex.ai/api/v1/parsing/job/${id}/result/markdown`, {
          headers: { authorization: `Bearer ${creds.apiKey}` } });
        markdown = ((await md.json()) as any).markdown ?? ''; break;
      }
      if (j.status === 'ERROR') throw new Error('LlamaParse job error');
    }
    if (!markdown) throw new Error('LlamaParse timed out');
    const { model, creds: sCreds } = await getStructuringModel();
    const fields = await model.structure(markdown, sCreds);
    const out: CanonicalResult = { ...fields, rawText: markdown, rawJson: { jobId: id, markdown } };
    return out;
  },
};
