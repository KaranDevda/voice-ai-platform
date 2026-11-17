import { describe, expect, it } from "vitest";
import { htmlToKnowledgeText } from "./knowledge-html";

describe("htmlToKnowledgeText", () => {
  it("keeps readable content, headings, and paragraph boundaries", () => {
    expect(htmlToKnowledgeText("<h1>Plans</h1><p>Business &amp; Starter</p><p>Call summaries</p>"))
      .toBe("Plans\nBusiness & Starter\nCall summaries");
  });

  it("removes scripts, styles, comments, and embedded non-text content", () => {
    const html = "<p>Visible</p><script>alert(1)</script><style>.secret{}</style><!-- hidden --><svg>icon text</svg><iframe>frame text</iframe>";
    expect(htmlToKnowledgeText(html)).toBe("Visible");
  });

  it("decodes numeric entities without throwing on invalid code points", () => {
    expect(htmlToKnowledgeText("&#72;&#105; &#x1F600; &#xD800; &#99999999;")).toBe("Hi 😀 � �");
  });
});
