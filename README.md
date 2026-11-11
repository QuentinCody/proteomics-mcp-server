# proteomics-mcp-server

MCP server for PRIDE Archive, ProteomeCentral PROXI, iProX, ProteomicsDB and community SDRF annotations,
available through one Code Mode tool pair.

- Upstreams:
  - PRIDE Archive v3 — `https://www.ebi.ac.uk/pride/ws/archive/v3`
  - ProteomeXchange PROXI — `https://proteomecentral.proteomexchange.org/api/proxi/v0.1`
  - iProX dataset metadata — `https://www.iprox.cn/proxi/datasets/{accession}`
  - ProteomicsDB public OData — `https://www.proteomicsdb.org/proteomicsdb/logic/api/`
  - Community SDRF — `bigbio/sdrf-annotated-datasets`, read at explicit Git commits
- Port: `8888`
- Tools: `proteomics_search`, `proteomics_execute`, `proteomics_query_data`, `proteomics_get_schema`
  and their `mcp_` aliases.

## Routing

Virtual paths are namespaced. The adapter (`src/lib/api-adapter.ts`) strips
the first path segment and routes the rest to the matching upstream:

| Virtual path                       | Upstream call                                                                 |
|------------------------------------|-------------------------------------------------------------------------------|
| `/pride/projects`                  | `GET https://www.ebi.ac.uk/pride/ws/archive/v3/projects`                      |
| `/pride/projects/PXD001357`        | `GET https://www.ebi.ac.uk/pride/ws/archive/v3/projects/PXD001357`            |
| `/proxi/datasets`                  | `GET https://proteomecentral.proteomexchange.org/api/proxi/v0.1/datasets`     |
| `/proxi/datasets/PXD000001`        | `GET https://proteomecentral.proteomexchange.org/api/proxi/v0.1/datasets/PXD000001` |
| `/proxi/annotate`                  | `POST https://proteomecentral.proteomexchange.org/api/proxi/v0.1/annotate` |
| `/iprox/datasets/PXD008840`        | `GET https://www.iprox.cn/proxi/datasets/PXD008840` |
| `/proteomicsdb/protein-expression` | `proteinexpression.xsodata/InputParams(...)/Results` |
| `/proteomicsdb/protein-peptides` | `proteinpeptideresult.xsodata/InputParams(...)/Results` |
| `/proteomicsdb/tissues` | `tissuelist.xsodata/CA_AVAILABLEBIOLOGICALSOURCES_API` |

## ProteomicsDB extension — October 23, 2026

The existing tools now expose three documented public OData reads. Search with
`ProteomicsDB expression`, then use the virtual paths above. This extends the
existing multi-API server; no new tool prefix or credentials are required.

```javascript
return await api.get('/proteomicsdb/protein-expression', {
  PROTEINFILTER: 'P00533', // EGFR
  MS_LEVEL: 1, TISSUE_CATEGORY_SELECTION: 'tissue;fluid',
  SCOPE_SELECTION: 1, GROUP_BY_TISSUE: 1, CALCULATION_METHOD: 0, EXP_ID: -1,
  '$top': 20,
  '$select': 'UNIQUE_IDENTIFIER,TISSUE_ID,TISSUE_NAME,NORMALIZED_INTENSITY'
});
```

The adapter constructs fixed upstream service URLs from typed selectors rather
than accepting raw OData expressions. `$top` is 1–100 (default 20), `$skip` is
0–10000, and `$select` allows at most 32 native field names. `$format=json` is
fixed. Unknown parameters, arbitrary URLs, mutation methods and bodies fail before
network access. Each call makes one request with no retries or automatic paging;
the existing 25-second header, 10-second body and 4 MiB body limits apply.

The complete parsed OData response stays under `native`, including `d.results`,
`__metadata`, numeric-looking strings, nulls, counts and continuation URLs. The
adapter never follows `__next`. `_proteomicsdb` records the precise source URL,
retrieval time, parsed-response SHA-256, response headers and page bounds.
Malformed OData and upstream row-limit violations fail with their native payload
retained. Pages do not establish complete coverage, and offsets on the live view
are not release-pinned. Existing staging retains the original envelope and
projects returned rows to `proteomicsdb_rows` for SQL access.

Read-only upstream probes on October 23 returned HTTP 200 with `$top=1`:

- Peptide query for `Q92769`: `HDAC2_HUMAN`, `Q92769` (316-byte JSON).
- Expression query for `P00533`: adrenal gland (`BTO:0000047`) with native
  `NORMALIZED_INTENSITY` string `4.483880889224657` (378-byte JSON).
- Tissue catalog: HEK-293 cell (`BTO:0000007`), category `cell line` (337-byte JSON).

These qualify the three provider services, not the deployed MCP Worker. Automated
tests cover typed bounds, injection rejection, native OData and paging preservation,
failure envelopes, source hashes, staging, SQL, citations and both tool aliases.
Run the server's focused tests and live contract harness before deployment.

