import { afterEach, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { verifyCitationEnvelope } from "@bio-mcp/shared";
import { fixture, recover } from "./staging-fixture";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const padding = "β\"\\".repeat(6000);
const commit = "a".repeat(40);

async function verified(f: ReturnType<typeof fixture>, code: string, prefix: string) {
  const result = await f.tools[prefix + "proteomics_execute"].handler({ code }, {});
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  const sc = result.structuredContent;
  const id = sc.data.data_access_id;
  const native = await recover(f, id, prefix);
  const proof = await verifyCitationEnvelope({ citation: sc._meta.citation, structuredContent: sc, toolArguments: { code }, materialized: { value: native } });
  expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
  return { sc, id, native };
}

it.each(["", "mcp_"])("retains positional SDRF cells and repeated headers through %s", async prefix => {
  const f = fixture();
  const columns = ["source name", "comment[data file]", "comment[label]", "comment[label]"];
  const cells = Array.from({ length: 80 }, (_, i) => [String(i).padStart(3, "0"), "a.raw", "TMT126", "β".repeat(220)]);
  const text = columns.join("\t") + "\n" + cells.map(row => row.join("\t")).join("\n") + "\n";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(text)));
  try {
    const r = await verified(f, `return await api.get('/sdrf/projects/PXD000070/file',{commit:'${commit}',filename:'PXD000070.sdrf.tsv',data_file:'a.raw'});`, prefix);
    expect(r.native.native_tsv).toBe(text); expect(r.native.columns).toEqual(columns);
    expect(r.native.rows.map((row: { cells_json: string }) => JSON.parse(row.cells_json))).toEqual(cells);
    expect(r.sc._meta.completeness).toMatchObject({ complete: false, returned: 80 });
    expect(r.sc._meta.completeness.total_available).toBeUndefined();
    const columnRows = await f.tools[prefix + "proteomics_query_data"].handler({ data_access_id: r.id, sql: "SELECT column_index, name FROM sdrf_columns ORDER BY column_index" }, {});
    expect(columnRows.isError, JSON.stringify(columnRows)).not.toBe(true);
    expect(columnRows.structuredContent.data.rows.map((row: { name: string }) => row.name)).toEqual(columns);
    const count = await f.tools[prefix + "proteomics_query_data"].handler({ data_access_id: r.id, sql: "SELECT count(*) AS n FROM rows WHERE data_file='a.raw'" }, {});
    expect(count.structuredContent.data.rows).toEqual([{ n: 80 }]);
  } finally { f.close(); }
});

it("retains compact PROXI columns, nulls and duplicate records without using facet counts as dataset coverage", async () => {
  const f = fixture();
  const native = { datasets: [["PXD1", "001.20", null], ["PXD1", "001.20", null]], facets: { note: padding },
    result_set: { datasets_title_list: ["id", "title", "title"], n_available_rows: 9000, n_rows_returned: 2, page_number: 1 }, status: { status_code: 200 } };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  try {
    const r = await verified(f, "return await api.get('/proxi/datasets',{resultType:'compact',pageSize:2,pageNumber:1});", "");
    expect(r.native).toEqual(native); expect(r.sc._meta.completeness).toMatchObject({ complete: false, returned: 2, total_available: 9000 });
    const result = await f.tools.mcp_proteomics_query_data.handler({ data_access_id: r.id, sql: "SELECT row_index, cells_json FROM proxi_datasets ORDER BY row_index" }, {});
    expect(result.structuredContent.data.rows.map((row: { cells_json: string }) => JSON.parse(row.cells_json))).toEqual(native.datasets);
    const columns = await f.tools.proteomics_query_data.handler({ data_access_id: r.id, sql: "SELECT name FROM proxi_dataset_columns ORDER BY column_index" }, {});
    expect(columns.structuredContent.data.rows.map((row: { name: string }) => row.name)).toEqual(native.result_set.datasets_title_list);
  } finally { f.close(); }
});

