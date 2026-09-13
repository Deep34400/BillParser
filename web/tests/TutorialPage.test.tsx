import { it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import TutorialPage from '../src/pages/TutorialPage.js';
import { TUTORIAL_SLIDES } from '../src/pages/tutorialSlides.js';

function renderTour() {
  return render(
    <MemoryRouter>
      <TutorialPage />
    </MemoryRouter>,
  );
}

it('covers upload, detail, analytics, and API key', () => {
  const ids = TUTORIAL_SLIDES.map((s) => s.id);
  expect(ids).toEqual(['list', 'upload', 'process', 'detail', 'fields', 'analytics', 'apikey', 'done']);
  expect(TUTORIAL_SLIDES.some((s) => /API key/i.test(s.title))).toBe(true);
  expect(TUTORIAL_SLIDES.some((s) => /analytics|spend/i.test(`${s.title} ${s.narrate}`))).toBe(true);
});

it('renders the first slide and can jump to API key', () => {
  renderTour();
  expect(screen.getByText('Watch how Carrum works')).toBeTruthy();
  expect(screen.getByText('Your invoices')).toBeTruthy();

  fireEvent.click(screen.getByRole('button', { name: /7\. Account/ }));
  expect(screen.getByText('Get your API key')).toBeTruthy();
  expect(screen.getAllByText(/Generate Key/).length).toBeGreaterThan(0);
  expect(screen.getByText(/inv_8f2a/)).toBeTruthy();
  expect(document.body.textContent).toMatch(/x-api-key/);
});

it('can jump to analytics', () => {
  renderTour();
  fireEvent.click(screen.getByRole('button', { name: /6\. Analytics/ }));
  expect(screen.getByText('See spend and charts')).toBeTruthy();
  expect(screen.getByText('Total spend')).toBeTruthy();
  expect(screen.getByText('Workshops')).toBeTruthy();
});
