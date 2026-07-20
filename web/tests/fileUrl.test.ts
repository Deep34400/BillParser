import { describe, it, expect } from 'vitest';

/** Pure helper mirrored from client — keep in sync with api.fileUrl */
function fileUrlWithToken(id: string, token: string | null): string {
  const base = `/api/invoices/${id}/file`;
  return token ? `${base}?token=${encodeURIComponent(token)}` : base;
}

describe('invoice fileUrl auth query', () => {
  it('appends session token so iframe can load private PDF', () => {
    expect(fileUrlWithToken('abc', 'tok123')).toBe('/api/invoices/abc/file?token=tok123');
  });

  it('omits token when logged out', () => {
    expect(fileUrlWithToken('abc', null)).toBe('/api/invoices/abc/file');
  });
});
