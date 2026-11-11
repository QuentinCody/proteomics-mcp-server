import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);

/** SQL pairs peaks by native position; malformed lengths stay explicit, never truncated. */
function spectrumProjection(value: Record<string, unknown>) {
  const { mzs, intensities, interpretations, ...spectrum } = value;
  const masses = Array.isArray(mzs) ? mzs : [];
  const signals = Array.isArray(intensities) ? intensities : [];
  const labels = Array.isArray(interpretations) ? interpretations : [];
  return { ...spectrum, peak_arrays_aligned: masses.length === signals.length,
    interpretations_aligned: interpretations === undefined ? null : labels.length === masses.length,
    peaks: Array.from({ length: Math.max(masses.length, signals.length, labels.length) }, (_, peak_index) => ({
      peak_index, mz: masses[peak_index], intensity: signals[peak_index], interpretation_json: JSON.stringify(labels[peak_index]),
    })),
  };
}

export class ProteomicsDataDO extends RestStagingDO {
  protected getTabularData(value: unknown): unknown {
    const data = record(value) && Array.isArray(value.content) && record(value.structuredContent) && "data" in value.structuredContent
      ? value.structuredContent.data : value;
    if (record(data) && typeof data.sql === "string" && Array.isArray(data.rows)) return { query_rows: data.rows.map(native => ({ native })) };
    if (record(data)) {
      const tables = recordTables(data);
      if (tables !== undefined) return tables;
    }
    if (Array.isArray(data) && data.length) {
      if (data.every(row => record(row) && Array.isArray(row.mzs))) return { proxi_spectra: data.map(row => spectrumProjection(row as Record<string, unknown>)) };
      if (data.every(row => record(row) && typeof row.fileName === "string")) return { pride_files: data };
      if (data.every(row => record(row) && typeof row.accession === "string" && row.accession.startsWith("PXD"))) return { pride_projects: data };
      return { records: data };
    }
    return data;
  }
}

function recordTables(data: Record<string, unknown>) {
  if (record(data._proteomicsdb) && record(data.native) && record(data.native.d) && Array.isArray(data.native.d.results)) return { proteomicsdb_rows: data.native.d.results };
  if (record(data._sdrf) && Array.isArray(data.rows)) return { _embedded: { rows: data.rows,
    sdrf_columns: Array.isArray(data.columns) ? data.columns.map((name, column_index) => ({ column_index, name })) : [] } };
  if (record(data._sdrf) && Array.isArray(data.files)) return { sdrf_files: data.files };
  if (record(data._iprox)) return { iprox_dataset: [{ requested_accession: data.requested_accession, native_json: JSON.stringify(data.native) }] };
  if (Array.isArray(data.datasets)) return { proxi_datasets: data.datasets.map((row, row_index) => Array.isArray(row) ? { row_index, cells_json: JSON.stringify(row) } : row),
    proxi_dataset_columns: record(data.result_set) && Array.isArray(data.result_set.datasets_title_list)
      ? data.result_set.datasets_title_list.map((name, column_index) => ({ column_index, name })) : [] };
  if (Array.isArray(data.libraries)) return { proxi_libraries: data.libraries };
  if (Array.isArray(data.annotated_spectra)) return { proxi_spectra: data.annotated_spectra.map(row => record(row) ? spectrumProjection(row) : row) };
  if (typeof data.accession === "string" && data.accession.startsWith("PXD")) return { pride_project: [data] };
  if (typeof data.fileName === "string") return { pride_files: [data] };
}
