import { afterEach, expect, it, vi } from "vitest";
import { readProteomics } from "./read";
afterEach(() => vi.useRealTimers());

it("preserves native spectra, arbitrary metadata and SDRF strings", async () => {
  const data = [{ mzs: [100.5], intensities: [0], interpretations: ["?"], provider: "fixture", attributes: [{ value: "0012" }] }];
  expect(await readProteomics(Response.json(data))).toEqual({ status: 200, data });
  expect(await readProteomics(new Response("source name\tcomment[data file]\nα\tx.raw"), true)).toEqual({ status: 200, data: "source name\tcomment[data file]\nα\tx.raw" });
});

it("preserves complete errors and rejects bodyless errors", async () => {
  const text = "error".repeat(1000);
  await expect(readProteomics(new Response(text, { status: 501 }))).rejects.toMatchObject({ status: 501, data: text });
  await expect(readProteomics(new Response(null, { status: 503 }))).rejects.toMatchObject({ status: 503, data: "" });
  await expect(readProteomics(new Response(null, { status: 204 }))).rejects.toMatchObject({ status: 502, data: "" });
});

it("rejects oversized UTF-8 bytes and malformed JSON without returning partial evidence", async () => {
  await expect(readProteomics(new Response("α".repeat(2100000)))).rejects.toMatchObject({ status: 413 });
  await expect(readProteomics(new Response("{", { headers: { "content-type": "application/json" } }))).rejects.toThrow();
});

it("cancels stalled streams with a timeout error", async () => {
  vi.useFakeTimers(); const cancel = vi.fn();
  const assertion = expect(readProteomics(new Response(new ReadableStream({ cancel })))).rejects.toMatchObject({ status: 504 });
  await vi.advanceTimersByTimeAsync(10001); await assertion;
  expect(cancel).toHaveBeenCalled();
});
