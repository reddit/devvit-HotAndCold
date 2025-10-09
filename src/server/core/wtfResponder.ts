import { z } from 'zod';
import { fn } from '../../shared/fn';
import { settings } from '@devvit/web/server';
import OpenAI from 'openai';
import { Challenge } from './challenge';
import { getWordConfigCached } from './api';

type ParsedWordsResult = {
  words: string[];
  reasoning?: string;
};

export namespace WtfResponder {
  // Internal helper: structured extraction with JSON schema. May return an empty list.
  const parseWordsFromComment = fn(
    z.object({
      raw: z.string(),
    }),
    async ({ raw }): Promise<ParsedWordsResult> => {
      const apiKey = await settings.get<string>('OPEN_AI_API_KEY');
      if (!apiKey) return { words: [] };
      const client = new OpenAI({ apiKey });
      const system = `Extract target words from a Reddit comment for a word-guessing game.
Return ONLY valid JSON that matches the provided schema. No extra text.
Choose the 1-3 most relevant lowercase words the user is explicitly asking about.
Prefer words that are in quotes or follow phrases like "the word".
If the comment does not explicitly call out any words, return an empty list.
Trim punctuation, normalize spaces, and exclude anything not a word.`;
      const user = raw;
      const completion = await client.chat.completions.create({
        model: 'gpt-5',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        reasoning_effort: 'low',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'extract_words',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                words: {
                  type: 'array',
                  minItems: 0,
                  maxItems: 3,
                  items: { type: 'string' },
                },
              },
              required: ['words'],
            },
          },
        },
      });
      const content = completion.choices?.[0]?.message?.content ?? '';
      let parsed: any = {};
      try {
        parsed = JSON.parse(content);
      } catch {
        return { words: [] };
      }
      const rawWords: string[] = Array.isArray(parsed?.words) ? parsed.words : [];
      const words = rawWords
        .filter((w) => typeof w === 'string')
        .map((w) => w.trim().toLowerCase())
        .map((w) => w.replace(/\s+/g, ' '))
        .filter((w) => /^[a-z][a-z\- ]*[a-z]$/.test(w));
      return { words: Array.from(new Set(words)).slice(0, 3) };
    }
  );

  export const explainCloseness = fn(
    z.object({
      challengeNumber: z.number().gt(0),
      raw: z.string(),
    }),
    async ({ challengeNumber, raw }) => {
      // Extract candidate word; only proceed when at least one explicit word exists
      const parsed = await parseWordsFromComment({ raw });
      const candidate = parsed.words[0];
      if (!candidate) return '';

      const challenge = await Challenge.getChallenge({ challengeNumber });
      const secret = challenge.secretWord.toLowerCase();
      const cfg = await getWordConfigCached({ word: secret });

      // Compute rank for the candidate; 1-based, -1 if not found
      const wordToRank = new Map<string, number>();
      for (let i = 0; i < cfg.similar_words.length; i++) {
        wordToRank.set(cfg.similar_words[i]!.word.toLowerCase(), i + 1);
      }
      const rank = wordToRank.get(candidate) ?? -1;

      // If not within top 500 (or not found), do not respond
      if (rank < 1 || rank > 500) {
        return '';
      }

      // System prompt constraints
      const system = `You are a witty, concise game guide for a Reddit word game called Hot & Cold.
You are given a secret word (keep it secret) and some user-proposed words with their ranks.
Rank means closeness: 1 is very close. If a word rank > 500 or -1, it was not close.
Respond in under three short sentences with a knowledgable and witty tone with how the word relates to the secret word. For example, if the word secret word is "biscuit" and the user's guess is cigarette, you would respond that it's close because there are cigarette biscuits.
`;

      const user = `Secret: ${secret}. Candidate: ${candidate}:${rank}. Explain why this word might be near the secret (or say it wasn't close). Avoid revealing the secret.`;

      const apiKey = await settings.get<string>('OPEN_AI_API_KEY');
      if (!apiKey) return '';
      const client = new OpenAI({ apiKey });
      const completion = await client.chat.completions.create({
        model: 'gpt-5',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        reasoning_effort: 'low',
      });
      let reply = completion.choices?.[0]?.message?.content ?? '';

      if (!reply) {
        return '';
      }

      // Guard against leaking the secret
      const escaped = secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`, 'i');
      if (re.test(reply)) {
        reply = reply.replace(new RegExp(secret, 'ig'), (m) => `>!${m}!<`);
      }
      return reply.trim();
    }
  );
}
