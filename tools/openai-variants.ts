import OpenAI from 'openai';
import { promises as fsp } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
const WORDS_NEW_DIR = join(TOOLS_DIR, '..', 'words', 'new');
const FAILURES_FILE = join(WORDS_NEW_DIR, 'lemma-map-full.failures.txt');

export function getOpenAIKey(): string {
  const key = process.env.OPENAI_API_KEY || '';
  if (!key) throw new Error('Missing OPENAI_API_KEY environment variable for openai.');
  return key;
}

async function appendFailureLemma(lemma: string): Promise<void> {
  await fsp.appendFile(FAILURES_FILE, `${lemma.toLowerCase()}\n`, 'utf8');
}

export function normalizeTokens(raw: string): string[] {
  const candidates = raw
    .split(/[\s,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const m = c.toLowerCase().match(/[a-z'-]+/);
    if (!m) continue;
    const tok = m[0]!;
    if (seen.has(tok)) continue;
    seen.add(tok);
    tokens.push(tok);
  }
  return tokens;
}

export const OPENAI_VARIANTS_SYSTEM_PROMPT = `<role>
You are a **strict morphology expander**.
Your only job is to return valid **single-word morphological expansions** of a single input lemma, or null if none exist.
Do **not** explain, justify, or add extra text.
</role>

<context_gathering>
Search depth: very low. Do not call tools or ask clarifying questions.
Bias toward acting immediately with internal knowledge; if uncertain about attestation, exclude the form.
Terminate as soon as the output string is produced.
</context_gathering>

<io_contract>
Input: exactly one lemma (base form), any casing (lowercase, Title Case, or ALL CAPS).
Output: a comma-separated string of expansions with no spaces and no labels, or exactly null.
</io_contract>

<inclusions>
Include forms **only if they are true morphological expansions of the exact lemma** (attested and tied to the base meaning).
Aggregate across categories; **deduplicate**.

- Nouns: plural and irregular plural (e.g., dog → dogs, sheep → sheep).
- Verbs: 3rd-person singular present, present participle, past tense, past participle
  (e.g., anchor → anchors,anchoring,anchored).
- Agentive nouns: productive -er/-or directly tied to the lemma,
  formed by suffixing to the lemma with only standard alternations (silent-e drop, y→i, doubling).
  (e.g., move → mover,movers; anchor → anchorer,anchorers).
- Adjectives: comparative/superlative if gradable (e.g., happy → happier,happiest).
- Adverbs: standard -ly from adjectival forms (e.g., misleading → misleadingly).
- Nominalizations: clear, attested -ness, -ment, etc., tied to the lemma’s base meaning
  (e.g., happy → happiness; move → movement,movements).
</inclusions>

<exclusions>
**Always exclude**:
- The lemma itself.
- Multi-word expressions or hyphenated compounds.
- Compounds (e.g., snakebite, snakeskin, anchorman).
- Orthographic neighbors (e.g., petition from pet, angler from angel).
- Possessives (e.g., dog’s, snakes’, anchor’s).
- Wholly new lemmas formed with affixes that change core meaning
  (e.g., immovable from move, anchorage from anchor).
- Rare/lexicalized/semantic-shifted derivatives unrelated to the base meaning
  (e.g., anchoritic, anchoredness, angelic, angelhood).
If **no valid expansions** remain, output exactly null.
</exclusions>

<casing>
**Preserve input casing pattern** across all outputs:
- lowercase → lowercase (dog → dogs)
- Title Case → Title Case (Happy → Happier,Happiest,Happiness)
- ALL CAPS → ALL CAPS (MOVE → MOVES,MOVING,MOVED,MOVER,MOVERS,MOVEMENT,MOVEMENTS)
</casing>

<formatting>
- Output **only** the CSV string: form1,form2,form3
- **No spaces**, **no commentary**, **no trailing commas**, **no quotes**.
- **Stable order** when multiple categories apply:
  **verbs → nouns → agentives → adjectives → adverbs → nominalizations**.
- **Deduplicate** exact string matches.
</formatting>

<decision_rules>
- Prefer precision over recall. When in doubt about attestation or category validity, omit.
- Do not generate verb paradigms unless the lemma is commonly used as a verb.
- Proper nouns/adjectivals with no productive morphology → null (e.g., Algonkian → null).
</decision_rules>

<self_checklist>
Before returning, verify:
1) Only single tokens; no spaces/hyphens/apostrophes.
2) Lemma itself is excluded.
3) Casing mirrors input.
4) All items are genuine morphological expansions of the same lemma.
5) If nothing valid remains → output null.
6) -er/-or forms must come directly from the lemma with only standard alternations (no angler from angel).
</self_checklist>`;

export async function getVariantsFromOpenAI(
  client: OpenAI,
  lemma: string
): Promise<{ raw: string; tokens: string[] }> {
  const maxRetries = Math.max(1, Number(process.env.CLEAN_RETRIES) || 7);
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.responses.create({
        model: 'gpt-5-mini',
        reasoning: { effort: 'minimal', summary: 'auto' },
        instructions: OPENAI_VARIANTS_SYSTEM_PROMPT,
        input: lemma.toLowerCase(),
      });
      const text = (response.output_text || '').trim();
      if (text.toLowerCase() === 'null') {
        return { raw: text, tokens: [] };
      }
      const lemmaLower = lemma.toLowerCase();
      const tokens = normalizeTokens(text)
        .map((t) => t.toLowerCase())
        .filter((t) => t !== 'null' && t !== lemmaLower);
      return { raw: text, tokens };
    } catch (err: unknown) {
      if (attempt === maxRetries) {
        try {
          await appendFailureLemma(lemma);
        } catch {}
        return { raw: 'null', tokens: [] };
      }
      const base = 400;
      const delay = base * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 200);
      await new Promise((res) => setTimeout(res, delay));
    }
  }
  return { raw: 'null', tokens: [] };
}
