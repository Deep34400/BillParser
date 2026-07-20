import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { SettingsPage } from '../src/pages/SettingsPage.js';
import { api } from '../src/api/client.js';

beforeEach(() => {
  vi.spyOn(api, 'settings').mockResolvedValue({
    pipelineMode: 'single',
    extractionProvider: 'mistral',
    structuringProvider: 'gemini',
    structuringModel: 'gemini-2.5-flash',
    singleProvider: 'gemini',
    singleModel: 'gemini-2.5-flash',
    providers: [],
  } as any);
  vi.spyOn(api, 'revealCreds').mockResolvedValue({ credentials: {} } as any);
});

it('shows stored pipeline mode as SINGLE by default', async () => {
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText('SINGLE')).toBeTruthy());
  expect(screen.getByText(/Single — One API Call/)).toBeTruthy();
});

it('shows stored pipeline mode as SPLIT when saved', async () => {
  vi.spyOn(api, 'settings').mockResolvedValue({
    pipelineMode: 'split',
    extractionProvider: 'mistral',
    structuringProvider: 'gemini',
    structuringModel: 'gemini-2.5-flash',
    singleProvider: 'gemini',
    singleModel: 'gemini-2.5-flash',
    providers: [],
  } as any);
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText('SPLIT')).toBeTruthy());
  expect(screen.getByText(/Split — Extract \+ Structure/)).toBeTruthy();
});

it('saves pipelineMode when Save is clicked', async () => {
  const save = vi.spyOn(api, 'saveSettings').mockResolvedValue({} as any);
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getByText('Save as SINGLE mode')).toBeTruthy());
  fireEvent.click(screen.getByText('Split (2 API calls)'));
  fireEvent.click(screen.getByText('Save as SPLIT mode'));
  await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({
    pipelineMode: 'split',
  })));
});

it('shows Gemini as ADC-only and other providers with API key forms', async () => {
  render(<SettingsPage />);
  await waitFor(() => expect(screen.getAllByText('Google Gemini').length).toBeGreaterThan(0));
  expect(screen.getByText('ADC (Vertex)')).toBeTruthy();
  expect(screen.getByText(/No API key. Uses Application Default Credentials/)).toBeTruthy();
  expect(screen.getAllByText('Anthropic Claude').length).toBeGreaterThan(0);
  expect(screen.getAllByText('OpenAI GPT').length).toBeGreaterThan(0);
});
