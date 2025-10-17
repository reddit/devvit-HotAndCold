import { expect, vi } from 'vitest';
import { it, resetRedis } from '../../test/devvitTest';
import { HordeWordQueue } from './wordQueue.horde';

function makeChallenge(words: string[]): HordeWordQueue.Challenge {
  return { words };
}

it('HordeWordQueue: FIFO append and shift preserves order', async () => {
  await resetRedis();
  await HordeWordQueue.clear();
  const c1 = makeChallenge(['one', 'uno']);
  const c2 = makeChallenge(['three']);
  const c3 = makeChallenge(['five', 'cinco', 'V']);

  // Use fake timers to ensure Date.now() increases between appends
  vi.useFakeTimers();
  vi.setSystemTime(1);
  await HordeWordQueue.append({ challenge: c1 });
  vi.setSystemTime(2);
  await HordeWordQueue.append({ challenge: c2 });
  vi.setSystemTime(3);
  await HordeWordQueue.append({ challenge: c3 });
  vi.useRealTimers();

  expect(await HordeWordQueue.size()).toBe(3);

  const s1 = await HordeWordQueue.shift();
  const s2 = await HordeWordQueue.shift();
  const s3 = await HordeWordQueue.shift();
  const s4 = await HordeWordQueue.shift();

  expect(s1?.words).toEqual(['one', 'uno']);
  expect(s2?.words).toEqual(['three']);
  expect(s3?.words).toEqual(['five', 'cinco', 'V']);
  expect(s4).toBeNull();
  expect(await HordeWordQueue.size()).toBe(0);
});

it('HordeWordQueue: prepend puts item at the front', async () => {
  await resetRedis();
  await HordeWordQueue.clear();
  const c1 = makeChallenge(['ten']);
  const c2 = makeChallenge(['twelve']);
  const c0 = makeChallenge(['eight', 'ocho']);

  await HordeWordQueue.append({ challenge: c1 });
  await HordeWordQueue.append({ challenge: c2 });
  await HordeWordQueue.prepend({ challenge: c0 });

  expect(await HordeWordQueue.size()).toBe(3);
  const s1 = await HordeWordQueue.shift();
  const s2 = await HordeWordQueue.shift();
  const s3 = await HordeWordQueue.shift();

  expect(s1?.words).toEqual(['eight', 'ocho']);
  expect(s2?.words).toEqual(['ten']);
  expect(s3?.words).toEqual(['twelve']);
});

it('HordeWordQueue: overwrite replaces the entire queue with validated problems', async () => {
  await resetRedis();
  await HordeWordQueue.clear();
  const c1 = makeChallenge(['twenty']);
  const c2 = makeChallenge(['twenty-two']);
  const c3 = makeChallenge(['twenty-four']);

  await HordeWordQueue.append({ challenge: c1 });
  await HordeWordQueue.append({ challenge: c2 });

  await HordeWordQueue.overwrite({ challenges: [c3, c2, c1] });

  expect(await HordeWordQueue.size()).toBe(3);
  const all = await HordeWordQueue.peekAll();
  expect(all.map((c) => c.words)).toEqual([['twenty-four'], ['twenty-two'], ['twenty']]);
});

it('HordeWordQueue: clear empties the queue', async () => {
  await resetRedis();
  await HordeWordQueue.clear();
  await HordeWordQueue.append({ challenge: makeChallenge(['thirty']) });
  await HordeWordQueue.append({ challenge: makeChallenge(['thirty-two']) });
  expect(await HordeWordQueue.size()).toBe(2);
  await HordeWordQueue.clear();
  expect(await HordeWordQueue.size()).toBe(0);
  expect(await HordeWordQueue.shift()).toBeNull();
});

it('HordeWordQueue: validation rejects invalid problems on append/prepend/overwrite', async () => {
  await resetRedis();
  await HordeWordQueue.clear();
  const invalidMissing: any = {}; // missing required 'words'
  const invalidWrongType: any = { words: 'not-an-array' }; // wrong type
  const invalidEmptyArray: any = { words: [] }; // min(1)
  const invalidBadMember: any = { words: ['ok', ''] }; // empty string not allowed

  expect(() => HordeWordQueue.append({ challenge: invalidMissing })).toThrow();
  expect(() => HordeWordQueue.prepend({ challenge: invalidMissing })).toThrow();
  expect(() => HordeWordQueue.overwrite({ challenges: [invalidMissing] })).toThrow();

  expect(() => HordeWordQueue.append({ challenge: invalidWrongType })).toThrow();
  expect(() => HordeWordQueue.prepend({ challenge: invalidWrongType })).toThrow();
  expect(() => HordeWordQueue.overwrite({ challenges: [invalidWrongType] })).toThrow();

  expect(() => HordeWordQueue.append({ challenge: invalidEmptyArray })).toThrow();
  expect(() => HordeWordQueue.prepend({ challenge: invalidEmptyArray })).toThrow();
  expect(() => HordeWordQueue.overwrite({ challenges: [invalidEmptyArray] })).toThrow();

  expect(() => HordeWordQueue.append({ challenge: invalidBadMember })).toThrow();
  expect(() => HordeWordQueue.prepend({ challenge: invalidBadMember })).toThrow();
  expect(() => HordeWordQueue.overwrite({ challenges: [invalidBadMember] })).toThrow();

  expect(await HordeWordQueue.size()).toBe(0);
});
