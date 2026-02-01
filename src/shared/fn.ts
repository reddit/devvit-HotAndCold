import { ZodError, z } from 'zod/v4';

export function fn<Arg1 extends z.ZodType, Callback extends (arg1: z.output<Arg1>) => any>(
  arg1: Arg1,
  cb: Callback
) {
  const result = function (input: z.input<typeof arg1>): ReturnType<Callback> {
    try {
      const parsed = arg1.parse(input);
      return cb.apply(cb, [parsed as any]);
    } catch (error) {
      let newError: Error = error as Error;
      if (error instanceof ZodError) {
        newError = new Error(
          `Parameter error: ${z.prettifyError(error)} Input received: ${JSON.stringify(input, null, 2)}`
        );
        newError.stack = error.stack || '';
        newError.cause = error;
      } else if (error instanceof Error) {
        newError = new Error(
          `An unexpected error occurred while validating input: ${error?.message}`
        );
        newError.stack = error.stack || '';
      }
      throw newError;
    }
  };
  /**
Preserve metadata so IDEs / stack-traces can resolve the original
callback instead of this anonymous wrapper – mirrors the approach in
`serviceFn`.
   */
  Object.defineProperty(result, 'name', {
    value: cb.name || 'anonymous',
    writable: false,
  });
  (result as any).original = cb;
  (result as any).schema = arg1;
  return result;
}
