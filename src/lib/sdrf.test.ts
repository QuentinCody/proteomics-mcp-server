import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createProteomicsApiFetch } from "./api-adapter";
import { parseSdrf } from "./sdrf-table";

const commit = "a".repeat(40);
const api = createProteomicsApiFetch();
const path = "/sdrf/projects/PXD000070/file";
const filename = "PXD000070.sdrf.tsv";
const text = "source name\tcomment[data file]\tcomment[label]\tcomment[modification parameters]\tcomment[modification parameters]\r\n001\trun.raw\tTMT126\tα\t001.20\r\n002\trun.raw\tTMT127\t\tnot available\r\n001\tRun.raw\tTMT126\tβ\t2\r\n";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it("retains repeated columns, leading zeros, missing strings and multiplexed rows with exact filtering", () => {
  const table = parseSdrf(text, "run.raw");
  expect(table.total_rows).toBe(3);
  expect(table.rows.map(row => [row.source_line, row.source_name])).toEqual([[2, "001"], [3, "002"]]);
  expect(table.columns.slice(-2)).toEqual(["comment[modification parameters]", "comment[modification parameters]"]);
  expect(JSON.parse(table.rows[0].cells_json)).toEqual(["001", "run.raw", "TMT126", "α", "001.20"]);
  expect(JSON.parse(table.rows[1].cells_json)).toEqual(["002", "run.raw", "TMT127", "", "not available"]);
  expect(parseSdrf(text, "run").rows).toEqual([]);
});

it.each([
  "source name\tcomment[data file]\na", "source name\tcomment[data file]\n\n",
  "Source Name\tcomment[data file]\na\tb", "source name\tcomment[data file]\tcomment[data file]\na\tb\tc",
  "source name\t\tcomment[data file]\na\tb\tc",
  "source name\tcomment[data file]\n" + "a\tb\n".repeat(20001),
])("rejects ambiguous or malformed tables instead of discarding cells", input => {
  expect(() => parseSdrf(input)).toThrow();
});

it("discovers a native Git reference and pins both project listing and text reads to it", async () => {
  const native = { ref: "refs/heads/main", object: { type: "commit", sha: commit }, node_id: "keep" };
  const entries = [filename, "PXD000070.split.sdrf.tsv"].map(name => ({ name, type: "file", path: `datasets/PXD000070/${name}`, sha: "b".repeat(40), size: 100, download_url: "https://untrusted.example/file" }));
  const fetch = vi.fn().mockResolvedValueOnce(Response.json(native)).mockResolvedValueOnce(Response.json(entries)).mockResolvedValueOnce(new Response(text));
  vi.stubGlobal("fetch", fetch);
  expect(await api({ method: "GET", path: "/sdrf/revision" })).toMatchObject({ data: { native, commit } });
  expect(await api({ method: "GET", path: "/sdrf/projects/PXD000070/files", params: { commit } })).toMatchObject({ data: { native: entries, directory_listing_complete: true, files: [{ filename }, { filename: "PXD000070.split.sdrf.tsv" }] } });
  const result = await api({ method: "GET", path, params: { commit, filename, data_file: "run.raw" } });
  expect(result).toMatchObject({ data: { native_tsv: text, total_rows: 3, rows: [expect.objectContaining({ source_name: "001" }), expect.objectContaining({ source_name: "002" })], _sdrf: { commit, submitter_verified: null, deposited_file_identity_verified: false, decoded_utf8_sha256: createHash("sha256").update(text).digest("hex") } } });
  expect(fetch.mock.calls.map(call => call[0])).toEqual([
    "https://api.github.com/repos/bigbio/sdrf-annotated-datasets/git/ref/heads/main",
    `https://api.github.com/repos/bigbio/sdrf-annotated-datasets/contents/datasets/PXD000070?ref=${commit}`,
    `https://raw.githubusercontent.com/bigbio/sdrf-annotated-datasets/${commit}/datasets/PXD000070/${filename}`,
  ]);
  expect(fetch).toHaveBeenLastCalledWith(expect.any(String), expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }));
});

it.each([
  { method: "POST", path }, { method: "GET", path, body: {} },
  { method: "GET", path, params: { commit: "main", filename } },
  { method: "GET", path, params: { commit, filename: "../other.sdrf.tsv" } },
  { method: "GET", path, params: { commit, filename: "x.sdrf.tsv?token=x" } },
  { method: "GET", path, params: { commit, filename, data_file: [] } },
  { method: "GET", path, params: { commit, filename, page: 1 } },
  { method: "GET", path: "/sdrf/projects/PXD000070%2f../file", params: { commit, filename } },
  { method: "GET", path: "/sdrf/revision", params: { repository: "other/repo" } },
])("rejects unsupported selectors before network access: %j", async request => {
  const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
  await expect(api(request)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
});

it("preserves rate-limit errors and refuses redirects without following their location", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json({ message: "API rate limit exceeded" }, { status: 403 })).mockResolvedValueOnce(new Response(null, { status: 302, headers: { location: "https://other.example" } }));
  vi.stubGlobal("fetch", fetch);
  await expect(api({ method: "GET", path: "/sdrf/revision" })).rejects.toMatchObject({ status: 403, data: '{"message":"API rate limit exceeded"}' });
  await expect(api({ method: "GET", path, params: { commit, filename } })).rejects.toMatchObject({ status: 302 });
  expect(fetch).toHaveBeenCalledTimes(2);
});

it("does not claim directory completeness at GitHub's cap or follow unlisted nested files", async () => {
  const entries = Array.from({ length: 1000 }, (_, index) => ({ name: `dir${index}`, path: `datasets/PXD000070/dir${index}`, type: "dir" }));
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(entries)));
  expect(await api({ method: "GET", path: "/sdrf/projects/PXD000070/files", params: { commit } })).toMatchObject({ data: { files: [], directory_listing_complete: false, native: entries } });
});

it("rejects a directory entry outside the requested project and a non-commit reference", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(Response.json([{ type: "file", name: filename, path: `datasets/PXD000999/${filename}` }])).mockResolvedValueOnce(Response.json({ ref: "refs/heads/main", object: { type: "tag", sha: commit } }));
  vi.stubGlobal("fetch", fetch);
  await expect(api({ method: "GET", path: "/sdrf/projects/PXD000070/files", params: { commit } })).rejects.toMatchObject({ status: 502 });
  await expect(api({ method: "GET", path: "/sdrf/revision" })).rejects.toMatchObject({ status: 502 });
});

it("bounds raw SDRF response reads and rejects invalid UTF-8", async () => {
  const fetch = vi.fn().mockResolvedValueOnce(new Response("x".repeat(4 * 1024 * 1024 + 1))).mockResolvedValueOnce(new Response(new Uint8Array([0xff])));
  vi.stubGlobal("fetch", fetch);
  await expect(api({ method: "GET", path, params: { commit, filename } })).rejects.toMatchObject({ status: 413 });
  await expect(api({ method: "GET", path, params: { commit, filename } })).rejects.toThrow();
});
