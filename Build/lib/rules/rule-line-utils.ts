export function stripTrailingHashComment(line: string): string {
  const index = line.lastIndexOf('#');
  if (index > 0) {
    return line.slice(0, index).trimEnd();
  }
  return line;
}
