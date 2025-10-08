// ---- Types --------------------------------------------------
export type TreatmentName = string;

export interface ExperimentConfig<T extends TreatmentName> {
  /** Optional number of hash buckets (1..n). Defaults to treatments.length */
  buckets?: number;
  /** List of treatments. Even allocation across treatments is assumed if no weights/bucketMap. */
  treatments: readonly T[];
  /** Optional salt to influence hashing (changing it reshuffles users). */
  salt?: string;
  /** Per-user overrides: userId -> treatment */
  overrides?: Record<string, T>;
  /**
   * Optional weights aligned with `treatments`. If provided, we allocate buckets
   * proportionally using Largest Remainder (Hamilton) method.
   * Example: [1, 3] with buckets=8 -> ~[2,6]
   */
  weights?: number[];
  /**
   * Optional explicit bucket map. Keys are treatments, values are bucket index arrays.
   * Must cover every bucket exactly once. If provided, this takes precedence over `weights`.
   */
  bucketMap?: Partial<Record<T, number[]>>;
}

export interface EvaluationOptions {
  /** When true, ignore overrides (useful for dry-runs). */
  ignoreOverrides?: boolean;
}

export interface Assignment<T extends TreatmentName, K extends string = string> {
  experiment: K; // experiment key
  bucket: number; // 0..(buckets-1)
  treatment: T;
  overridden: boolean; // true if forced via overrides
}

// ---- Hashing ------------------------------------------------ ------------------------------------------------
// FNV-1a 32-bit for stable, fast, reasonably uniform distribution in JS.
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5; // offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit multiply by FNV prime: 16777619
    hash = (hash + (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)) | 0;
  }
  return hash | 0; // keep 32-bit
}

export function bucketForUserId(id: string, buckets: number, salt?: string): number {
  if (buckets <= 0 || !Number.isFinite(buckets)) throw new Error('buckets must be >= 1');
  const key = salt ? `${salt}:${id}` : id;
  const h = fnv1a32(key);
  return Math.abs(h) % buckets;
}

// ---- Core Engine (static schema) ----------------------------
// S is a mapping from experiment key to the union of allowed treatments.
export class AbTestEngine<S extends Record<string, TreatmentName>> {
  private readonly configs: {
    [K in keyof S]: {
      buckets: number;
      treatments: readonly S[K][];
      salt?: string;
      overrides: Record<string, S[K]>;
      weights?: number[];
      bucketMap?: Partial<Record<S[K], number[]>>;
    };
  };

  constructor(configs: { [K in keyof S]: ExperimentConfig<S[K]> }) {
    Object.keys(configs).forEach((key) => {
      if (!key.startsWith('exp_')) {
        throw new Error(`Experiment key must start with 'exp_': ${key}`);
      }
    });

    // Normalize defaults (buckets default to treatments.length)
    this.configs = Object.fromEntries(
      (Object.keys(configs) as Array<keyof S>).map((k) => {
        const cfg = configs[k]!;
        const buckets = cfg.buckets ?? cfg.treatments.length;
        const norm = {
          buckets,
          treatments: cfg.treatments as any,
          salt: cfg.salt,
          overrides: cfg.overrides ?? {},
          weights: cfg.weights,
          bucketMap: cfg.bucketMap as any,
        };
        return [k, norm];
      })
    ) as any;

    for (const k in this.configs) {
      const cfg = this.configs[k as keyof S];
      if (!cfg.treatments.length) throw new Error(`Experiment '${String(k)}' has no treatments`);
      if (cfg.buckets < 1) throw new Error(`Experiment '${String(k)}' must have buckets >= 1`);
      // Validate optional fields
      if (cfg.weights && cfg.weights.length !== cfg.treatments.length)
        throw new Error(`Experiment '${String(k)}' weights must match treatments length`);
      if (cfg.bucketMap) this.validateBucketMap(String(k), cfg);
    }
  }

  // --- Mutators ------------------------------------------------
  updateOverrides<K extends keyof S>(key: K, overrides: Record<string, S[K]>): void {
    const cfg = this.getConfig(key);
    cfg.overrides = { ...(cfg.overrides ?? {}), ...overrides } as any;
  }

  clearOverrides<K extends keyof S>(key: K): void {
    const cfg = this.getConfig(key);
    cfg.overrides = {} as any;
  }

  setBuckets<K extends keyof S>(key: K, buckets?: number): void {
    const cfg = this.getConfig(key);
    cfg.buckets = buckets ?? cfg.treatments.length;
    if (cfg.bucketMap) this.validateBucketMap(String(key), cfg); // re-validate if explicit map present
  }

  setSalt<K extends keyof S>(key: K, salt: string): void {
    const cfg = this.getConfig(key);
    cfg.salt = salt;
  }

  setWeights<K extends keyof S>(key: K, weights?: number[]): void {
    const cfg = this.getConfig(key);
    if (weights && weights.length !== cfg.treatments.length)
      throw new Error(`Experiment '${String(key)}' weights must match treatments length`);
    cfg.weights = weights as any;
  }

  setBucketMap<K extends keyof S>(key: K, bucketMap?: Partial<Record<S[K], number[]>>): void {
    const cfg = this.getConfig(key);
    cfg.bucketMap = bucketMap as any;
    if (bucketMap) this.validateBucketMap(String(key), cfg);
  }

