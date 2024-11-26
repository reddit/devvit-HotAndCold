import {
  Devvit,
  JobContext,
  TriggerContext,
  TxClientLike,
} from "@devvit/public-api";
import { z } from "zod";

export const zodRedis = z.custom<Devvit.Context["redis"]>((redis) => redis);
export const zodTransaction = z.custom<TxClientLike>((transaction) =>
  transaction
);

export const zodContext = z.custom<Devvit.Context>((context) => context);
export const zodJobContext = z.custom<JobContext>((context) => context);
export const zodTriggerContext = z.custom<TriggerContext>((context) => context);
/** Context you get when rendering an app. This is different from schedule functions. */
export const zodUIContext = z.custom<Devvit.Context>((context) => context);

const lowerKebabCaseRegex = /^[a-z]+(-[a-z]+)*$/;
export const zodLowerKebabCase = z.string().refine(
  (value) => lowerKebabCaseRegex.test(value),
  {
    message: "String must be in lower kebab-case format",
  },
);

export const zodRedditUsername = z
  .string()
  .trim()
  .min(1)
  .refine((val) => !val.startsWith("u/"), {
    message: "Username must not start with the u/ prefix!",
  })
  .refine((val) => !val.startsWith("$"), {
    message: "The string must not start with a $ character",
  });

/**
 * A special Zod schema that parses a string into a number.
 * Empty string is parsed as `undefined`.
 */
export const redisNumberString = z.string().transform((val, ctx) => {
  if (val === "") return undefined;

  const parsed = parseInt(val);

  if (isNaN(parsed)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Not a number",
    });

    // This is a special symbol you can use to
    // return early from the transform function.
    // It has type `never` so it does not affect the
    // inferred return type.
    return z.NEVER;
  }
  return parsed;
});

/**
 * Validates a function's arguments against a zod schema to ensure things are
 * safe at runtime. Throws of there is a parameter error!
 *
 * @throws on parameter error
 */
export function zoddy<
  Schema extends z.ZodSchema<any, any, any>,
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-constraint
  Return extends any,
>(schema: Schema, func: (value: z.infer<Schema>) => Return) {
  const result = (input: z.infer<Schema>) => {
    const parsed = schema.parse(input);
    return func(parsed);
  };
  return result;
}
