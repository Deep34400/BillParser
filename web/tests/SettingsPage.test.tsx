import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SettingsPage } from '../src/pages/SettingsPage.js';
import { api } from '../src/api/client.js';
beforeEach(() => {
  vi.spyOn(api, 'settings').mockResolvedValue({ extractionProvider: 'mistral', structuringProvider: 'anthropic', structuringModel: 'claude-sonnet-4-6',
    providers: [{ name: 'azure', displayName: 'Azure', kind: 'structured', requiredCredentials: ['endpoint','apiKey'], configured: false, masked: {} }] } as any);
  vi.spyOn(api, 'revealCreds').mockResolvedValue({ credentials: {} } as any);
});
it('prefills credential fields from revealed stored values', async () => {
  vi.spyOn(api, 'revealCreds').mockResolvedValue({ credentials: { azure: { endpoint: 'https://stored', apiKey: 'sk-stored-1234' } } } as any);
  render(<SettingsPage />);
  await waitFor(() => expect((screen.getByPlaceholderText('endpoint') as HTMLInputElement).value).toBe('https://stored'));
  expect((screen.getByPlaceholderText('apiKey') as HTMLInputElement).value).toBe('sk-stored-1234');
});
it('renders provider credential forms and saves', async () => {
  const save = vi.spyOn(api, 'saveCreds').mockResolvedValue({} as any);
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText('Azure')).toBeTruthy());
  fireEvent.change(screen.getByPlaceholderText('endpoint'), { target: { value: 'https://x' } });
  fireEvent.change(screen.getByPlaceholderText('apiKey'), { target: { value: 'sk-1' } });
  fireEvent.click(screen.getAllByText('Save')[0]);
  await waitFor(() => expect(save).toHaveBeenCalledWith('azure', { endpoint: 'https://x', apiKey: 'sk-1' }));
});
