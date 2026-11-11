import { afterEach, expect, it, vi } from "vitest";
import { prideFetch, proxiFetch } from "./http";
import { createProteomicsApiFetch } from "./api-adapter";
vi.mock("./http", () => ({ prideFetch: vi.fn(), proxiFetch: vi.fn() }));
afterEach(() => vi.resetAllMocks());
const api = createProteomicsApiFetch();

it("routes native archive reads with bounded deadlines", async () => {
  vi.mocked(prideFetch).mockResolvedValue(Response.json(["source name\tcomment[data file]\na\tx.raw"]));
  expect(await api({ method: "GET", path: "/pride/files/sdrf/PXD000001" })).toMatchObject({ status: 200, data: ["source name\tcomment[data file]\na\tx.raw"], completeness: { complete: false, returned: 1 } });
  expect(prideFetch).toHaveBeenCalledWith("/files/sdrf/PXD000001", undefined, expect.objectContaining({ deadlineMs: 25000 }));
  vi.mocked(proxiFetch).mockResolvedValue(Response.json([{ provider: "PRIDE" }, { provider: "MassIVE" }]));
  expect(await api({ method: "GET", path: "/proxi/spectra", params: { usi: "fixture", resultType: "full" } })).toMatchObject({ data: [{ provider: "PRIDE" }, { provider: "MassIVE" }] });
});

it("sends native annotation JSON and query values without retrying POST", async () => {
  const body = [{ mzs: [100.5], intensities: [20], attributes: [{ value: "001" }] }];
  vi.mocked(proxiFetch).mockResolvedValue(Response.json([{ interpretations: ["?"] }]));
  await api({ method: "POST", path: "/proxi/annotate", body, params: { tolerance: 500 } });
  expect(proxiFetch).toHaveBeenCalledWith("/annotate", { tolerance: 500, resultType: "full" }, expect.objectContaining({ method: "POST", body: JSON.stringify(body), retries: 0, headers: { "Content-Type": "application/json" } }));
});

it.each([
  { method: "GET", path: "/pride/projects", params: { keyword: "cancer" } },
  { method: "GET", path: "/pride/projects/PXD000001/files", params: { filter: "raw" } },
  { method: "POST", path: "/pride/projects" },
  { method: "GET", path: "/proxi/annotate" },
  { method: "DELETE", path: "/proxi/annotate" },
  { method: "POST", path: "/proxi/annotate", body: [] },
  { method: "GET", path: "/unknown" },
])("rejects unsupported or misleading requests before upstream access: $path", async request => {
  await expect(api(request)).rejects.toThrow();
  expect(prideFetch).not.toHaveBeenCalled(); expect(proxiFetch).not.toHaveBeenCalled();
});

it("retains provider failure details instead of treating unsupported resources as no hits", async () => {
  vi.mocked(proxiFetch).mockResolvedValue(new Response("not implemented", { status: 501 }));
  await expect(api({ method: "GET", path: "/proxi/proteins", params: { resultType: "full" } })).rejects.toMatchObject({ status: 501, data: "not implemented" });
});
