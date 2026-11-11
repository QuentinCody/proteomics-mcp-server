import type { WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";

export const proteomicsWorkflows: WorkflowRecipe[] = [
  {
    title: "PRIDE project, SDRF and file context",
    description: "Keep independent native responses, including errors/staging references. File page zero is not a complete inventory. SDRF can be community annotated; do not assume submitter verification or parse the documented string array as sample objects.",
    keywords: ["project", "sample", "SDRF", "experimental design", "files"],
    code: `const accession = 'PXD001357';
const [project, sdrf, files] = await Promise.all([
  api.get('/pride/projects/' + accession),
  api.get('/pride/files/sdrf/' + accession),
  api.get('/pride/projects/' + accession + '/files', {page: 0, pageSize: 20})
]);
return {accession, project, sdrf, files, file_page: 0, complete_file_inventory: false, sample_file_join_performed: false};`,
  },
  {
    title: "USI spectrum with dataset context",
    description: "Use a provider-issued USI; retain every repository response and peak array. A PXD collection identifies dataset context, not a validated sample join or confirmed peptide identification. The HUPO-PSI example returned one spectrum with 84 paired peaks on 2026-10-04; availability can change.",
    keywords: ["USI", "spectrum", "dataset", "PXD", "PROXI"],
    code: `const usi = 'mzspec:PXD013210:TTB20160722_ISBHJOMXX001879_r01:scan:19809:SITS[phospho]PTTLYDR/2';
const accession = usi.split(':')[1];
if (!/^PXD[0-9]+$/.test(accession)) throw new Error('This recipe requires a PXD collection; other USI collections need their own resolver');
const [dataset, spectra] = await Promise.all([
  api.get('/proxi/datasets/' + accession),
  api.get('/proxi/spectra', {usi, resultType: 'full'})
]);
return {usi, accession, dataset, spectra, sample_file_join_performed: false};`,
  },
  {
    title: "Commit-pinned SDRF sample and PRIDE file matches",
    description: "Discover the community revision and split-design files, then match one explicitly selected SDRF to one PRIDE file page by exact filename. Keep all sample/channel rows and all matching file records. No match on a partial page is inconclusive; filenames do not verify file bytes or sample identity. Errors and staged inputs remain recoverable.",
    keywords: ["SDRF", "sample", "file", "join", "commit", "community"],
    code: `const accession = 'PXD000070';
const filename = 'PXD000070.sdrf.tsv';
const revision = await api.get('/sdrf/revision');
if (revision.__staged || revision.__api_error || !revision.commit) return {revision, sample_file_join_performed: false};
const commit = revision.commit;
const manifest = await api.get('/sdrf/projects/' + accession + '/files', {commit});
if (manifest.__staged || manifest.__api_error || !Array.isArray(manifest.files) || !manifest.files.some(file => file.filename === filename)) return {revision, manifest, sample_file_join_performed: false};
const [sdrf, files] = await Promise.all([
  api.get('/sdrf/projects/' + accession + '/file', {commit, filename}),
  api.get('/pride/projects/' + accession + '/files', {page: 0, pageSize: 20})
]);
const context = {accession, revision, manifest, sdrf, files, complete_file_inventory: false, complete_project_design: false};
if (sdrf.__staged || files.__staged || sdrf.__api_error || files.__api_error || !Array.isArray(sdrf.rows) || !Array.isArray(files)) return {...context, sample_file_join_performed: false};
const matches = sdrf.rows.map(row => ({...row, archive_files: files.filter(file => row.data_file && file.fileName === row.data_file)}));
return {...context, matches, sample_file_join_performed: true, join_semantics: 'Exact filename matches within this file page only; not file-content or biological identity validation'};`,
  },
];
