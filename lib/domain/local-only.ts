/**
 * Offerten's source material and derived memory stay on the trusted machine.
 * The marker check is shared by assistant retrieval and the read-only MCP
 * boundary so a generic collection read cannot bypass the dedicated workflow.
 */
export function isOffertenRecord(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  const record = value as Readonly<Record<string, unknown>>;
  const marked = (item: unknown): boolean =>
    typeof item === 'string' && /^offerten(?:$|[.:/_-])/i.test(item);
  return ['capabilityId', 'namespace', 'source', 'toolId', 'classification', 'localOnly'].some(
    (field) => marked(record[field]),
  ) || (Array.isArray(record.tags) && record.tags.some(marked)) ||
    (typeof record.tags === 'string' && record.tags.split(',').some((tag) => marked(tag.trim()))) ||
    (record.args !== undefined && isOffertenRecord(record.args));
}

export function isLocalOnlyCollection(collection: string): boolean {
  return /^offerten/i.test(collection);
}

export function publicRecords<T>(collection: string, records: readonly T[]): T[] {
  return isLocalOnlyCollection(collection) ? [] : records.filter((record) => !isOffertenRecord(record));
}
