import * as trpcNext from '@trpc/server/adapters/next';

export async function createContext(_options: trpcNext.CreateNextContextOptions) {
  return {};
}
export type Context = Awaited<ReturnType<typeof createContext>>;
