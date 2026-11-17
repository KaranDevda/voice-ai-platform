/** Turn an uploaded HTML document into plain knowledge text. Active and non-content elements are removed before tags. */
export function htmlToKnowledgeText(html: string): string {
  const text = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|template|noscript|svg|iframe|object|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, " ")
    .replace(/<\/(?:p|div|section|article|header|footer|main|aside|h[1-6]|li|tr|table|blockquote|br)\s*>/gi, "\n")
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_all, n: string) => safeCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_all, n: string) => safeCodePoint(Number.parseInt(n, 16)))
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"').replace(/&apos;|&#39;/gi, "'")
    .replace(/&rsquo;|&lsquo;/gi, "'").replace(/&rdquo;|&ldquo;/gi, '"')
    .replace(/&ndash;/gi, "–").replace(/&mdash;/gi, "—").replace(/&copy;/gi, "©");
  return text.replace(/[\t\f\v ]+/g, " ").replace(/ *\n+ */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function safeCodePoint(n: number): string {
  return Number.isInteger(n) && n >= 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff) ? String.fromCodePoint(n) : "�";
}
