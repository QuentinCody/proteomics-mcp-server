import type { Completeness } from "@bio-mcp/shared";

/** ProteomicsDB is one bounded live page, never a complete affinity dataset. */
export function proteomicsCompleteness(value: unknown): Completeness | undefined {
  if (!value || typeof value !== "object" || !("_proteomicsdb" in value)) return undefined;
  const metadata = value._proteomicsdb;
  if (!metadata || typeof metadata !== "object" || !("returned_records" in metadata)) return undefined;
  const count = metadata.returned_records;
  return { complete: false, returned: typeof count === "number" ? count : undefined,
    truncation: { reason: "unknown", detail: "One bounded ProteomicsDB OData page; native counts and continuation links remain in native.d.",
      remedy: "Retain source URL, date and query bounds. Expression and peptide evidence are not binding or toxicity measurements." } };
}
