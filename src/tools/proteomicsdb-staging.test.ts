import { afterEach, expect, it, vi } from "vitest";
vi.mock("cloudflare:workers", () => ({ RpcTarget: class {}, DurableObject: class { constructor(public ctx: unknown, public env: unknown) {} } }));
import { verifyCitationEnvelope } from "@bio-mcp/shared";
import { fixture, recover } from "./staging-fixture";

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(["", "mcp_"])("preserves native OData and string abundances through staging and SQL for %s", async prefix => {
  const f = fixture();
  const native = { d: { results: [{ UNIQUE_IDENTIFIER: "P00533", NORMALIZED_INTENSITY: "001.200", nullable: null, note: "β".repeat(16000) }], __count: "200", __next: "https://elsewhere.invalid/not-followed" } };
  const fetcher = vi.fn(async () => Response.json(native)); vi.stubGlobal("fetch", fetcher);
  const code = "return await api.get('/proteomicsdb/protein-expression',{PROTEINFILTER:'P00533','$top':1});";
  try {
    const result = await f.tools[prefix + "proteomics_execute"].handler({ code }, {});
    expect(result.isError, JSON.stringify(result)).not.toBe(true);
    expect(result.content.length).toBeGreaterThan(0);
    const sc = result.structuredContent;
    const id = sc.data.data_access_id;
    const stored = await recover(f, id, prefix);
    expect(stored.native).toEqual(native);
    expect(sc._meta.completeness).toMatchObject({ complete: false, returned: 1 });
    expect(sc._meta.completeness.total_available).toBeUndefined();
    const proof = await verifyCitationEnvelope({ citation: sc._meta.citation, structuredContent: sc, toolArguments: { code }, materialized: { value: stored } });
    expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
    const rows = await f.tools[prefix + "proteomics_query_data"].handler({ data_access_id: id, sql: "SELECT UNIQUE_IDENTIFIER, NORMALIZED_INTENSITY, nullable FROM proteomicsdb_rows" }, {});
    expect(rows.structuredContent.data.rows).toEqual([{ UNIQUE_IDENTIFIER: "P00533", NORMALIZED_INTENSITY: "001.200", nullable: null }]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(100000);
  } finally { f.close(); }
});

it("returns both fields and an error flag with verified provenance for an invalid ProteomicsDB request", async () => {
  const f = fixture(); const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  try {
    for (const prefix of ["", "mcp_"]) {
      const code = "return await api.get('/proteomicsdb/protein-expression',{PROTEINFILTER:'P00533','$top':10001});";
      const result = await f.tools[prefix + "proteomics_execute"].handler({ code }, {});
      expect(result).toMatchObject({ isError: true, content: expect.any(Array), structuredContent: { success: false } });
      const proof = await verifyCitationEnvelope({ citation: result.structuredContent._meta.citation, structuredContent: result.structuredContent, toolArguments: { code } });
      expect(proof.verification).toMatchObject({ query: "verified", result: "verified" });
    }
    expect(fetcher).not.toHaveBeenCalled();
  } finally { f.close(); }
});
