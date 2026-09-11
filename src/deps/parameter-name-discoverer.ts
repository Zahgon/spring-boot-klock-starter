/**
 * `org.springframework.core.DefaultParameterNameDiscoverer` equivalent.
 *
 * SpEL keys such as `#userId` resolve a parameter *by name*, so the port needs
 * the same ability to recover parameter names at runtime that Spring gets from
 * the class file's debug information. In JavaScript the names are recoverable
 * from the function source, which `Function.prototype.toString` returns
 * verbatim (TypeScript's emit and Vitest's transform both preserve them).
 */

const LINE_COMMENT = /\/\/.*$/gm;
const BLOCK_COMMENT = /\/\*[\s\S]*?\*\//g;

/**
 * Return the declared parameter names of `fn`.
 *
 * Rest parameters keep their name without the `...`; a destructured or
 * otherwise unnameable parameter yields the empty string so positional
 * accessors (`#a0`, `#p0`) still line up with it.
 */
export function getParameterNames(fn: (...args: never[]) => unknown): string[] {
  const source = fn.toString().replace(BLOCK_COMMENT, '').replace(LINE_COMMENT, '');
  const open = source.indexOf('(');
  if (open < 0) {
    return [];
  }

  let depth = 0;
  let close = -1;
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) {
        close = i;
        break;
      }
    }
  }
  if (close < 0) {
    return [];
  }

  const raw = source.slice(open + 1, close);
  return splitTopLevel(raw)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)
    .map((part) => {
      const withoutDefault = part.split('=')[0] ?? '';
      const name = withoutDefault.replace(/^\.\.\./, '').trim();
      return /^[A-Za-z_$][\w$]*$/.test(name) ? name : '';
    });
}

/** Split an argument list on commas that are not nested inside brackets or strings. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i] as string;
    if (quote) {
      if (ch === quote && text[i - 1] !== '\\') {
        quote = null;
      }
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch;
    } else if (ch === '(' || ch === '[' || ch === '{') {
      depth++;
    } else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
    } else if (ch === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}
