import { expect, it, vi } from "vitest";
import { proteomicsWorkflows } from "./workflows";

it("preserves independent project/SDRF failures and staged file references", async () => {
  const project = { accession: "PXD001357", references: [{ doi: "fixture" }] };
  const sdrf = { __api_error: true, status: 404, data: "no SDRF" };
  const files = { __staged: true, data_access_id: "files", _staging: { table: "data" } };
  const get = vi.fn().mockResolvedValueOnce(project).mockResolvedValueOnce(sdrf).mockResolvedValueOnce(files);
  const run = new Function("api", `return (async () => {${proteomicsWorkflows[0].code}})()`);
  expect(await run({ get })).toEqual({ accession: "PXD001357", project, sdrf, files, file_page: 0, complete_file_inventory: false, sample_file_join_performed: false });
  expect(get).toHaveBeenLastCalledWith("/pride/projects/PXD001357/files", { page: 0, pageSize: 20 });
});

it("uses the USI collection for context without discarding repository results", async () => {
  const spectra = [{ provider: "PRIDE", status: "unavailable" }, { provider: "MassIVE", mzs: [100], intensities: [5] }];
  const get = vi.fn().mockResolvedValueOnce({ accession: "PXD013210" }).mockResolvedValueOnce(spectra);
  const run = new Function("api", `return (async () => {${proteomicsWorkflows[1].code}})()`);
  expect(await run({ get })).toMatchObject({ accession: "PXD013210", spectra, sample_file_join_performed: false });
  expect(get).toHaveBeenNthCalledWith(1, "/proxi/datasets/PXD013210");
  expect(get).toHaveBeenLastCalledWith("/proxi/spectra", { usi: expect.stringContaining(":scan:19809:"), resultType: "full" });
});

it("pins SDRF reads and preserves many-to-many exact filename matches without treating a file page as complete", async () => {
  const revision = { commit: "a".repeat(40) };
  const manifest = { files: [{ filename: "PXD000070.sdrf.tsv" }, { filename: "split.sdrf.tsv" }] };
  const sdrf = { rows: [{ source_name: "001", data_file: "a.raw" }, { source_name: "002", data_file: "a.raw" }, { source_name: "003", data_file: "A.raw" }] };
  const files = [{ fileName: "a.raw", accession: "F1" }, { fileName: "a.raw", accession: "F2" }];
  const get = vi.fn().mockResolvedValueOnce(revision).mockResolvedValueOnce(manifest).mockResolvedValueOnce(sdrf).mockResolvedValueOnce(files);
  const run = new Function("api", `return (async () => {${proteomicsWorkflows[2].code}})()`);
  expect(await run({ get })).toMatchObject({ revision, manifest, sdrf, files, complete_file_inventory: false, complete_project_design: false, sample_file_join_performed: true,
    matches: [{ source_name: "001", archive_files: files }, { source_name: "002", archive_files: files }, { source_name: "003", archive_files: [] }] });
  expect(get).toHaveBeenNthCalledWith(3, "/sdrf/projects/PXD000070/file", { commit: revision.commit, filename: "PXD000070.sdrf.tsv" });
});

it.each([{ __staged: true, data_access_id: "sdrf" }, { __api_error: true, status: 404 }])("returns staged or failed inputs without fabricating an empty join: %j", async sdrf => {
  const get = vi.fn().mockResolvedValueOnce({ commit: "a".repeat(40) }).mockResolvedValueOnce({ files: [{ filename: "PXD000070.sdrf.tsv" }] }).mockResolvedValueOnce(sdrf).mockResolvedValueOnce([]);
  const run = new Function("api", `return (async () => {${proteomicsWorkflows[2].code}})()`);
  expect(await run({ get })).toMatchObject({ sdrf, sample_file_join_performed: false });
});
