import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { redactUrl as healthRedactUrl } from '../validate-domain-alive';
import { createSourceInventory } from '../lib/source-inventory';
import { redactUrl } from '../utils/network/url-redaction';

describe('URL redaction', () => {
  it('preserves the existing redaction contract for reports and source identities', () => {
    const cases = [
      [
        'https://user:pass@example.test/path?token=one&token=two&Public=yes#frag',
        'https://example.test/path?token=%5BREDACTED%5D&Public=yes#frag',
      ],
      [
        'https://EXAMPLE.test/a?AUTH=one&auth=two&Key=three&x=1#fragment',
        'https://example.test/a?AUTH=%5BREDACTED%5D&auth=%5BREDACTED%5D&Key=%5BREDACTED%5D&x=1#fragment',
      ],
      [
        'https://user@example.test/a?password=p&credential=c&signature=s',
        'https://example.test/a?password=%5BREDACTED%5D&credential=%5BREDACTED%5D&signature=%5BREDACTED%5D',
      ],
      [
        'https://example.test/a?token=one&token=two&token=three',
        'https://example.test/a?token=%5BREDACTED%5D',
      ],
      ['https://example.test/a?x=1#frag', 'https://example.test/a?x=1#frag'],
      ['not a url?token=secret#frag', 'not a url?token=secret#frag'],
    ] as const;

    for (const [input, expected] of cases) {
      assert.equal(redactUrl(input), expected, input);
      assert.equal(healthRedactUrl(input), expected, input);
    }
    assert.equal(healthRedactUrl, redactUrl);
  });

  it('uses the same redacted identity when deduplicating source inventory entries', () => {
    const source = 'https://user:pass@example.test/a?token=secret&public=yes#frag';
    const [entry] = createSourceInventory(
      [{ name: 'rules', files: [{ path: 'a', url: source }] }],
      [],
      []
    );

    assert.equal(entry.id, `primary:${redactUrl(source)}`);
    assert.equal(entry.url, source);
  });
});
