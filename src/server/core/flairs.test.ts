import { settings } from '@devvit/web/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Flairs } from './flairs';

function geminiResponse(text: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text }] } }],
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

describe('Flairs.classifyIHateThisGameTomorrow', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses Gemini structured output for matching comments', async () => {
    vi.spyOn(settings, 'get').mockResolvedValue('test-google-key');
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(geminiResponse(JSON.stringify({ yes: true })));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      Flairs.classifyIHateThisGameTomorrow({ raw: 'I hate this game. See you tomorrow.' })
    ).resolves.toBe(true);

    expect(settings.get).toHaveBeenCalledWith('GOOGLE_API_KEY');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0]!;
    expect(url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent'
    );
    const body = JSON.parse(String(options?.body));
    expect(body.generationConfig).toMatchObject({
      responseMimeType: 'application/json',
      responseJsonSchema: {
        type: 'object',
        required: ['yes'],
      },
    });
  });

  it('skips Gemini when the keyword prefilter does not match', async () => {
    const fetchMock = vi.fn<typeof fetch>();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      Flairs.classifyIHateThisGameTomorrow({ raw: 'I will play again tomorrow.' })
    ).resolves.toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
