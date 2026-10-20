/** Repository links are relative to docs/ in the offline export. */
export function sourceHref(path: string): string {
  return import.meta.env.DEV ? `/__source/${path}` : `../${path}`;
}
