import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { expect, it, vi } from "vitest";
import { detectArrays, inferSchema, materializeSchema } from "@bio-mcp/shared/staging/schema-inference";
import { parseSdrf } from "./lib/sdrf-table";
vi.mock("@bio-mcp/shared/staging/rest-staging-do", () => ({ RestStagingDO: class {} }));
import { ProteomicsDataDO } from "./do";

it("materializes SDRF rows without imposing PRIDE project indexes and retains positional cells", () => {
  const payload = { accession: "PXD000070", ...parseSdrf("source name\tcomment[data file]\tcomment[label]\n001\ta.raw\tTMT126\n002\ta.raw\tTMT127\n"), _sdrf: { commit: "a".repeat(40) } };
  // SAFETY: invoke the pure projection without constructing a Worker DO.
  const projection = (ProteomicsDataDO.prototype as unknown as { getTabularData: (data: unknown) => unknown }).getTabularData(payload);
  const arrays = detectArrays(projection);
  const schema = inferSchema(arrays);
  const database = new DatabaseSync(":memory:");
  try {
    const result = materializeSchema(schema, new Map(arrays.map(array => [array.key, array.rows])), {
      exec: (query, ...bindings) => database.prepare(query).run(...bindings as SQLInputValue[]),
    });
    expect(result.failedRows).toBe(0);
    expect(database.prepare("SELECT source_name, data_file, cells_json FROM rows ORDER BY source_line").all()).toEqual([
      { source_name: "001", data_file: "a.raw", cells_json: '["001","a.raw","TMT126"]' },
      { source_name: "002", data_file: "a.raw", cells_json: '["002","a.raw","TMT127"]' },
    ]);
  } finally { database.close(); }
});
