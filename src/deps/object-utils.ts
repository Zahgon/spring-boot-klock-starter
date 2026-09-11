/**
 * The one `org.springframework.util.ObjectUtils` behaviour the lock-key format
 * depends on.
 */

/**
 * Spring's `ObjectUtils.nullSafeToString`: `null` renders as the four-character
 * string `null`, and an array renders as `{a, b}`. Both forms end up inside lock
 * keys, so the exact spelling is part of the contract.
 */
/** How Spring renders a null inside a lock key. */
const NULL_STRING = 'null';

export function nullSafeToString(value: unknown): string {
  if (value === null || value === undefined) {
    return NULL_STRING;
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? '{}' : `{${value.map((item) => nullSafeToString(item)).join(', ')}}`;
  }
  if (typeof value === 'string') {
    return value;
  }
  return String(value);
}

/** Spring's `ObjectUtils.isEmpty` restricted to the cases the original passes it. */
export function isEmpty(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === 'string') {
    return value.length === 0;
  }
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return false;
}
