/** Search text for a missing-file issue: the `__name__` token as written. */
export function missingFileSearchQuery(issue: {
  code: string;
  message: string;
  snippet?: string;
  nodeId?: string;
}): string | null {
  if (issue.code !== 'missing_file') return null;
  const snippet = issue.snippet?.trim();
  if (
    snippet &&
    snippet.startsWith('__') &&
    snippet.endsWith('__') &&
    snippet.length > 4
  ) {
    return snippet;
  }
  const fromMessage = issue.message.match(/__(?:[^_\n]|_(?!_))+__/);
  if (fromMessage) return fromMessage[0];
  const name = issue.nodeId?.startsWith('missing:')
    ? issue.nodeId.slice('missing:'.length).trim()
    : '';
  return name ? `__${name}__` : null;
}
