type JsonSchema = Record<string, unknown>;

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thought?: boolean;
      }>;
    };
  }>;
};

type GeminiErrorResponse = {
  error?: {
    code?: number | string;
    message?: string;
    status?: string;
  };
};

const GEMINI_MODEL = 'gemini-3.6-flash';
const GEMINI_GENERATE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

export async function generateGeminiContent({
  apiKey,
  system,
  user,
  responseJsonSchema,
}: {
  apiKey: string;
  system: string;
  user: string;
  responseJsonSchema?: JsonSchema;
}): Promise<string> {
  const response = await fetch(GEMINI_GENERATE_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: system }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: user }],
        },
      ],
      generationConfig: {
        maxOutputTokens: 512,
        thinkingConfig: {
          thinkingLevel: 'low',
        },
        ...(responseJsonSchema
          ? {
              responseMimeType: 'application/json',
              responseJsonSchema,
            }
          : {}),
      },
    }),
  });

  if (!response.ok) {
    const rawError = await response.text();
    let detail = '';
    try {
      const errorResponse = JSON.parse(rawError) as GeminiErrorResponse;
      detail = [errorResponse.error?.status, errorResponse.error?.message]
        .filter((value): value is string => typeof value === 'string' && value.length > 0)
        .join(': ');
    } catch {
      detail = rawError.trim().slice(0, 300);
    }
    detail = detail.replaceAll(apiKey, '[redacted]');
    throw new Error(
      `Gemini API request failed with HTTP ${response.status}${detail ? ` (${detail})` : ''}`
    );
  }

  const data = (await response.json()) as GeminiResponse;
  return (
    data.candidates?.[0]?.content?.parts
      ?.filter((part) => part.thought !== true && typeof part.text === 'string')
      .map((part) => part.text)
      .join('')
      .trim() ?? ''
  );
}
