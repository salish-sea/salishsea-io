import { describe, it, expect } from 'vitest';
import { marked } from 'marked';
import './marked-mentions.js';

describe('mentionExtension', () => {
  it('renders @username as a hyperlink', () => {
    const input = 'Hello @alice and @bob123!';
    const html = marked.parse(input, { async: false });
    expect(html).toContain('<a href="/individuals/alice" class="mention">@alice</a>');
    expect(html).toContain('<a href="/individuals/bob123" class="mention">@bob123</a>');
  });

  it('does not match @123bob or @-alice', () => {
    const input = 'Not a mention: @123bob, @-alice';
    const html = marked.parse(input, { async: false });
    expect(html).not.toContain('href="/individuals/123bob"');
    expect(html).not.toContain('href="/individuals/-alice"');
  });

  it('works in the middle of a sentence', () => {
    const input = 'Say hi to @carol!';
    const html = marked.parse(input, { async: false });
    expect(html).toContain('<a href="/individuals/carol" class="mention">@carol</a>');
  });

  it('does not match email addresses', () => {
    const input = 'Contact me at bob@example.com';
    const html = marked.parse(input, { async: false });
    expect(html).not.toContain('href="/individuals/example"');
  });
});
