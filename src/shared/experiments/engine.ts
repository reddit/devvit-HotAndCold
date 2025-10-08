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

/** Deterministic uniform [0,1) from userId and optional salt */
function uniform01FromId(id: string, salt?: string): number {
  const key = salt ? `${salt}:${id}` : id;
  const h = fnv1a32(key) >>> 0; // unsigned 32-bit
  return h / 4294967296; // 2^32
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
        };
        return [k, norm];
      })
    ) as any;

    for (const k in this.configs) {
      const cfg = this.configs[k as keyof S];
      if (!cfg.treatments.length) throw new Error(`Experiment '${String(k)}' has no treatments`);
      if (cfg.buckets < 1) throw new Error(`Experiment '${String(k)}' must have buckets >= 1`);
      // no extra validation in simplified engine
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
  }

  setSalt<K extends keyof S>(key: K, salt: string): void {
    const cfg = this.getConfig(key);
    cfg.salt = salt;
  }

  // weights and bucketMap removed in simplified engine

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

    // 2) Deterministic bucket and per-user uniform random value
    const salt = cfg.salt ?? String(key);
    const bucket = bucketForUserId(userId, cfg.buckets, salt);
    const u = uniform01FromId(userId, salt);

    // 3) Map -> treatment using unbiased split by u
    const tIndex = this.treatmentIndexForUser(String(key), cfg, u);
    const treatment = cfg.treatments[tIndex] as S[K];
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

  // bucketMap removed

  private treatmentIndexForUser(
    _expKey: string,
    cfg: {
      buckets: number;
      treatments: readonly string[];
    },
    u: number
  ): number {
    // Even split using unbiased thresholding on u
    const idx = Math.floor(u * cfg.treatments.length);
    return idx < cfg.treatments.length ? idx : cfg.treatments.length - 1;
  }

  // (no other internals)
}
