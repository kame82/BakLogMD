export function backlogToMarkdown(input: string): string {
  let out = input;

  const headingRules: Array<[RegExp, string]> = [
    [/^h1\.\s+/gm, '# '],
    [/^h2\.\s+/gm, '## '],
    [/^h3\.\s+/gm, '### ']
  ];
  for (const [pattern, replace] of headingRules) {
    out = out.replace(pattern, replace);
  }

  out = out.replace(/^\*\s+/gm, '- ');
  out = out.replace(/\{\{\s*(.*?)\s*\}\}/g, '`$1`');

  const unsupportedRules: Array<[RegExp, string]> = [
    [/\[\[(.*?)\]\]/g, '$1'],
    [/\{color:[^}]*\}/g, ''],
    [/\{color\}/g, ''],
    [/\{quote\}/g, ''],
    [/\{\{/g, ''],
    [/\}\}/g, '']
  ];
  for (const [pattern, replace] of unsupportedRules) {
    out = out.replace(pattern, replace);
  }

  return out;
}
