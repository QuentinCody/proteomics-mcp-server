import type { Completeness } from "@bio-mcp/shared";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const count = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const bounded = (returned: number, detail: string): Completeness => ({ complete: false, returned,
  truncation: { reason: "unknown", detail, remedy: "Retain provider paging/status and source context. Counts describe returned occurrences, not project completeness or validated sample/peptide identity." } });

function direct(value: unknown): Completeness | undefined {
  if (Array.isArray(value)) return bounded(value.length, "One native archive/PROXI response, not a complete repository or project inventory.");
  if (!record(value)) return undefined;
  if (record(value._proteomicsdb)) return bounded(count(value._proteomicsdb.returned_records) ?? 0, "One bounded ProteomicsDB OData page. Native counts and continuation links remain in native.d; no automatic paging or release pinning. Expression and peptide observations are not compound-binding or toxicity measurements.");
  if (record(value._sdrf)) {
    if (Array.isArray(value.rows)) return bounded(value.rows.length, "Selected rows from one commit-pinned community SDRF; other project files/designs and submitter validation remain separate.");
    if (Array.isArray(value.files)) return bounded(value.files.length, "Immediate project-directory SDRF files only; retain native directory completeness and the exact commit.");
    return bounded(1, "Repository reference observation, not a PRIDE release or validated deposited-file identity.");
  }
  if (record(value._iprox)) return bounded(Array.isArray(value.native) ? value.native.length : 1, "One iProX metadata lookup with unverified native dataset identity and release.");
  for (const key of ["datasets", "libraries", "annotated_spectra"]) {
    if (!Array.isArray(value[key])) continue;
    const result = bounded(value[key].length, key === "annotated_spectra" ? "Computed spectrum interpretations, preserving provider status and paired output peaks; not confirmed identifications." : "One PROXI page; preserve native result_set, positional columns and provider status.");
    const available = record(value.result_set) ? count(value.result_set.n_available_rows) : undefined;
    if (available !== undefined && available >= value[key].length) {
      result.total_available = available;
      if (available > value[key].length && result.truncation) result.truncation.reason = "page_limit";
    }
    return result;
  }
  if (typeof value.accession === "string" || record(value.datasetSummary)) return bounded(1, "One archive metadata record; linked files and biological identity are not independently validated.");
  return undefined;
}

/** Keep independent source coverage separate in composed and staged Code Mode results. */
export function proteomicsCompleteness(value: unknown): Completeness | undefined {
  const pending = [value]; const observations: Completeness[] = [];
  while (pending.length) {
    const item = pending.pop(); if (!item || typeof item !== "object") continue;
    if (record(item) && item.__staged === true) {
      if (record(item._staging) && record(item._staging.completeness) && item._staging.completeness.complete === false)
        observations.push({ ...item._staging.completeness, complete: false });
      continue;
    }
    const coverage = direct(item);
    if (coverage) observations.push(coverage); else pending.push(...Object.values(item));
  }
  if (observations.length < 2) return observations[0];
  return { complete: false, truncation: { reason: "unknown", detail: "Composed proteomics evidence contains independently scoped observations.", remedy: "Keep each archive, SDRF file, spectrum and annotation source distinct; do not add unrelated counts." } };
}
