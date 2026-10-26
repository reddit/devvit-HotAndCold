import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { GuessJourney, CommunityProgress, StandingsScores } from './resultsCharts';
import '../index.css';

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

it('shows solved, Give Up, and unfinished totals in one compact chart', async () => {
  await act(() => render(<CommunityProgress players={100} solves={25} giveUps={15} />, container));
  const chart = container.querySelector('[role="img"]')!;
  expect(chart.getAttribute('aria-label')).toContain('25 solved, 15 gave up, 60 unfinished');
  expect(container.textContent).toContain('25% Solve Rate');
  expect(Array.from(chart.children, (child) => (child as HTMLElement).style.width)).toEqual([
    '25%',
    '15%',
    '60%',
  ]);
  expect(chart.getBoundingClientRect().height).toBe(12);
  expect(container.querySelectorAll('button, [tabindex]')).toHaveLength(0);
  await act(() => render(<CommunityProgress players={0} solves={0} />, container));
  expect(container.querySelector('[role="img"]')).toBeNull();
});

it('keeps older or temporarily inconsistent counters inside the chart bounds', async () => {
  await act(() => render(<CommunityProgress players={10} solves={20} giveUps={-1} />, container));
  const chart = container.querySelector('[role="img"]')!;
  expect(Array.from(chart.children, (child) => (child as HTMLElement).style.width)).toEqual([
    '100%',
    '0%',
    '0%',
  ]);
  await act(() => render(<CommunityProgress players={NaN} solves={25} />, container));
  expect(container.querySelector('[role="img"]')).toBeNull();
});

it('charts only the supplied leaderboard page, highlights the player, and starts scores at zero', async () => {
  await act(() =>
    render(
      <StandingsScores
        entries={[
          { member: 'first', score: 100 },
          { member: 'me', score: 50 },
          { member: 'last', score: 0 },
        ]}
        currentUsername="me"
      />,
      container
    )
  );
  const chart = container.querySelector('svg')!;
  const bars = Array.from(chart.querySelectorAll('rect'));
  expect(chart.getAttribute('aria-label')).toContain('top 3 finishers');
  expect(chart.getAttribute('aria-label')).toContain('Your position in this chart: 2');
  expect(chart.getAttribute('aria-label')).toContain('Scores start at zero');
  expect(Number(bars[1]!.getAttribute('height'))).toBe(Number(bars[0]!.getAttribute('height')) / 2);
  expect(Number(bars[2]!.getAttribute('height'))).toBe(0);
  expect(bars[1]!.getAttribute('class')).toContain('orange');
  expect(bars[0]!.getAttribute('class')).toContain('cyan');
  expect(chart.getBoundingClientRect().height).toBe(56);
  expect(container.querySelectorAll('button, [tabindex]')).toHaveLength(0);
});

it('handles one finisher, zero scores, missing players, and empty standings without invented trends', async () => {
  await act(() =>
    render(
      <StandingsScores entries={[{ member: 'only', score: 0 }]} currentUsername="off-page" />,
      container
    )
  );
  expect(container.querySelectorAll('rect')).toHaveLength(1);
  expect(container.textContent).toContain('Top 1 Finisher');
  expect(container.textContent).not.toContain('You');
  expect(container.innerHTML).not.toMatch(/NaN|Infinity/);
  await act(() => render(<StandingsScores entries={[]} />, container));
  expect(container.querySelector('svg')).toBeNull();
  await act(() =>
    render(<StandingsScores entries={[{ member: 'invalid', score: NaN }]} />, container)
  );
  expect(container.querySelector('svg')).toBeNull();
});
