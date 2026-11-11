import { afterEach, expect, it, vi } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import type { ExecuteToolOptions } from "@bio-mcp/shared/codemode/execute-tool";
import { createApiProxyTool } from "@bio-mcp/shared/tools/api-proxy";
import { registerCodeMode } from "./code-mode";
import { registerQueryData } from "./query-data";
import { registerGetSchema } from "./get-schema";
import { proxiFetch } from "../lib/http";

const captured = vi.hoisted(() => ({ options: [] as ExecuteToolOptions[] }));
vi.mock("../lib/http", () => ({ prideFetch: vi.fn(), proxiFetch: vi.fn() }));
vi.mock("@bio-mcp/shared/codemode/execute-tool", async importOriginal => {
  const actual = await importOriginal<typeof import("@bio-mcp/shared/codemode/execute-tool")>();
  return { ...actual, createExecuteTool: (options: ExecuteToolOptions) => { captured.options.push(options); return actual.createExecuteTool(options); } };
});
afterEach(() => { captured.options.length = 0; vi.resetAllMocks(); vi.unstubAllGlobals(); });

function registered() {
  const server = new McpServer({ name: "fixture", version: "1" });
  // SAFETY: invalid-code tests never execute the Worker loader.
  registerCodeMode(server, { CODE_MODE_LOADER: { get: () => ({}) } } as unknown as Parameters<typeof registerCodeMode>[1]);
  registerQueryData(server, {}); registerGetSchema(server, {});
  // SAFETY: SDK registry inspection invokes the actual registered handlers.
  return (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
}

it("registers both aliases of all four tools and returns both fields on failures", async () => {
  const tools = registered(); expect(Object.keys(tools)).toHaveLength(8);
  for (const prefix of ["", "mcp_"]) {
    expect(await tools[prefix + "proteomics_search"].handler({ query: "annotate", max_results: 5 }, {})).toMatchObject({ content: expect.any(Array), structuredContent: { success: true } });
    for (const [name, args] of [["proteomics_execute", { code: "" }], ["proteomics_query_data", { data_access_id: "fixture", sql: "SELECT 1" }], ["proteomics_get_schema", { data_access_id: "fixture" }]] as const) {
      expect(await tools[prefix + name].handler(args, {})).toMatchObject({ content: expect.any(Array), structuredContent: expect.any(Object), isError: true });
    }
  }
});

function storage(stored: unknown[]) {
  return { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    if (new URL(request.url).pathname === "/process") {
      // SAFETY: the shared staging transport sends a data envelope.
      const payload = await request.json() as { data: unknown }; stored.push(payload.data);
      return Response.json({ success: true, tables_created: ["data"], total_rows: 1 });
    }
    return Response.json({ success: true, schema: { tables: { data: { columns: [{ name: "mzs" }] } } } });
  } }) };
}

it.each([false, true])("stages complete spectrum annotations and failures (failure=%s)", async failure => {
  registered(); const options = captured.options[0]; const stored: unknown[] = [];
  expect(options).toMatchObject({ maxInlineBytes: 30 * 1024, stagingThreshold: 30 * 1024, timeout: 60000 });
  const data = [{ mzs: [100.5], intensities: [0], interpretations: ["α".repeat(20000)], attributes: [{ value: "0012" }], provider: "fixture" }];
  vi.mocked(proxiFetch).mockResolvedValue(Response.json(data, { status: failure ? 502 : 200 }));
  const proxy = createApiProxyTool({ apiFetch: options.apiFetch, catalog: options.catalog, doNamespace: storage(stored), stagingPrefix: "proteomics", maxInlineBytes: options.maxInlineBytes });
  const result = await proxy.handler({ method: "POST", path: "/proxi/annotate", body: [{ mzs: [100.5], intensities: [0] }] }, { sql: () => [] });
  const plain = JSON.parse(JSON.stringify(result));
  if (failure) expect(plain).toMatchObject({ __api_error: true, incomplete: true, status: 502, data: { __staged: true } });
  else expect(plain).toMatchObject({ __staged: true, _staging: expect.any(Object) });
  const decoded = stored.map(value => typeof value === "string" ? JSON.parse(value) : value);
  expect(decoded).toContainEqual(data);
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
});

it("stages the full native SDRF with repeated headers, ordered cells, commit and hash through Code Mode", async () => {
  registered(); const options = captured.options[0]; const stored: unknown[] = [];
  const tsv = "source name\tcomment[data file]\tcomment[modification parameters]\tcomment[modification parameters]\n001\ta.raw\t" + "α".repeat(20000) + "\t001.20\n002\ta.raw\t\tnot available\n";
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(tsv)));
  const proxy = createApiProxyTool({ apiFetch: options.apiFetch, catalog: options.catalog, doNamespace: storage(stored), stagingPrefix: "proteomics", maxInlineBytes: options.maxInlineBytes });
  const result = await proxy.handler({ method: "GET", path: "/sdrf/projects/PXD000070/file", params: { commit: "a".repeat(40), filename: "PXD000070.sdrf.tsv" } }, { sql: () => [] });
  expect(result).toMatchObject({ __staged: true, _staging: expect.any(Object) });
  const decoded = stored.map(value => typeof value === "string" ? JSON.parse(value) : value);
  expect(decoded).toContainEqual(expect.objectContaining({ native_tsv: tsv, total_rows: 2, columns: ["source name", "comment[data file]", "comment[modification parameters]", "comment[modification parameters]"],
    rows: [expect.objectContaining({ source_name: "001", data_file: "a.raw" }), expect.objectContaining({ source_name: "002", cells_json: '["002","a.raw","","not available"]' })],
    _sdrf: expect.objectContaining({ commit: "a".repeat(40), decoded_utf8_sha256: expect.stringMatching(/^[a-f0-9]{64}$/) }) }));
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30 * 1024);
});