it("pairs every native peak and interpretation by position and re-stages SQL rows with generated IDs", async () => {
  const f = fixture();
  const native = [{ mzs: [100, 101, 101], intensities: [0, 20, 30], interpretations: ["?", "b2", "y3"], future: padding },
    { mzs: [200], intensities: [9, 8], interpretations: ["x", "extra"] }];
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  try {
    const r = await verified(f, "return await api.get('/proxi/spectra',{usi:'fixture',resultType:'full'});", "mcp_");
    expect(r.native).toEqual(native); expect(r.sc._meta.completeness).toMatchObject({ complete: false, returned: 2 });
    const rows = await f.tools.proteomics_query_data.handler({ data_access_id: r.id, sql: "SELECT parent_id, peak_index, mz, intensity, interpretation_json FROM proxi_spectra_peaks ORDER BY parent_id, peak_index" }, {});
    expect(rows.structuredContent.data.rows).toEqual([
      { parent_id: 1, peak_index: 0, mz: 100, intensity: 0, interpretation_json: '"?"' },
      { parent_id: 1, peak_index: 1, mz: 101, intensity: 20, interpretation_json: '"b2"' },
      { parent_id: 1, peak_index: 2, mz: 101, intensity: 30, interpretation_json: '"y3"' },
      { parent_id: 2, peak_index: 0, mz: 200, intensity: 9, interpretation_json: '"x"' },
      { parent_id: 2, peak_index: 1, mz: null, intensity: 8, interpretation_json: '"extra"' },
    ]);
    const args = { data_access_id: r.id, sql: "SELECT * FROM proxi_spectra WHERE _rowid=1" };
    const result = await f.tools.proteomics_query_data.handler(args, {});
    expect(result.structuredContent.staged).toBe(true);
    const full = await recover(f, result.structuredContent.data_access_id, "");
    expect(full.structuredContent.data.rows[0]).toMatchObject({ _rowid: 1, future: padding, peak_arrays_aligned: 1 });
    const proof = await verifyCitationEnvelope({ citation: result.structuredContent._meta.citation, structuredContent: result.structuredContent, toolArguments: args, materialized: { value: full } });
    expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
  } finally { f.close(); }
});

it("cites all aliases, complete HTTP failures and composed source coverage", async () => {
  const f = fixture(); const body = "native unavailable β".repeat(50);
  vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 501 })));
  try {
    expect(Object.keys(f.tools)).toHaveLength(8);
    for (const prefix of ["", "mcp_"]) for (const [name, args, failed] of [
      ["search", { query: "SDRF", max_results: 2 }, false], ["get_schema", { data_access_id: "missing" }, false],
      ["query_data", { data_access_id: "missing", sql: "SELECT * FROM absent" }, true],
      ["execute", { code: "return await api.get('/proxi/proteins',{resultType:'full'});" }, true],
    ] as const) {
      const result = await f.tools[prefix + "proteomics_" + name].handler(args, {});
      expect(result.isError === true).toBe(failed); expect(result.content.length).toBeGreaterThan(0);
      expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30720);
      const proof = await verifyCitationEnvelope({ citation: result.structuredContent._meta.citation, structuredContent: result.structuredContent, toolArguments: args });
      expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
      if (name === "execute") expect(result.structuredContent.data).toMatchObject({ __api_error: true, status: 501, data: body });
    }
    vi.stubGlobal("fetch", vi.fn(async () => Response.json([{ accession: "PXD1" }])));
    const composed = await f.tools.proteomics_execute.handler({ code: "return {a:await api.get('/pride/projects'),b:await api.get('/pride/projects')};" }, {});
    expect(composed.structuredContent._meta.completeness).toMatchObject({ complete: false });
    expect(composed.structuredContent._meta.completeness.returned).toBeUndefined();
  } finally { f.close(); }
});
