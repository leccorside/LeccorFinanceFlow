import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { productionHeaders } from '../security-headers';

const here = dirname(fileURLToPath(import.meta.url));
const read = (name: string) => readFileSync(join(here, name), 'utf8');

/** `add_header Name "value" always;` lines of the snippet, as a map. */
function nginxHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const match of read('security-headers.conf').matchAll(
    /^add_header ([\w-]+) "([^"]*)" always;$/gm,
  )) {
    headers[match[1] as string] = match[2] as string;
  }
  return headers;
}

describe('production web server headers', () => {
  it('nginx sends exactly the headers of security-headers.ts', () => {
    expect(nginxHeaders()).toEqual(productionHeaders);
  });

  it('every location that adds headers also includes the security snippet', () => {
    // nginx drops inherited add_header directives in a block that defines its own.
    const blocks = read('default.conf')
      .split(/\n\s*location /)
      .slice(1);
    for (const block of blocks) {
      if (block.includes('add_header')) {
        expect(block).toContain('include /etc/nginx/snippets/security-headers.conf;');
      }
    }
  });
});
