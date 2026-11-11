import { expect, it } from "vitest";
import { McpServer } from "@bio-mcp/shared/mcp";
import { proteomicsResponse } from "./tool-result";
import { registerQueryData } from "../tools/query-data";
import { hashCanonicalJson, verifyCitationEnvelope } from "@bio-mcp/shared";

function storage(stored: unknown[]) {
  return { idFromName: (name: string) => name, get: () => ({ fetch: async (request: Request) => {
    const path = new URL(request.url).pathname;
    if (path === "/process") {
      const payload = await request.json() as { data: unknown }; stored.push(payload.data);
      return Response.json({ success: true, tables_created: ["payloads"], total_rows: 1 });
    }
    if (path === "/query") return Response.json({ success: true, results: [{ cells_json: "α".repeat(60000) }], row_count: 1 });
    return Response.json({ success: true, schema: { tables: { rows: { columns: [{ name: "cells_json" }] } } } });
  } }) };
}

it.each([false, true])("stages complete MCP envelopes and retains error/citation state (failure=%s)", async failed => {
  const stored: unknown[] = [];
  const original = { content: [{ type: "text" as const, text: "α".repeat(20000) }], structuredContent: { success: !failed, data: "native", _meta: { citation: { source_id: "proteomics" } } }, ...(failed ? { isError: true } : {}) };
  const result = await proteomicsResponse(async () => original, { PROTEOMICS_DATA_DO: storage(stored) }, "proteomics_execute", {});
  expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: !failed, staged: true, _staging: expect.any(Object), _meta: { citation: { result_scope: "staged:full_result", result_hash: await hashCanonicalJson(original) } } } });
  const proof = await verifyCitationEnvelope({ citation: result.structuredContent!._meta && (result.structuredContent!._meta as { citation: unknown }).citation,
    structuredContent: result.structuredContent, toolArguments: {}, materialized: { value: original } });
  expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
  expect(result.isError === true).toBe(failed);
  expect(stored.map(value => typeof value === "string" ? JSON.parse(value) : value)).toContainEqual(original);
  expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30 * 1024);
});

it("keeps large SQL cell retrieval below the transport limit through both aliases", async () => {
  const stored: unknown[] = [];
  const server = new McpServer({ name: "fixture", version: "1" });
  registerQueryData(server, { PROTEOMICS_DATA_DO: storage(stored) });
  // SAFETY: inspect actual registered callbacks for transport-level assertions.
  const tools = (server as unknown as { _registeredTools: Record<string, { handler: (args: unknown, extra: unknown) => Promise<unknown> }> })._registeredTools;
  for (const name of ["proteomics_query_data", "mcp_proteomics_query_data"]) {
    const result = await tools[name].handler({ data_access_id: "fixture", sql: "SELECT cells_json FROM rows" }, {});
    expect(result).toMatchObject({ content: expect.any(Array), structuredContent: { success: true, staged: true, _staging: expect.any(Object) } });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(30 * 1024);
  }
  expect(JSON.stringify(stored)).toContain("α".repeat(60000));
});

it("returns a bounded both-fields error when staging storage is unavailable", async () => {
  expect(await proteomicsResponse(async () => ({ content: [{ type: "text", text: "x".repeat(40000) }] }), {}, "proteomics_execute", {})).toMatchObject({ content: expect.any(Array), structuredContent: { success: false }, isError: true });
});
