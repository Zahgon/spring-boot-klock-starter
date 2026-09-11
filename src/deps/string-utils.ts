/**
 * The `org.springframework.util.StringUtils` behaviour the lock-key format
 * depends on.
 */

/**
 * Spring's `StringUtils.collectionToDelimitedString(coll, delim, prefix, suffix)`:
 * every element is wrapped in `prefix`/`suffix` and the wrapped elements are
 * joined with `delim`.
 *
 * The original calls it with `delim=""`, `prefix="-"`, `suffix=""`, so two keys
 * `a` and `b` produce `-a-b` — a leading separator on every element, not a
 * separator between them.
 */
export function collectionToDelimitedString(
  collection: readonly string[],
  delimiter: string,
  prefix: string,
  suffix: string,
): string {
  return collection.map((element) => `${prefix}${element}${suffix}`).join(delimiter);
}

/** Spring's `StringUtils.isEmpty` semantics for the string arguments the original passes. */
export function isEmpty(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.length === 0;
}
