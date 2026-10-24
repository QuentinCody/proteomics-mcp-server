import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { createProteomicsApiFetch } from "./api-adapter";
import { proteomicsCatalog } from "../spec/catalog";
import { registerCodeMode } from "../tools/code-mode";

const api = createProteomicsApiFetch();
const path = "/proteomicsdb/protein-expression";
const params = { PROTEINFILTER: "P00533", "$top": 1 };
const native = { d: { results: [{ __metadata: { uri: "https://www.proteomicsdb.org/native/1" }, UNIQUE_IDENTIFIER: "P00533", NORMALIZED_INTENSITY: "4.483880889224657", missing: null }], __count: "200", __next: "https://elsewhere.invalid/do-not-follow" }, future: true };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("builds the documented expression InputParams and preserves all native values, metadata, paging and hash", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(native, { headers: { etag: '"native"', "last-modified": "Fri, 23 Oct 2026 00:00:00 GMT" } }));
  vi.stubGlobal("fetch", fetcher);
  const result = await api({ method: "GET", path, params });
  expect(result).toMatchObject({ status: 200, data: { native, _proteomicsdb: {
    requested_top: 1, requested_skip: 0, automatic_paging: false, complete_dataset: false, release_pinned: false,
    returned_records: 1, etag: '"native"', last_modified: "Fri, 23 Oct 2026 00:00:00 GMT",
    response_sha256: createHash("sha256").update(JSON.stringify(native)).digest("hex"),
  } }, completeness: { complete: false, returned: 1 } });
  expect(fetcher).toHaveBeenCalledTimes(1);
  const [url, options] = fetcher.mock.calls[0];
  const source = new URL(url);
  expect(source.origin).toBe("https://www.proteomicsdb.org");
  expect(decodeURIComponent(source.pathname)).toBe("/proteomicsdb/logic/api/proteinexpression.xsodata/InputParams(PROTEINFILTER='P00533',MS_LEVEL=1,TISSUE_ID_SELECTION='',TISSUE_CATEGORY_SELECTION='tissue;fluid',SCOPE_SELECTION=1,GROUP_BY_TISSUE=1,CALCULATION_METHOD=0,EXP_ID=-1)/Results");
  expect(Object.fromEntries(source.searchParams)).toEqual({ "$format": "json", "$top": "1", "$skip": "0" });
  expect(options).toMatchObject({ redirect: "manual", signal: expect.any(AbortSignal) });
});

it("translates bounded peptide and tissue reads without inventing drug-binding evidence", async () => {
  const fetcher = vi.fn().mockImplementation(async () => Response.json({ d: { results: [] } }));
  vi.stubGlobal("fetch", fetcher);
  const requests = [
    { path: "/proteomicsdb/protein-peptides", params: { PROTEINFILTER: "Q92769", "$select": "ENTRY_NAME,UNIQUE_IDENTIFIER", "$skip": 10, "$top": 2 } },
    { path: "/proteomicsdb/tissues", params: { "$select": "TISSUE_ID,TISSUE_NAME,TISSUE_CATEGORY" } },
  ];
  for (const request of requests) expect(await api({ method: "GET", ...request })).toMatchObject({ data: { native: { d: { results: [] } } }, completeness: { complete: false, returned: 0 } });
  expect(decodeURIComponent(new URL(fetcher.mock.calls[0][0]).pathname)).toContain("proteinpeptideresult.xsodata/InputParams(PROTEINFILTER='Q92769')/Results");
  expect(new URL(fetcher.mock.calls[0][0]).searchParams.get("$skip")).toBe("10");
  expect(new URL(fetcher.mock.calls[1][0]).pathname).toContain("tissuelist.xsodata/CA_AVAILABLEBIOLOGICALSOURCES_API");
});

it("honors every explicit expression selector rather than substituting defaults", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ d: { results: [] } }));
  vi.stubGlobal("fetch", fetcher);
  await api({ method: "GET", path, params: { ...params, MS_LEVEL: 2, TISSUE_ID_SELECTION: "BTO:0000047", TISSUE_CATEGORY_SELECTION: "cell line", SCOPE_SELECTION: 2, GROUP_BY_TISSUE: 0, CALCULATION_METHOD: 1, EXP_ID: 42 } });
  expect(decodeURIComponent(new URL(fetcher.mock.calls[0][0]).pathname)).toContain("MS_LEVEL=2,TISSUE_ID_SELECTION='BTO:0000047',TISSUE_CATEGORY_SELECTION='cell line',SCOPE_SELECTION=2,GROUP_BY_TISSUE=0,CALCULATION_METHOD=1,EXP_ID=42");
});

