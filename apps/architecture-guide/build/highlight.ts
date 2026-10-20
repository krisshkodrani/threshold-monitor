import ts from "typescript";
const escape = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function decodeCode(text: string): string {
  return text.replace(
    /&(#x[\da-f]+|#\d+|lt|gt|amp|quot|apos);/gi,
    (match, entity: string) => {
      if (entity.startsWith("#"))
        return String.fromCodePoint(
          entity[1]?.toLowerCase() === "x"
            ? parseInt(entity.slice(2), 16)
            : parseInt(entity.slice(1), 10),
        );
      return (
        (
          { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" } as Record<
            string,
            string
          >
        )[entity.toLowerCase()] ?? match
      );
    },
  );
}
function tokenClass(kind: ts.SyntaxKind, text: string, rest: string): string {
  if (
    kind === ts.SyntaxKind.SingleLineCommentTrivia ||
    kind === ts.SyntaxKind.MultiLineCommentTrivia
  )
    return "comment";
  if (
    kind === ts.SyntaxKind.StringLiteral ||
    (kind >= ts.SyntaxKind.NoSubstitutionTemplateLiteral &&
      kind <= ts.SyntaxKind.TemplateTail)
  )
    return "string";
  if (
    kind === ts.SyntaxKind.NumericLiteral ||
    kind === ts.SyntaxKind.BigIntLiteral
  )
    return "number";
  if (kind >= ts.SyntaxKind.FirstKeyword && kind <= ts.SyntaxKind.LastKeyword)
    return "keyword";
  if (kind === ts.SyntaxKind.Identifier) {
    if (/^\s*(?:<[^;=\n]*>)?\s*\(/.test(rest)) return "function";
    return /^[A-Z]/.test(text) ? "type" : "identifier";
  }
  if (
    kind === ts.SyntaxKind.WhitespaceTrivia ||
    kind === ts.SyntaxKind.NewLineTrivia
  )
    return "";
  return "punctuation";
}
/** Uses the workspace's TypeScript lexer at build time, adding no runtime library. */
export function highlightCode(source: string): string {
  const lines = [""];
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    source,
  );
  for (
    let kind = scanner.scan();
    kind !== ts.SyntaxKind.EndOfFileToken;
    kind = scanner.scan()
  ) {
    const text = scanner.getTokenText();
    const style = tokenClass(kind, text, source.slice(scanner.getTextPos()));
    const pieces = text.split("\n");
    pieces.forEach((piece, i) => {
      if (i) lines.push("");
      if (piece)
        lines[lines.length - 1] += style
          ? `<span class="syntax-${style}">${escape(piece)}</span>`
          : escape(piece);
    });
  }
  return lines
    .map(
      (line, i) =>
        `<span class="code-line" data-line="${i + 1}">${line}</span>`,
    )
    .join("\n");
}
export function highlightDocument(html: string): string {
  return html.replace(
    /(<pre\b[^>]*>\s*<code\b([^>]*)>)([\s\S]*?)(<\/code>\s*<\/pre>)/g,
    (_, open: string, _attrs: string, code: string, close: string) =>
      open + highlightCode(decodeCode(code)) + close,
  );
}
