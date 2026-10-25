import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { GuessJourney, CommunityProgress } from './resultsCharts';

let container: HTMLDivElement;
beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
});
afterEach(async () => {
  await act(() => render(null, container));
  container.remove();
});

it('plots earlier guesses left to right and closer ranks higher, with no invalid coordinates', async () => {
  await act(() =>
    render(
      <GuessJourney
        guesses={[
          { rank: 0, timestampMs: 40 },
          { rank: 10000, timestampMs: 10 },
          { rank: -1, timestampMs: 20 },
          { rank: 100, timestampMs: 30 },
        ]}
      />,
      container
    )
  );
  const path = container.querySelector('path[stroke^="url"]')!.getAttribute('d')!;
  const points = Array.from(path.matchAll(/[ML]([\d.]+),([\d.]+)/g), (match) => ({
    x: Number(match[1]),
    y: Number(match[2]),
  }));
  expect(points).toHaveLength(3);
  expect(points[0]!.x).toBeLessThan(points[1]!.x);
  expect(points[1]!.x).toBeLessThan(points[2]!.x);
  expect(points[0]!.y).toBeGreaterThan(points[1]!.y);
  expect(points[1]!.y).toBeGreaterThan(points[2]!.y);
  expect(container.querySelector('svg')!.getAttribute('aria-label')).toContain('Best rank 1');
  expect(path).not.toMatch(/NaN|Infinity/);
  expect(getComputedStyle(container.querySelector('stop')!).stopColor).toBe('rgb(234, 88, 12)');
  expect(getComputedStyle(container.querySelector('path[stroke^="url"]')!).strokeWidth).toBe(
    '2.5px'
  );
  expect(container.querySelectorAll('button, [tabindex]')).toHaveLength(0);
});

it('handles a single known rank or missing ranks without inventing a trend', async () => {
  await act(() => render(<GuessJourney guesses={[{ rank: 1 }]} />, container));
  expect(container.querySelectorAll('circle')).toHaveLength(1);
  expect(container.querySelector('path[stroke^="url"]')).toBeNull();
  await act(() => render(<GuessJourney guesses={[{ rank: -1 }, { rank: NaN }]} />, container));
  expect(container.textContent).toBe('');
});

it('shows a community solve rate from the supplied totals and avoids division by zero', async () => {
  await act(() => render(<CommunityProgress players={100} solves={25} />, container));
  expect(container.querySelector('[role="meter"]')!.getAttribute('aria-valuenow')).toBe('25');
  expect(container.textContent).toContain('25 of 100 Players Solved');
  await act(() => render(<CommunityProgress players={0} solves={0} />, container));
  expect(container.querySelector('[role="meter"]')).toBeNull();
});
