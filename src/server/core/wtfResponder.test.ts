import { settings } from '@devvit/web/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as api from './api';
import { Challenge } from './challenge';
import { WtfResponder } from './wtfResponder';

function geminiResponse(parts: Array<{ text: string; thought?: boolean }>): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts } }],
    }),
    {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }
  );
}

describe('WtfResponder.explainCloseness', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses Gemini 3.6 Flash for extraction and the explanation', async () => {
    vi.spyOn(settings, 'get').mockResolvedValue('test-google-key');
    vi.spyOn(Challenge, 'getChallenge').mockResolvedValue({
      secretWord: 'biscuit',
    } as Awaited<ReturnType<typeof Challenge.getChallenge>>);
    vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({
      similar_words: [{ word: 'cigarette' }],
    } as Awaited<ReturnType<typeof api.getWordConfigCached>>);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(geminiResponse([{ text: JSON.stringify({ words: ['cigarette'] }) }]))
      .mockResolvedValueOnce(
        geminiResponse([
          { text: 'Hidden reasoning', thought: true },
          { text: 'The connection comes from a particular rolled wafer snack.' },
        ])
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      WtfResponder.explainCloseness({ challengeNumber: 42, raw: 'Why is cigarette close?' })
    ).resolves.toBe('The connection comes from a particular rolled wafer snack.');

    expect(settings.get).toHaveBeenCalledTimes(2);
    expect(settings.get).toHaveBeenCalledWith('GOOGLE_API_KEY');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    for (const [url, options] of fetchMock.mock.calls) {
      expect(url).toBe(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent'
      );
      expect(options?.headers).toMatchObject({
        'Content-Type': 'application/json',
        'x-goog-api-key': 'test-google-key',
      });
    }

    const extractionBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(extractionBody.generationConfig).toMatchObject({
      thinkingConfig: { thinkingLevel: 'low' },
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        required: ['words'],
      },
    });

    const explanationBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body));
    expect(explanationBody.contents[0].parts[0].text).toContain('Secret word: "biscuit"');
    expect(explanationBody.generationConfig.responseMimeType).toBeUndefined();
  });

  it('parses the standard !wtf word form without an extraction request', async () => {
    vi.spyOn(settings, 'get').mockResolvedValue('test-google-key');
    vi.spyOn(Challenge, 'getChallenge').mockResolvedValue({
      secretWord: 'reference',
    } as Awaited<ReturnType<typeof Challenge.getChallenge>>);
    vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({
      similar_words: [{ word: 'dictionary' }],
    } as Awaited<ReturnType<typeof api.getWordConfigCached>>);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        geminiResponse([{ text: 'It belongs in the same informational aisle.' }])
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      WtfResponder.explainCloseness({ challengeNumber: 42, raw: '!wtf dictionary' })
    ).resolves.toBe('It belongs in the same informational aisle.');

    expect(settings.get).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const explanationBody = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
    expect(explanationBody.contents[0].parts[0].text).toContain('Candidate guess: "dictionary"');
    expect(explanationBody.generationConfig.responseMimeType).toBeUndefined();
  });

  it('responds deterministically when the candidate is outside the top 500', async () => {
    vi.spyOn(Challenge, 'getChallenge').mockResolvedValue({
      secretWord: 'reference',
    } as Awaited<ReturnType<typeof Challenge.getChallenge>>);
    vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({
      similar_words: [
        ...Array.from({ length: 500 }, (_, index) => ({ word: `closer-${index}` })),
        { word: 'dictionary' },
      ],
    } as Awaited<ReturnType<typeof api.getWordConfigCached>>);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      WtfResponder.explainCloseness({ challengeNumber: 42, raw: '!wtf dictionary' })
    ).resolves.toBe(
      "“dictionary” is ranked #501, outside the top 500—so it isn't especially close today."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('responds deterministically when the candidate is not ranked', async () => {
    vi.spyOn(Challenge, 'getChallenge').mockResolvedValue({
      secretWord: 'reference',
    } as Awaited<ReturnType<typeof Challenge.getChallenge>>);
    vi.spyOn(api, 'getWordConfigCached').mockResolvedValue({
      similar_words: [],
    } as Awaited<ReturnType<typeof api.getWordConfigCached>>);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      WtfResponder.explainCloseness({ challengeNumber: 42, raw: '!wtf dictionary' })
    ).resolves.toBe(
      "“dictionary” isn't in today's ranked word list, so I can't explain a connection for it."
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing when GOOGLE_API_KEY is not configured', async () => {
    vi.spyOn(settings, 'get').mockResolvedValue(undefined);
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      WtfResponder.explainCloseness({ challengeNumber: 42, raw: 'Why is cigarette close?' })
    ).resolves.toBe('');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('surfaces Gemini error details without exposing the API key', async () => {
    vi.spyOn(settings, 'get').mockResolvedValue('secret-google-key');
    vi.stubGlobal(
      'fetch',
      vi.fn<typeof fetch>().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 403,
              status: 'PERMISSION_DENIED',
              message: 'API key secret-google-key does not have access.',
            },
          }),
          { status: 403, headers: { 'Content-Type': 'application/json' } }
        )
      )
    );

    await expect(
      WtfResponder.explainCloseness({ challengeNumber: 42, raw: 'Why is cigarette close?' })
    ).rejects.toThrow('HTTP 403 (PERMISSION_DENIED: API key [redacted] does not have access.)');
  });
});
