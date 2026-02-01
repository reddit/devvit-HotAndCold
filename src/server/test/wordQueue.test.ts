import { expect } from 'vitest';
import { it, resetRedis } from './devvitTest';
import { WordQueue } from '../core/wordQueue';

function makeChallenge(word: string): WordQueue.Challenge {
  return { word };
}

it('WordQueue: FIFO append and shift preserves order', async () => {
  await resetRedis();
  await WordQueue.clear({});
  const c1 = makeChallenge('one');
  const c2 = makeChallenge('three');
  const c3 = makeChallenge('five');

  await WordQueue.append({ challenge: c1 });
  await WordQueue.append({ challenge: c2 });
  await WordQueue.append({ challenge: c3 });

  expect(await WordQueue.size({})).toBe(3);

  const s1 = await WordQueue.shift({});
  const s2 = await WordQueue.shift({});
  const s3 = await WordQueue.shift({});
  const s4 = await WordQueue.shift({});

  expect(s1?.word).toBe('one');
  expect(s2?.word).toBe('three');
  expect(s3?.word).toBe('five');
  expect(s4).toBeNull();
  expect(await WordQueue.size({})).toBe(0);
});

it('WordQueue: prepend puts item at the front', async () => {
  await resetRedis();
  await WordQueue.clear({});
  const c1 = makeChallenge('ten');
  const c2 = makeChallenge('twelve');
  const c0 = makeChallenge('eight');

  await WordQueue.append({ challenge: c1 });
  await WordQueue.append({ challenge: c2 });
  await WordQueue.prepend({ challenge: c0 });

  expect(await WordQueue.size({})).toBe(3);
  const s1 = await WordQueue.shift({});
  const s2 = await WordQueue.shift({});
  const s3 = await WordQueue.shift({});

  expect(s1?.word).toBe('eight');
  expect(s2?.word).toBe('ten');
  expect(s3?.word).toBe('twelve');
});

it('WordQueue: overwrite replaces the entire queue with validated problems', async () => {
  await resetRedis();
  await WordQueue.clear({});
  const c1 = makeChallenge('twenty');
  const c2 = makeChallenge('twenty-two');
  const c3 = makeChallenge('twenty-four');

  await WordQueue.append({ challenge: c1 });
  await WordQueue.append({ challenge: c2 });

  await WordQueue.overwrite({ challenges: [c3, c2, c1] });

  expect(await WordQueue.size({})).toBe(3);
  const all = await WordQueue.peekAll({});
  expect(all.map((c) => c.word)).toEqual(['twenty-four', 'twenty-two', 'twenty']);
});

it('WordQueue: clear empties the queue', async () => {
  await resetRedis();
  await WordQueue.clear({});
  await WordQueue.append({ challenge: makeChallenge('thirty') });
  await WordQueue.append({ challenge: makeChallenge('thirty-two') });
  expect(await WordQueue.size({})).toBe(2);
  await WordQueue.clear({});
  expect(await WordQueue.size({})).toBe(0);
  expect(await WordQueue.shift({})).toBeNull();
});

it('WordQueue: validation rejects invalid problems on append/prepend/overwrite', async () => {
  await resetRedis();
  await WordQueue.clear({});
  const invalidMissingWord: any = {}; // missing required 'word'
  const invalidWrongType: any = { word: 123 }; // wrong type for 'word'

  expect(() => WordQueue.append({ challenge: invalidMissingWord })).toThrow();
  expect(() => WordQueue.prepend({ challenge: invalidMissingWord })).toThrow();
  expect(() => WordQueue.overwrite({ challenges: [invalidMissingWord] })).toThrow();

  expect(() => WordQueue.append({ challenge: invalidWrongType })).toThrow();
  expect(() => WordQueue.prepend({ challenge: invalidWrongType })).toThrow();
  expect(() => WordQueue.overwrite({ challenges: [invalidWrongType] })).toThrow();

  expect(await WordQueue.size({})).toBe(0);
});