  // --- Evaluation ---------------------------------------------
  evaluate<K extends keyof S>(
    userId: string,
    key: K,
    options: EvaluationOptions = {}
  ): Assignment<S[K], Extract<K, string>> {
    const cfg = this.getConfig(key);

    // 1) Overrides
    const overrideT = !options.ignoreOverrides ? cfg.overrides?.[userId] : undefined;
    if (overrideT) {
      const b = bucketForUserId(userId, cfg.buckets, cfg.salt ?? String(key));
      return {
        experiment: String(key) as Extract<K, string>,
        bucket: b,
        treatment: overrideT,
        overridden: true,
      };
    }

    // 2) Deterministic bucket
    const bucket = bucketForUserId(userId, cfg.buckets, cfg.salt ?? String(key));

    // 3) Map bucket -> treatment using priority: bucketMap > weights > even split
    const tIndex = this.treatmentIndexForBucket(String(key), cfg, bucket);
    const treatment = cfg.treatments[tIndex];
    // @ts-expect-error - too lazy
    return { experiment: String(key) as Extract<K, string>, bucket, treatment, overridden: false };
  }

  evaluateAll(
    userId: string,
    options: EvaluationOptions = {}
  ): { [K in keyof S]: Assignment<S[K], Extract<K, string>> } {
    const out = {} as { [K in keyof S]: Assignment<S[K], Extract<K, string>> };
    (Object.keys(this.configs) as Array<keyof S>).forEach((key) => {
      out[key] = this.evaluate(userId, key, options);
    });
    return out;
  }

  getTreatment<K extends keyof S>(userId: string, key: K, options: EvaluationOptions = {}): S[K] {
    return this.evaluate(userId, key, options).treatment;
  }

  // --- Internals ----------------------------------------------
  private getConfig<K extends keyof S>(key: K) {
    const cfg = this.configs[key];
    if (!cfg) throw new Error(`Unknown experiment: ${String(key)}`);
    return cfg;
  }

  private validateBucketMap(
    expKey: string,
    cfg: {
      buckets: number;
      treatments: readonly string[];
      bucketMap?: Partial<Record<string, number[]>>;
    }
  ) {
    const used = new Set<number>();
    let count = 0;
    if (!cfg.bucketMap) return;
    for (const t of Object.keys(cfg.bucketMap)) {
      for (const idx of cfg.bucketMap[t] ?? []) {
        if (idx < 0 || idx >= cfg.buckets)
          throw new Error(`Experiment '${expKey}' bucketMap index ${idx} out of range`);
        if (used.has(idx))
          throw new Error(`Experiment '${expKey}' bucket ${idx} assigned multiple times`);
        used.add(idx);
        count++;
      }
    }
    if (count !== cfg.buckets)
      throw new Error(
        `Experiment '${expKey}' bucketMap must cover all ${cfg.buckets} buckets exactly once`
      );
  }

  private treatmentIndexForBucket(
    _expKey: string,
    cfg: {
      buckets: number;
      treatments: readonly string[];
      weights?: number[];
      bucketMap?: Partial<Record<string, number[]>>;
    },
    bucket: number
  ): number {
    // 1) Explicit bucket map
    if (cfg.bucketMap) {
      // We'll build a reverse lookup once per call (buckets are small). For heavier use, cache this map.
      for (let tIdx = 0; tIdx < cfg.treatments.length; tIdx++) {
        const t = cfg.treatments[tIdx];
        const arr = cfg.bucketMap[t as string];
        if (arr && arr.indexOf(bucket) !== -1) return tIdx;
      }
      // Should never reach here due to validation, but fall back just in case
    }

    // 2) Weighted via Largest Remainder (Hamilton)
    if (cfg.weights) {
      const map = this.buildWeightedAssignment(cfg.buckets, cfg.treatments.length, cfg.weights);
      return map[bucket]!;
    }

    // 3) Even split by modulo
    return bucket % cfg.treatments.length;
  }

  private buildWeightedAssignment(buckets: number, _tCount: number, weights: number[]): number[] {
    const w = weights.slice();
    const total = w.reduce((a, b) => a + (b > 0 ? b : 0), 0);
    if (total <= 0) throw new Error('weights must sum to > 0');

    // Quotas
    const raw = w.map((x) => (x > 0 ? (x / total) * buckets : 0));
    const base = raw.map((x) => Math.floor(x));
    let assigned = base.reduce((a, b) => a + b, 0);

    // Largest remainders
    const remainders = raw.map((x, i) => ({ i, r: x - base[i]! }));
    remainders.sort((a, b) => b.r - a.r);
    const allocation = base.slice();
    for (let k = 0; assigned < buckets && k < remainders.length; k++, assigned++) {
      allocation[remainders[k]!.i]!++;
    }

    // Build bucket -> treatment index array by interleaving for spread
    const result: number[] = new Array(buckets);
    const queues: number[][] = allocation.map((c, i) => Array(c).fill(i));
    let pos = 0;
    // Round-robin placement to reduce clustering
    while (pos < buckets) {
      for (let i = 0; i < queues.length && pos < buckets; i++) {
        if (queues[i]!.length) {
          result[pos++] = queues[i]!.pop()!;
        }
      }
    }
    return result;
  }
}
