import { describe, it, expect } from 'vitest';
import { SpoilerGuard } from './spoilerGuard';

describe('SpoilerGuard.revealsSecret', () => {
  it('returns false when the secret only appears inside a spoiler block', async () => {
    const text = 'foo bar >!hello world secret word!< baz';
    const result = await SpoilerGuard.revealsSecret({ text, secretWord: 'secret word' });
    expect(result).toBe(false);
  });

  it('returns false when the secret only appears inside a spoiler block', async () => {
    const text = 'foo bar >!secret word or something!< baz';
    const result = await SpoilerGuard.revealsSecret({ text, secretWord: 'secret word' });
    expect(result).toBe(false);
  });

  it('returns true when the secret appears plainly outside spoiler blocks', async () => {
    const text = 'foo bar secret word baz';
    const result = await SpoilerGuard.revealsSecret({ text, secretWord: 'secret word' });
    expect(result).toBe(true);
  });

  it('is word-boundary aware (does not match substrings)', async () => {
    const text = 'mysecretword is not the same';
    const result = await SpoilerGuard.revealsSecret({ text, secretWord: 'secret word' });
    expect(result).toBe(false);
  });

  it('ignores case and punctuation around boundaries', async () => {
    const text = 'Foo, SECRET Word!';
    const result = await SpoilerGuard.revealsSecret({ text, secretWord: 'secret word' });
    expect(result).toBe(true);
  });

  it('handles multiple spoiler blocks and mixed content', async () => {
    const text = 'alpha >!secret word!< beta >!noise!< gamma';
    const result = await SpoilerGuard.revealsSecret({ text, secretWord: 'secret word' });
    expect(result).toBe(false);
  });

  it('returns true if secret appears outside spoilers even if also inside', async () => {
    const text = 'outside secret word and >!secret word!< inside';
    const result = await SpoilerGuard.revealsSecret({ text, secretWord: 'secret word' });
    expect(result).toBe(true);
  });

  it('does not false-positive across spoiler delimiters', async () => {
    const text = 'secret >! word!<';
    const result = await SpoilerGuard.revealsSecret({ text, secretWord: 'secret word' });
    expect(result).toBe(false);
  });
});
