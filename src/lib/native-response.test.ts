import { afterEach, expect, it, vi } from "vitest";
import { readProteomics } from "./read";
import { requestProteomics } from "./request";
import { createProteomicsApiFetch } from "./api-adapter";

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it.each([
  ["<html>failure</html>", 200, {}], ["{broken", 200, { "content-type": "application/json" }],
  ['{"datasets":[]}', 206, { "content-type": "application/json" }],
  ['{"datasets":[]}', 200, { "content-type": "application/json", "content-range": "bytes 0-14/99" }],
])("retains complete malformed/non-JSON/partial evidence %s", async (text, status, headers) => {
  await expect(readProteomics(new Response(text, { status, headers }))).rejects.toMatchObject({ status: 502, data: text });
});

it("preserves HTTP failure status and Retry-After when body and cancellation stall", async () => {
  vi.useFakeTimers(); const cancel = vi.fn(() => new Promise<void>(() => {}));
  const pending = expect(readProteomics(new Response(new ReadableStream({ cancel }), { status: 429, headers: { "retry-after": "60" } })))
    .rejects.toMatchObject({ status: 429, data: { http_status: 429, body_unavailable: true, retry_after: "60" } });
  await vi.advanceTimersByTimeAsync(10001); await pending;
  expect(cancel).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it("bounds uncooperative iProX headers, retains request context and cancels a late response", async () => {
  vi.useFakeTimers(); let resolve!: (value: Response) => void;
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(done => { resolve = done; })));
  const pending = expect(createProteomicsApiFetch()({ method: "GET", path: "/iprox/datasets/PXD008840" }))
    .rejects.toMatchObject({ status: 504, data: { requested_accession: "PXD008840" } });
  await vi.advanceTimersByTimeAsync(25001); await pending;
  const cancel = vi.fn(); resolve(new Response(new ReadableStream({ cancel })));
  await Promise.resolve(); expect(cancel).toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});

it("rejects advertised/streamed oversize bodies and malformed UTF-8 without partial data", async () => {
  for (const response of [new Response("small", { headers: { "content-length": "4194305" } }), new Response("é".repeat(2100000))])
    await expect(readProteomics(response)).rejects.toMatchObject({ status: 413, data: { body_unavailable: true } });
  await expect(readProteomics(new Response(new Uint8Array([0xc3, 0x28])))).rejects.toMatchObject({ status: 502, data: { body_unavailable: true } });
});

it("preserves BOM text for SDRF hashing and accepts a JSON BOM without altering native fields", async () => {
  const text = "\uFEFFsource name\tcomment[data file]\n001\tx.raw\n";
  vi.stubGlobal("fetch", vi.fn(async () => new Response(text)));
  expect((await requestProteomics("https://raw.githubusercontent.com/example", {}, true)).result.data).toBe(text);
  const native = [{ mzs: [100], intensities: [0], attributes: [{ value: "001.20" }] }];
  expect(await readProteomics(new Response("\uFEFF" + JSON.stringify(native), { headers: { "content-type": "application/json" } }))).toEqual({ status: 200, data: native });
});

it("treats a documented PROXI application failure as an error while retaining partial native annotations", async () => {
  const native = { annotated_spectra: [{ mzs: [100], intensities: [0] }], status: { status_code: 503, status: "Service unavailable", description: "native context" } };
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(native)));
  await expect(createProteomicsApiFetch()({ method: "POST", path: "/proxi/annotate", body: [{ mzs: [100], intensities: [0] }] }))
    .rejects.toMatchObject({ status: 502, data: { http_status: 200, native } });
  expect(fetch).toHaveBeenCalledTimes(1);
});
