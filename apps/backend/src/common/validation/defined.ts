export type Defined<T> = { [K in keyof T]?: Exclude<T[K], undefined> };

/**
 * Drops keys whose value is `undefined` (absent in a PATCH), keeping `null` (explicit clear).
 * Bridges Zod `.partial()` output and Prisma inputs under `exactOptionalPropertyTypes`.
 */
export function defined<T extends object>(value: T): Defined<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as Defined<T>;
}
