import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { McpServer } from "@bio-mcp/shared/mcp";
import { createProteomicsApiFetch } from "./api-adapter";
import { proteomicsCatalog } from "../spec/catalog";
import { iproxDatasetWorkflow } from "../spec/iprox";
import { registerCodeMode } from "../tools/code-mode";

const path = "/iprox/datasets/PXD008840";
const sourceUrl = "https://www.iprox.cn/proxi/datasets/PXD008840";
const api = createProteomicsApiFetch();
const native = { identifier: "PXD008840", attributes: [{ accession: "MS:fixture", value: "001.20" }], providers: ["iProX"], files: [{ url: "https://files.example/data.raw" }], _iprox: { keep: true }, unknown: null };
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("reads only the documented iProX dataset URL and retains every native field and source header", async () => {
  const fetcher = vi.fn().mockResolvedValue(Response.json(native, { headers: { etag: '"native"', "last-modified": "Wed, 30 Sep 2026 10:00:00 GMT" } }));
  vi.stubGlobal("fetch", fetcher);
  const result = await api({ method: "GET", path });
  expect(result).toMatchObject({ status: 200, data: { requested_accession: "PXD008840", native, _iprox: {
    source_url: sourceUrl, etag: '"native"', last_modified: "Wed, 30 Sep 2026 10:00:00 GMT", dataset_identity_verified: false, release_pinned: false,
    response_sha256: createHash("sha256").update(JSON.stringify(native)).digest("hex"),
  } } });
  expect(fetcher).toHaveBeenCalledExactlyOnceWith(sourceUrl, expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal), headers: { Accept: "application/json", "User-Agent": "bio-mcp-proteomics" } }));
});

it.each([
  { method: "POST", path }, { method: "GET", path, body: {} },
  { method: "GET", path, params: { resultType: "full" } },
  { method: "GET", path, params: { baseUrl: "https://other.example" } },
  { method: "GET", path: "/iprox/datasets" }, { method: "GET", path: "/iprox/spectra" },
  { method: "GET", path: "/iprox/datasets/IPX00001" }, { method: "GET", path: "/iprox/datasets/PXD008840/../other" },
  { method: "GET", path: "/iprox/datasets/PXD008840?token=secret" }, { method: "GET", path: "/iprox/datasets/PXD008840%2fextra" },
])("rejects unsupported routes, filters and mutation requests before network: %j", async request => {
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  await expect(api(request)).rejects.toThrow();
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([404, 429, 501])("preserves HTTP %s provider errors with host context without fallback or retry", async status => {
  const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "native failure", accession: "PXD008840" }, { status }));
  vi.stubGlobal("fetch", fetcher);
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ status, data: { source_url: sourceUrl, requested_accession: "PXD008840", native_error: '{"error":"native failure","accession":"PXD008840"}' } });
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("refuses redirects and non-JSON success without treating them as a dataset", async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.example" } })).mockResolvedValueOnce(new Response("<html>maintenance</html>"));
  vi.stubGlobal("fetch", fetcher);
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ status: 302, data: { source_url: sourceUrl } });
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ status: 502, data: { native_error: "<html>maintenance</html>", source_url: sourceUrl } });
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("preserves arrays, empty collections and provider application errors without asserting identity", async () => {
  for (const payload of [[native], [], { error: "not available" }]) {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(payload)));
    expect(await api({ method: "GET", path })).toMatchObject({ data: { native: payload, _iprox: { dataset_identity_verified: false } } });
  }
});

it("bounds response bytes instead of truncating native metadata", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ ...native, description: "α".repeat(2_100_000) })));
  await expect(api({ method: "GET", path })).rejects.toMatchObject({ status: 413, data: { source_url: sourceUrl } });
});

it("bounds stalled body reads and retains source context on timeout", async () => {
  vi.useFakeTimers();
  const cancel = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new ReadableStream({ cancel }))));
  const pending = expect(api({ method: "GET", path })).rejects.toMatchObject({ status: 504, data: { source_url: sourceUrl } });
  await vi.advanceTimersByTimeAsync(10000); await pending;
  expect(cancel).toHaveBeenCalled();
});

it("stages large iProX metadata and provenance through the catalog's executable recipe", async () => {
  const large = { ...native, description: "α".repeat(40_000) };
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(large)));
  const stored: unknown[] = [];
  const namespace = { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      stored.push((await request.json() as { data: unknown }).data);
      return Response.json({ success: true, tables_created: ["payloads"], total_rows: 1 });
    }
    return Response.json({ success: true, schema: { tables: {} } });
  } }) } as unknown as DurableObjectNamespace;
  const proxy = createApiProxyTool({ apiFetch: api, catalog: proteomicsCatalog, doNamespace: namespace, stagingPrefix: "proteomics", maxInlineBytes: 30 * 1024 });
  const run = new Function("api", `return (async () => {${iproxDatasetWorkflow.code}})();`);
  const result = await run({ get: (path: string) => proxy.handler({ method: "GET", path }, { sql: () => [] }) });
  expect(result).toMatchObject({ __staged: true, data_access_id: expect.any(String) });
  expect(stored.length).toBeGreaterThan(0);
  for (const payload of stored) expect(typeof payload === "string" ? JSON.parse(payload) : payload).toMatchObject({ native: large, _iprox: { source_url: sourceUrl, response_sha256: createHash("sha256").update(JSON.stringify(large)).digest("hex") } });
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30 * 1024);
});

it("discovers iProX through both existing Code Mode search aliases", async () => {
  const server = new McpServer({ name: "fixture", version: "1" });
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1]);
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
  for (const name of ["proteomics_search", "mcp_proteomics_search"]) {
    const result = await tools[name].handler({ query: "iProX dataset", category: "iprox_datasets", max_results: 5 }, {});
    expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
    expect(JSON.stringify(result)).toContain("/iprox/datasets/{accession}");
  }
  expect(proteomicsCatalog.endpointCount).toBe(proteomicsCatalog.endpoints.length);
});
