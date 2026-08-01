export function nameToId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

export function stateId(objectId: string, stateName: string): string {
  return `${objectId}.${nameToId(stateName)}`;
}

export function flattenList(text: string): string[] {
  const cleaned = text
    .replace(/,?\s+and\s+/g, ', ')
    .replace(/,?\s+or\s+/g, ', ');
  return cleaned
    .split(',')
    .map(s => s.trim())
    .filter(s => s.length > 0);
}
