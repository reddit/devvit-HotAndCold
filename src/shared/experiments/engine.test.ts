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
    // @ts-expect-error testing runtime validation
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
          // @ts-expect-error intentional bad key
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

  it('validates weights length matches treatments', () => {
    expect(
      () =>
        new AbTestEngine({
          exp_t: { treatments: ['A', 'B'], weights: [1] },
        })
    ).toThrow(/weights/);
  });

  it('validates bucketMap covers all buckets without duplicates and in range', () => {
    // Out of range
    expect(
      () =>
        new AbTestEngine({
          exp_t: {
            treatments: ['A', 'B'],
            buckets: 4,
            bucketMap: { A: [0, 4], B: [1, 2] },
          },
        })
    ).toThrow(/out of range/);

    // Duplicate bucket across treatments
    expect(
      () =>
        new AbTestEngine({
          exp_t: {
            treatments: ['A', 'B'],
            buckets: 3,
            bucketMap: { A: [0, 1], B: [1] },
          },
        })
    ).toThrow(/assigned multiple times/);

    // Incomplete coverage
    expect(
      () =>
        new AbTestEngine({
          exp_t: {
            treatments: ['A', 'B'],
            buckets: 3,
            bucketMap: { A: [0], B: [2] },
          },
        })
    ).toThrow(/must cover all/);
  });
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

  it('evenly splits treatments by modulo when no weights or bucketMap', () => {
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

  it('honors weights using Largest Remainder (Hamilton) method', () => {
    const engine = new AbTestEngine({
      exp_test: { treatments: ['A', 'B'] as const, buckets: 200, weights: [1, 3] },
    });
    const ids = generateUserIds(40_000);
    const counts: Record<string, number> = { A: 0, B: 0 };
    for (const id of ids) {
      counts[engine.getTreatment(id, 'exp_test')]++;
    }
    const total = counts.A + counts.B;
    const shareA = counts.A / total;
    const shareB = counts.B / total;
    expect(shareA).toBeGreaterThan(0.2);
    expect(shareA).toBeLessThan(0.35);
    expect(shareB).toBeGreaterThan(0.65);
    expect(shareB).toBeLessThan(0.8);
  }, 15000);

  it('prefers bucketMap over weights when both provided', () => {
    const buckets = 20;
    const evenBuckets = Array.from({ length: buckets / 2 }, (_, i) => i * 2);
    const oddBuckets = Array.from({ length: buckets / 2 }, (_, i) => i * 2 + 1);
    const engine = new AbTestEngine({
      exp_test: {
        treatments: ['A', 'B'] as const,
        buckets,
        weights: [1, 9],
        bucketMap: { A: evenBuckets, B: oddBuckets },
      },
    });
    const ids = generateUserIds(20_000);
    const counts: Record<string, number> = { A: 0, B: 0 };
    for (const id of ids) counts[engine.getTreatment(id, 'exp_test')]++;

    const total = counts.A + counts.B;
    const shareA = counts.A / total;
    const shareB = counts.B / total;
    // Expect near 50/50 because bucketMap splits evenly; allow 10% tolerance
    expect(Math.abs(shareA - 0.5)).toBeLessThan(0.1);
    expect(Math.abs(shareB - 0.5)).toBeLessThan(0.1);
  }, 15000);

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

  it('setWeights validates length', () => {
    const engine = new AbTestEngine({ exp_t: { treatments: ['A', 'B'] as const } });
    expect(() => engine.setWeights('exp_t', [1])).toThrow(/weights/);
    // valid
    engine.setWeights('exp_t', [1, 2]);
  });

  it('setBucketMap re-validates when buckets change', () => {
    const engine = new AbTestEngine({
      exp_t: {
        treatments: ['A', 'B'] as const,
        buckets: 4,
        bucketMap: { A: [0, 1], B: [2, 3] },
      },
    });
    // Increasing buckets with existing bucketMap should fail validation
    expect(() => engine.setBuckets('exp_t', 6)).toThrow(/must cover all/);
    // Changing bucketMap to match new buckets should succeed
    engine.setBucketMap('exp_t', { A: [0, 1, 2], B: [3, 4, 5] });
    engine.setBuckets('exp_t', 6); // revalidate passes now
  });
});