it.each([
  { method: "POST", path, params }, { method: "GET", path, params, body: {} },
  { method: "GET", path: "/proteomicsdb/kinobeads", params },
  { method: "GET", path: "/proteomicsdb/protein-expression?x=1", params },
  { method: "GET", path: "/proteomicsdb/../pride/projects", params },
  { method: "GET", path, params: { ...params, PROTEINFILTER: "P00533')/Results?$top=10000&x=('" } },
  { method: "GET", path, params: { ...params, "$top": 101 } },
  { method: "GET", path, params: { ...params, "$top": 0 } },
  { method: "GET", path, params: { ...params, "$top": "1" } },
  { method: "GET", path, params: { ...params, "$skip": 10001 } },
  { method: "GET", path, params: { ...params, "$skip": 0.5 } },
  { method: "GET", path, params: { ...params, "$filter": "true" } },
  { method: "GET", path, params: { ...params, "$select": "UNIQUE_IDENTIFIER&$top=10000" } },
  { method: "GET", path, params: { ...params, MS_LEVEL: 3 } },
  { method: "GET", path, params: { ...params, TISSUE_ID_SELECTION: "BTO:0000047'" } },
  { method: "GET", path, params: { ...params, TISSUE_CATEGORY_SELECTION: "tissue;tissue" } },
  { method: "GET", path, params: { ...params, baseUrl: "https://elsewhere.invalid" } },
  { method: "GET", path: "/proteomicsdb/tissues", params },
])("rejects unsupported, unbounded or injectable requests before network: %j", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api(request)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it("rejects missing proteins, malformed OData, provider application errors and ignored row limits", async () => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ status: 400 });
  expect(fetcher).not.toHaveBeenCalled();
  for (const payload of [{ error: { message: "native failure" } }, { d: {} }, { d: { results: [null] } }, { d: { results: [{}, {}] } }]) {
    fetcher.mockResolvedValueOnce(Response.json(payload));
    await expect(api({ method: "GET", path, params })).rejects.toMatchObject({ status: 502, data: { native: payload, source_url: expect.stringContaining("proteinexpression.xsodata") } });
  }
});

it.each([302, 404, 429, 500])("retains HTTP %s error context without following redirects or retrying", async status => {
  const fetcher = vi.fn().mockResolvedValue(new Response("native failure", { status, headers: { location: "https://elsewhere.invalid" } }));
  vi.stubGlobal("fetch", fetcher);
  await expect(api({ method: "GET", path, params })).rejects.toMatchObject({ status, data: { native_error: "native failure", source_url: expect.stringContaining("proteinexpression.xsodata") } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("rejects oversized upstream bodies without silently retaining a prefix", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { headers: { "content-type": "application/json", "content-length": String(4 * 1024 * 1024 + 1) } })));
  await expect(api({ method: "GET", path, params })).rejects.toMatchObject({ status: 413, data: { source_url: expect.any(String) } });
});

it("aborts a stalled upstream body and keeps source context", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }), { headers: { "content-type": "application/json" } })));
  const pending = expect(api({ method: "GET", path, params })).rejects.toMatchObject({ status: 504, data: { source_url: expect.any(String) } });
  await vi.advanceTimersByTimeAsync(10000); await pending;
  expect(cancel).toHaveBeenCalled();
});

it("discovers ProteomicsDB expression through both existing search aliases", async () => {
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1]);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
  for (const name of ["proteomics_search", "mcp_proteomics_search"]) {
    const result = await tools[name].handler({ query: "ProteomicsDB expression", category: "proteomicsdb.expression", max_results: 5 }, {});
    expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
    expect(JSON.stringify(result)).toContain("/proteomicsdb/protein-expression");
  }
  expect(proteomicsCatalog.endpointCount).toBe(proteomicsCatalog.endpoints.length);
});
