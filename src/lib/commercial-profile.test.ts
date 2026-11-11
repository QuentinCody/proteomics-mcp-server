import { describe, expect, it } from "vitest";
import { createProteomicsApiFetch } from "./api-adapter";

// License audit 2026-11-10: PRIDE and PROXI are open. The iProX terms conflict, and
// the ProteomicsDB terms are not confirmed, so both are withheld from a reselling caller.
describe("Proteomics adapter under the commercial license profile", () => {
	const apiFetch = createProteomicsApiFetch();

	it("refuses the iProX and ProteomicsDB routes with HTTP 451 and makes no upstream request", async () => {
		for (const path of ["/iprox/datasets/PXD000001", "/iprox", "/proteomicsdb/proteins", "/proteomicsdb"]) {
			const result = await apiFetch({ method: "GET", path, licenseProfile: "commercial" });
			expect(`${path}:${result.status}`).toBe(`${path}:451`);
			expect(result.data).toMatchObject({ error: "NOT_LICENSED_FOR_COMMERCIAL_USE" });
		}
	});
});
