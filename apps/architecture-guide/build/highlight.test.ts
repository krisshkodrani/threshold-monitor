import { describe, expect, it } from "vitest";
import { decodeCode, highlightCode, highlightDocument } from "./highlight";
const plain = (html: string) => decodeCode(html.replace(/<[^>]*>/g, ""));
describe("code highlighting", () => {
  it("preserves source text, indentation and trailing newlines for copying", () => {
    const source =
      "// Redux state\nconst state: Record<string, number> = { count: 2 };\n";
    const highlighted = highlightCode(source);
    expect(plain(highlighted)).toBe(source);
    expect(highlighted).toContain("syntax-comment");
    expect(highlighted).toContain("syntax-keyword");
    expect(highlighted).toContain("syntax-number");
  });
  it("escapes code that contains markup while coloring strings and functions", () => {
    const source = 'send("<script>alert(1)</script>");\n';
    const highlighted = highlightCode(source);
    expect(highlighted).not.toContain("<script>");
    expect(highlighted).toContain("syntax-string");
    expect(highlighted).toContain("syntax-function");
    expect(plain(highlighted)).toBe(source);
  });
  it("highlights only source excerpts and leaves prose and metadata intact", () => {
    const html =
      '<p>Redux</p><pre><code id="snippet-test">const n = &lt;number&gt;2;\n</code></pre>';
    const result = highlightDocument(html);
    expect(result).toContain("<p>Redux</p>");
    expect(result).toContain('id="snippet-test"');
    expect(plain(result)).toBe("Reduxconst n = <number>2;\n");
  });
});
