import { marked, type Token } from 'marked';

type Mention = {
  type: 'mention';
  raw: string;
  identifier: string;
  tokens: Token[];
}

/**
 * Marked extension to identify and convert @identifier mentions into hyperlinks
 * Identifiers must start with a letter and can contain letters and numbers
 */
const mentionExtension = {
  name: 'mention',
  level: 'inline' as const,
  start(src: string) {
    return src.match(/(^|[^\w])@[a-zA-Z]/)?.index;
  },
  tokenizer(src: string): Mention | undefined {
    // Only match if not preceded by a word character (so not in emails)
    const rule = /(^|[^\w])@([a-zA-Z][a-zA-Z0-9]*)\b/;
    const match = rule.exec(src);
    if (match) {
      // match[1] is the prefix (either empty string or a non-word character)
      const raw = match[0].slice(match[1] ? match[1].length : 0);
      return {
        type: 'mention',
        raw,
        identifier: match[2]!,
        tokens: []
      };
    }
    return undefined;
  },
  renderer(mention: Mention) {
    return `<a href="/individuals/${mention.identifier}" class="mention">@${mention.identifier}</a>`;
  }
};

// Register the extension globally
marked.use({ extensions: [mentionExtension] });
