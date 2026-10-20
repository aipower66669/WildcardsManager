/**
 * Wildcard comments are a `#` at the start of a line (leading spaces allowed).
 * Comment inserts `# ` at column 0. Uncomment removes one leading `#` and the
 * single space after it.
 */

export function commentLine(line: string): string {
  return `# ${line}`;
}

export function uncommentLine(line: string): string {
  const match = /^(\s*)# ?/.exec(line);
  if (!match) return line;
  return match[1]! + line.slice(match[0].length);
}
