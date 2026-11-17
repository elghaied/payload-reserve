/**
 * `classMap('reserve-calendar').toolbar` → `'reserve-calendar__toolbar'`.
 *
 * The admin stylesheets are plain CSS with fixed, prefixed class names (the
 * pattern Payload's own plugins use), imported for side effects only. CSS
 * modules cannot be used: Payload's TanStack Start adapter resolves a style
 * import from a package's `dist/` to an empty module during SSR, so a
 * `styles` default import is `undefined` there and every `styles.x` throws.
 * `dev/classMap.spec.ts` checks each referenced class exists in its stylesheet.
 */
export const classMap = (block: string): Record<string, string> =>
  new Proxy({} as Record<string, string>, {
    get: (_target, key) => `${block}__${String(key)}`,
  })
