import { expect, it } from "vitest";
import { annotationBody } from "./annotation";

it("preserves every spectrum field and does not alter peak pairing", () => {
  const spectra = [{ mzs: [100.5, 200.25], intensities: [0, 42], usi: "fixture", attributes: [{ accession: "MS:1000041", value: 2 }], interpretations: ["?", "y2"], extended_data: { user_parameters: { skip_annotation: true } } }];
  expect(JSON.parse(annotationBody(spectra, { tolerance: 10, resultType: "full" }))).toEqual(spectra);
});

it.each([
  { body: null }, { body: [] }, { body: [null] }, { body: [[]] },
  { body: [{ mzs: [], intensities: [] }] },
  { body: [{ mzs: [1, 2], intensities: [1] }] },
  { body: [{ mzs: [2, 1], intensities: [1, 2] }] },
  { body: [{ mzs: [1], intensities: [Number.NaN] }] },
  { body: [{ mzs: [Number.POSITIVE_INFINITY], intensities: [1] }] },
  { body: [{ mzs: ["1"], intensities: [1] }] },
  { body: Array.from({ length: 101 }, () => ({ mzs: [1], intensities: [1] })) },
])("rejects invalid spectra before sending $body", ({ body }) => {
  expect(() => annotationBody(body)).toThrow();
});

it.each([0, -1, Number.POSITIVE_INFINITY, "10"])("rejects invalid ppm tolerance %s", tolerance => {
  expect(() => annotationBody([{ mzs: [1], intensities: [1] }], { tolerance })).toThrow(/tolerance/);
});

it("bounds UTF-8 request bytes and the supported result shape", () => {
  expect(() => annotationBody([{ mzs: [1], intensities: [1], extra: "α".repeat(2100000) }])).toThrow(/4 MiB/);
  expect(() => annotationBody([{ mzs: [1], intensities: [1] }], { resultType: "compact" })).toThrow(/full/);
});
