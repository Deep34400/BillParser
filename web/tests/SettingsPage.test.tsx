import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SettingsPage } from '../src/pages/SettingsPage.js';
import { api } from '../src/api/client.js';

beforeEach(() => {
  vi.spyOn(api, 'settings').mockResolvedValue({
    pipelineMode: 'split',
    extractionProvider: 'mistral',
    structuringProvider: 'gemini',
    structuringModel: 'gemini-2.5-flash',
    singleProvider: 'gemini',
    singleModel: 'gemini-2.5-flash',
    providers: [],
  } as any);
  vi.spyOn(api, 'revealCreds').mockResolvedValue({ credentials: {} } as any);
});

it('shows stored pipeline mode as SPLIT', async () => {
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText('SPLIT')).toBeTruthy());
  expect(screen.getByText(/Split — Extract \+ Structure/)).toBeTruthy();
});

it('shows stored pipeline mode as SINGLE when saved', async () => {
  vi.spyOn(api, 'settings').mockResolvedValue({
    pipelineMode: 'single',
    extractionProvider: 'mistral',
    structuringProvider: 'gemini',
    structuringModel: 'gemini-2.5-flash',
    singleProvider: 'gemini',
    singleModel: 'gemini-2.5-flash',
    providers: [],
  } as any);
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText('SINGLE')).toBeTruthy());
  expect(screen.getByText(/Single — One API Call/)).toBeTruthy();
});

it('saves pipelineMode when Save is clicked', async () => {
  const save = vi.spyOn(api, 'saveSettings').mockResolvedValue({} as any);
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText('Save as SPLIT mode')).toBeTruthy());
  fireEvent.click(screen.getByText('Single (1 API call)'));
  fireEvent.click(screen.getByText('Save as SINGLE mode'));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
    pipelineMode: 'single',
  })));
});

it('renders provider API key forms', async () => {
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getAllByText('Google Gemini').length).toBeGreaterThan(0));
  expect(screen.getAllByText('Anthropic Claude').length).toBeGreaterThan(0);
  expect(screen.getAllByText('OpenAI GPT').length).toBeGreaterThan(0);
});
