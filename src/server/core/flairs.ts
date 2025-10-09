import { z } from 'zod';
import { fn } from '../../shared/fn';
import { settings } from '@devvit/web/server';
import OpenAI from 'openai';

export namespace Flairs {
  export const FLAIRS = {
    I_HATE_THIS_GAME_SEE_YALL_TOMORROW: 'fc4fceb2-a4cd-11f0-9263-067be7a7b7da',
  } as const;

  /**
   * Lightweight LLM classifier: does this comment convey "I hate this game, see y'all tomorrow" sentiment?
   * Returns true/false. Uses JSON schema output for deterministic parsing.
   */
  export const classifyIHateThisGameTomorrow = fn(
    z.object({
      raw: z.string(),
    }),
    async ({ raw }): Promise<boolean> => {
      const text = String(raw ?? '').trim();
      if (text.length === 0) return false;
      // Cheap prefilter: only invoke LLM when both keywords appear (case-insensitive)
      const lowered = text.toLowerCase();
      if (!lowered.includes('hate') || !lowered.includes('tomorrow')) return false;

      const apiKey = await settings.get<string>('OPEN_AI_API_KEY');
      if (!apiKey) return false;

      const client = new OpenAI({ apiKey });

      const system = `You are a precise content classifier. Determine if a Reddit comment expresses the intent:
1) strong dislike of the game (e.g., "I hate this game" or close paraphrase) AND
2) intent to return the next day (e.g., "see y'all tomorrow", "see you tomorrow", "back tomorrow").
Ignore guesses or other content. Be strict; only say yes if both are clearly present.`;

      const user = text;

      const completion = await client.chat.completions.create({
        model: 'gpt-5-mini',
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        reasoning_effort: 'low',
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'ihategame_tomorrow_classifier',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                yes: { type: 'boolean' },
              },
              required: ['yes'],
            },
          },
        },
      });

      const content = completion.choices?.[0]?.message?.content ?? '';
      try {
        const parsed = JSON.parse(content);
        return Boolean(parsed?.yes === true);
      } catch {
        return false;
      }
    }
  );
}