Expression is biological context; it is neither exposure nor toxicity. The peptide
service reports aggregated experimental identification evidence, not a complete
PSM or modification inventory. Affinity experiment scope does **not** turn an
abundance estimate into a binding constant. Although ProteomicsDB contains
Kinobeads data, a supported dose-response API route was not verified, so none is
exposed. Benchmark labels must remain outside prediction inputs.

Provider references: [public API documentation](https://www.proteomicsdb.org/api),
[ProteomicsDB biochemical-assay description](https://doi.org/10.1093/nar/gkx1029),
and [2026 database update](https://doi.org/10.1093/nar/gkaf1265).
Drift risk is medium: recheck the three examples and OData `$metadata` schemas
monthly and before relying on new fields. Access without registration does not
establish unrestricted redistribution rights for every underlying study.

## Provider acceptance — October 4, 2026

The actual bundled Worker was tested locally with SQLite Durable Objects,
WorkerLoader and verified TLS. Native PRIDE project/file metadata and SDRF links,
commit-pinned community TSV reads, PROXI datasets/libraries/spectra, and Quetzal
annotation succeeded. iProX dataset detail timed out after 25 seconds; its positive
schema/data acceptance remains pending. This does not establish support for other
PROXI hosts or resources.

- `PXD000070` has six rows and 30 columns in the selected community SDRF;
  `PXD001357` has 63 rows and 35 columns. Both were read at commit
  `7c10dcfa59eaf90bee489d6000a2542548a2474a`. The latter TSV matches the PRIDE-linked
  community artifact byte-for-byte after UTF-8 decoding (SHA-256
  `db50ebc37c81a0b40e46e60a8757c80e14e642a02b2282324e7d1f25c8a62186`).
  This verifies the selected annotation artifact, not deposited raw files.
- The first 20-file page for `PXD000070` has no exact sample filename matches.
  A targeted `filenameFilter` request finds one exact record for
  `OTPf-IMACDDNL_2010Mar06-02.raw`, matching one SDRF row. A missing match on a
  partial page remains inconclusive; filename equality does not verify identity.
- PROXI dataset pages are **one-based**: 0 is clamped to page 1, and page 2
  returns different records. Compact rows are positional arrays; the native
  `result_set.datasets_title_list` supplies their columns. A real 100-dataset
  page round-trips through staging/SQL. Library page 2 also returns distinct rows.
- The recipe USI returns one spectrum with 84 paired peaks. Quetzal returns one
  computed annotation with 84 output peaks/interpretations for that spectrum,
  using the USI peptidoform as explicit input and 10 ppm tolerance. Source spectra,
  parameters, native status/logs and computed output remain separate evidence.
- All tool aliases carry verifiable citations, including SQL/schema/errors.
  Oversized whole envelopes receive a fresh citation for the complete staged
  response. SQL preserves repeated SDRF columns, compact dataset cell positions,
  and peak/intensity/interpretation positions; original payloads remain recoverable.
  Coverage never labels these pages or selected annotations complete project evidence.

The [2026 consortium report](https://pmc.ncbi.nlm.nih.gov/articles/PMC12807779/)
(published November 6, 2025) describes federated USI resolution. A common PROXI
specification does not establish that each host implements every resource.

| Host / resource | Evidence and current routing |
| --- | --- |
| PRIDE Archive v3 | Existing project/file routes retained. Current [OpenAPI](https://www.ebi.ac.uk/pride/ws/archive/v3/v3/api-docs) declares SDRF as a string array, not parsed sample objects. |
| ProteomeCentral datasets, spectra, libraries | Native success and Worker/SQL acceptance on October 4. Preserve repository-specific responses and failures. |
| ProteomeCentral peptidoforms, proteins, PSMs | Each still returns HTTP 501 on October 4; complete native error bodies survive. Remain deprecated; a project keyword hit is not identification evidence. |
| ProteomeCentral Quetzal annotation | Native and Worker POST succeeded for the public example spectrum. See [provider contract](https://github.com/Quetzal-Annotator/quetzal-annotator#public-api). |
| iProX PROXI | [Provider documentation](https://www.iprox.cn/page/helpEn.html) documents the implemented dataset-detail read. The current example times out; positive data acceptance and broader list/identification/spectrum schemas remain pending. |

### Direct iProX dataset metadata — October 1, 2026

```javascript
return await api.get('/iprox/datasets/PXD008840');
```

This uses the exact dataset-detail path in the provider's manual and
[iProX publication](https://pmc.ncbi.nlm.nih.gov/articles/PMC8728291/).
The local adapter accepts a PXD accession with six digits and no query parameters.
It makes one public GET to iProX, with no retries, host fallback or linked-file
downloads. Redirects fail explicitly. The request has a 25-second abort deadline;
the existing response reader also limits bodies to ten seconds and 4 MiB.

The response keeps complete parsed JSON under `native`, plus `requested_accession`
and `_iprox` source URL, retrieval time, response headers and parsed-response
SHA-256. These fields are request/source context; `dataset_identity_verified` and
`release_pinned` remain false. Inspect native identifiers, status and provider
errors before joining to other repositories. Metadata is not protein/peptide
identification evidence. Large results use the existing staging and SQL tools.

Twenty initial behavioral tests cover routing, rejected inputs, native preservation,
HTTP errors, redirects, limits, staging and both search aliases. Current acceptance
returns a bounded HTTP 504 with the requested accession and source URL when iProX
does not respond. Positive schema/data acceptance remains pending. The
[ProteomeCentral status dashboard](https://proteomecentral.proteomexchange.org/PROXI.php)
rendered only its loading shell during this review, so no current host-support
matrix was established. No new 2026 iProX endpoint announcement is claimed.

### Community SDRF annotations

The [SDRF maintainers](https://github.com/bigbio/proteomics-sample-metadata) now
direct annotated datasets to `bigbio/sdrf-annotated-datasets`, under
`datasets/{ACCESSION}/{ACCESSION}.sdrf.tsv`. This is an alternate metadata source,
not an automatic replacement for submitted metadata. PRIDE can display
[community annotations unverified by submitters](https://www.ebi.ac.uk/pride/archive/projects/PXD040502).
The existing Worker now provides `/sdrf/revision`,
`/sdrf/projects/{accession}/files` and `/sdrf/projects/{accession}/file` through Code
Mode. Discover a full commit SHA, list that project's files at the same commit, and
select an explicit filename. Multiple SDRFs can describe split experimental designs;
one file does not establish complete project coverage. GitHub's directory cap is
reported when completeness cannot be established.

Reads preserve the full native TSV, ordered headers (including duplicates), raw
string cells as `cells_json`, source line numbers, repository/commit and a SHA-256
of decoded UTF-8 text (including an existing BOM). Parsing ignores a leading BOM
without changing the retained text or hash. An optional `data_file` filter matches
exactly and preserves every matching sample/channel row. Limits are 4 MiB, 20,000
rows and 512 columns; exceeding them fails explicitly. This parser checks table
shape, not the full SDRF specification or ontology validity. Community annotations
may include AI-assisted curation; submitter and deposited-file verification remain
unknown. No raw mass-spectrometry files are downloaded.

## Recipes and annotation

Search exposes the direct iProX dataset recipe above and three archive workflows: project + SDRF + one file page,
provider-issued USI + dataset context, and commit-pinned community SDRF + exact
PRIDE filename matches. They retain native responses/errors/staging references
separately. The last recipe keeps every sample/channel row and every matching file
record within the selected page; no match on that page is inconclusive. None claims
a complete file inventory, verified biological identity or a sample-to-spectrum
join. The USI example is from the [PSI discussion](https://github.com/HUPO-PSI/usi/issues/1).

Quetzal accepts an array of spectra with paired numeric `mzs`/`intensities` arrays:

```javascript
// Synthetic peak list: replace with the spectra and metadata you intend to analyze.
const spectra = [{mzs: [100.5, 200.25], intensities: [10, 20]}];
const parameters = {resultType: 'full', tolerance: 10}; // ppm
const annotations = await api.post('/proxi/annotate', spectra, parameters);
return {spectra, parameters, annotations};
```

The adapter preserves attributes, interpretations and extensions. It rejects
mismatched, nonnumeric, nonfinite or descending peak arrays; it never sorts peaks
independently of intensities. The local limit is 100 spectra and 4 MiB per request.
POST is not retried. An annotation is an algorithmic interpretation, not proof
of identity. Retain the original spectra and parameters with the result.
The provider can remove zero-intensity input peaks; pair interpretations with
the returned output arrays, not input indices. A native `status.status_code` of
400 or greater is an explicit error even when HTTP itself returned 200.

Reads have a 25-second request budget plus a 10-second body deadline and a 4 MiB
response bound. Larger responses fail explicitly; successful results and provider
errors above 30 KiB stage through the shared data store. Complete oversized MCP
responses, including SQL/schema reads, also stage with both response fields and
error status retained. Follow staged references
with `proteomics_get_schema` / `proteomics_query_data`. The 60-second Code Mode
budget can limit multi-request recipes. Raw archive files require provider bulk
transfer rather than this metadata/spectrum adapter.

Current validation: 101 focused tests, 14 static checks, TypeScript/lint and the
dry bundle pass. The live fleet contract passes; separate acceptance recovers
real staged SDRF/dataset/SQL payloads and verifies their citation hashes. The full
suite passes 13,424 tests with 109 skipped. See the
[implementation tracker](../../docs/plans/2026-09-26-upstream-api-implementation.md)
for receipts and remaining provider limitations.

## Local dev

```bash
./scripts/dev-servers.sh proteomics
```

<!-- license-and-data-terms:start -->
## License and data terms

The code in this repository is licensed under the Apache License 2.0 (see `LICENSE`).
If you use it in your work, please cite it (see `CITATION.cff`). Citation is requested, not required.

The license covers the code only. Data that this server returns comes from PRIDE, PROXI, iProX and stays under the terms of that source: PRIDE open (EMBL-EBI); iProX CC0 since 2023-03-23 and CC BY 4.0 before, with a conflicting personal-use clause.
You are responsible for your use of the data under those terms.
<!-- license-and-data-terms:end -->
