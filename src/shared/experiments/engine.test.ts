import { describe, it, expect } from 'vitest';
import { AbTestEngine, bucketForUserId } from './engine';

function generateUserIds(count: number, prefix = 't2'): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}_${i}`);
}

function distribution(counts: number[]) {
  const total = counts.reduce((a, b) => a + b, 0);
  const mean = total / counts.length;
  const maxDev = Math.max(...counts.map((c) => Math.abs(c - mean)));
  const relMaxDev = maxDev / mean;
  return { total, mean, maxDev, relMaxDev };
}

describe('bucketForUserId', () => {
  it('throws on invalid bucket counts', () => {
    expect(() => bucketForUserId('x', 0)).toThrow();
    expect(() => bucketForUserId('x', -1)).toThrow();
    expect(() => bucketForUserId('x', Number.NaN)).toThrow();
  });

  it('is deterministic for the same id and salt', () => {
    const ids = generateUserIds(1000);
    for (const id of ids) {
      const a = bucketForUserId(id, 97, 'salt');
      const b = bucketForUserId(id, 97, 'salt');
      expect(a).toBe(b);
    }
  });

  it('changes mapping when salt changes (for most users)', () => {
    const ids = generateUserIds(5000);
    let changed = 0;
    for (const id of ids) {
      const a = bucketForUserId(id, 211, 'saltA');
      const b = bucketForUserId(id, 211, 'saltB');
      if (a !== b) changed++;
    }
    // Expect majority to change buckets when salt changes
    expect(changed / ids.length).toBeGreaterThan(0.6);
  });

  it('is roughly uniform across buckets', () => {
    const buckets = 128;
    const ids = generateUserIds(40_000);
    const counts = new Array(buckets).fill(0);
    for (const id of ids) {
      counts[bucketForUserId(id, buckets, 'uniformity')]++;
    }
    const stats = distribution(counts);
    // 1) Relative standard deviation should be near theoretical sqrt((k-1)/n)
    const mean = stats.mean;
    const variance = counts.reduce((acc, c) => acc + (c - mean) * (c - mean), 0) / counts.length;
    const stddev = Math.sqrt(variance);
    const relStd = stddev / mean; // expected ≈ sqrt((k-1)/n) ≈ 5.6% for n=40k, k=128
    expect(relStd).toBeLessThan(0.08);

    // 2) Chi-squared goodness-of-fit vs uniform distribution
    const expected = mean; // n/k
    const chi2 = counts.reduce((acc, c) => acc + ((c - expected) * (c - expected)) / expected, 0);
    // df = buckets - 1 = 127; critical ~ 164 (99%), ~153 (95%). Keep margin.
    expect(chi2).toBeLessThan(180);
  }, 15000);
});

describe('AbTestEngine constructor validation', () => {
  it("requires experiment keys to start with 'exp_'", () => {
    expect(
      () =>
        new AbTestEngine({
          bad_key: { treatments: ['A', 'B'] },
        })
    ).toThrow(/exp_/);
  });

  it('requires at least one treatment', () => {
    expect(() => new AbTestEngine({ exp_t: { treatments: [] as string[] } })).toThrow(
      /no treatments/
    );
  });

  it('rejects buckets < 1', () => {
    expect(
      () =>
        new AbTestEngine({
          exp_t: { treatments: ['A', 'B'], buckets: 0 },
        })
    ).toThrow(/buckets/);
  });

  // weights and bucketMap removed in simplified engine
});

describe('AbTestEngine evaluation', () => {
  it('applies overrides unless ignoreOverrides is true', () => {
    const engine = new AbTestEngine({
      exp_test: {
        treatments: ['A', 'B'] as const,
        buckets: 10,
        overrides: { u1: 'B' },
      },
    });

    const a = engine.evaluate('u1', 'exp_test');
    expect(a.treatment).toBe('B');
    expect(a.overridden).toBe(true);

    const b = engine.evaluate('u1', 'exp_test', { ignoreOverrides: true });
    expect(b.treatment).toMatch(/A|B/);
    expect(b.overridden).toBe(false);
  });

  it('evenly splits treatments when unweighted', () => {
    const engine = new AbTestEngine({
      exp_test: { treatments: ['A', 'B', 'C'] as const, buckets: 90 },
    });
    const ids = generateUserIds(30_000);
    const counts: Record<string, number> = { A: 0, B: 0, C: 0 };
    for (const id of ids) {
      counts[engine.getTreatment(id, 'exp_test')]++;
    }
    const arr = [counts.A, counts.B, counts.C];
    const stats = distribution(arr);
    // Expect roughly 1/3 each within 12%
    expect(stats.relMaxDev).toBeLessThan(0.12);
  }, 15000);
  // weights and bucketMap behavior removed

  it('evaluateAll returns assignments for all experiments', () => {
    const engine = new AbTestEngine({
      exp_a: { treatments: ['X', 'Y'] as const, buckets: 10 },
      exp_b: { treatments: ['C'] as const, buckets: 1 },
    });
    const out = engine.evaluateAll('marco');
    expect(out.exp_a).toBeDefined();
    expect(out.exp_b).toBeDefined();
    expect(out.exp_b.treatment).toBe('C');
  });

  it('getTreatment matches evaluate().treatment', () => {
    const engine = new AbTestEngine({ exp_a: { treatments: ['X', 'Y'] as const } });
    const a = engine.evaluate('abc', 'exp_a');
    const t = engine.getTreatment('abc', 'exp_a');
    expect(t).toBe(a.treatment);
  });
});

describe('AbTestEngine mutators', () => {
  it('updateOverrides merges and clearOverrides resets', () => {
    const engine = new AbTestEngine({
      exp_t: { treatments: ['A', 'B'] as const, overrides: { u1: 'A' } },
    });
    engine.updateOverrides('exp_t', { u2: 'B' });
    expect(engine.evaluate('u1', 'exp_t').treatment).toBe('A');
    expect(engine.evaluate('u2', 'exp_t').treatment).toBe('B');
    engine.clearOverrides('exp_t');
    expect(engine.evaluate('u1', 'exp_t').overridden).toBe(false);
  });

  it('setSalt reshuffles buckets for a user', () => {
    const engine = new AbTestEngine({ exp_t: { treatments: ['A', 'B'] as const, buckets: 97 } });
    const before = engine.evaluate('zoe', 'exp_t').bucket;
    engine.setSalt('exp_t', 'new-salt');
    const after = engine.evaluate('zoe', 'exp_t').bucket;
    expect(before).not.toBe(after);
  });

  // setWeights and setBucketMap removed in simplified engine
});
