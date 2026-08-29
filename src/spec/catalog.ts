/**
 * Proteomics Hub API catalog — two APIs fronted through one Code Mode tool pair.
 *
 * PRIDE Archive (EMBL-EBI):
 *   base: https://www.ebi.ac.uk/pride/ws/archive/v3
 *   Project-level proteomics submissions (PXD accessions).
 *   NB EBI retired v2 and now serves the v3 application at BOTH the /v2 and /v3
 *   paths (a 404 from /v2/stats reports its path as "/pride/ws/archive/v3/stats").
 *   Spring silently DROPS unknown query params rather than rejecting them, so a
 *   v2-era param sent to a v3 route returns a default UNFILTERED page that looks
 *   like a result set. Every param below is checked against the live v3 OpenAPI
 *   doc (https://www.ebi.ac.uk/pride/ws/archive/v3/v3/api-docs) — do not add a
 *   param that is not in it.
 *
 * ProteomeXchange PROXI (ProteomeCentral):
 *   base: https://proteomecentral.proteomexchange.org/api/proxi/v0.1
 *   Federated PSM / spectrum / peptidoform / protein search across repositories.
 *
 * Virtual paths are namespaced — the adapter strips the first segment and
 * routes the rest to the correct upstream:
 *   /pride/projects            → PRIDE    → /projects
 *   /proxi/datasets/PXD000001  → PROXI    → /datasets/PXD000001
 */

import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

export const proteomicsCatalog: ApiCatalog = {
    name: "Proteomics Hub (PRIDE Archive + ProteomeXchange PROXI)",
    baseUrl: "https://www.ebi.ac.uk",
    version: "1.1",
    auth: "none",
    endpointCount: 17,
    notes:
        "- Dual API. Always prefix paths: '/pride/...' for PRIDE Archive, '/proxi/...' for ProteomeXchange PROXI.\n" +
        "- PRIDE keyword search MUST go to /pride/search/projects: api.get('/pride/search/projects', {keyword: 'cancer', pageSize: 20})\n" +
        "- /pride/projects is an UNFILTERED paginated dump (pageSize/page only). It does NOT accept keyword/filter — PRIDE ignores them and returns the default project list, so a keyword sent there answers a different question than the one asked. The adapter rejects that call rather than return the lie.\n" +
        "- PRIDE project detail: api.get('/pride/projects/PXD001357')\n" +
        "- PRIDE project files filter on 'filenameFilter' (NOT 'filter').\n" +
        "- PROXI datasets federate results across PRIDE, MassIVE, PeptideAtlas, jPOST, iProX.\n" +
        "- PROXI /proteins, /psms and /peptidoforms are NOT IMPLEMENTED upstream (HTTP 501) — they are marked deprecated. For protein-level evidence use /pride/search/projects, or /proxi/spectra by USI.\n" +
        "- PROXI /spectra REQUIRES resultType. /datasets and /libraries default it.\n" +
        "- PROXI 'resultType=full' returns every repository hit — expect very large responses (stage them).\n" +
        "- Use /proxi/usi_examples when building a Universal Spectrum Identifier by hand.",
    endpoints: [
        // ===================================================================
        // PRIDE Archive v3 — project / file discovery
        // ===================================================================
        {
            method: "GET",
            path: "/pride/search/projects",
            summary: "Search PRIDE Archive projects by keyword, organism, tissue, disease, instrument, or date range — the ONLY PRIDE route that honors a keyword/filter",
            category: "pride_projects",
            featured: true,
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Free-text keyword search across project fields" },
                { name: "filter", type: "string", required: false, description: "Structured filter, 'field1==value1,field2==value2' (e.g. 'organisms==Homo sapiens')" },
                { name: "pageSize", type: "number", required: false, description: "Results per page (default 100)" },
                { name: "page", type: "number", required: false, description: "Zero-based page index" },
                { name: "dateGap", type: "string", required: false, description: "Date range bucket (e.g. '+1MONTH', '+1YEAR')" },
                { name: "sortFields", type: "string", required: false, description: "Comma-separated sort fields (default 'submission_date')" },
                { name: "sortDirection", type: "string", required: false, description: "ASC or DESC", enum: ["ASC", "DESC"] },
            ],
            example: "await api.get('/pride/search/projects', { keyword: 'polycystic ovary', pageSize: 20 })",
            usageHint: "Use this for every keyword/filter project lookup. An empty array here is a real zero-hit answer; /pride/projects cannot express a query at all.",
        },
        {
            method: "GET",
            path: "/pride/projects",
            summary: "Paginated dump of ALL PRIDE projects — accepts pageSize/page ONLY, cannot filter. For any keyword/filter use /pride/search/projects.",
            category: "pride_projects",
            queryParams: [
                { name: "pageSize", type: "number", required: false, description: "Results per page (default 100)" },
                { name: "page", type: "number", required: false, description: "Zero-based page index" },
            ],
            usageHint: "Never pass keyword/filter here — PRIDE silently ignores them and returns the default project list. The adapter throws instead of returning that unfiltered list as though it matched.",
        },
        {
            method: "GET",
            path: "/pride/projects/{accession}",
            summary: "Get a PRIDE project's full metadata by PXD accession",
            category: "pride_projects",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "PXD accession (e.g. 'PXD001357')" },
            ],
        },
        {
            method: "GET",
            path: "/pride/projects/{accession}/files",
            summary: "List submitted files for a PRIDE project (raw, result, search, SDRF, etc.)",
            category: "pride_files",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "PXD accession" },
            ],
            queryParams: [
                { name: "filenameFilter", type: "string", required: false, description: "Substring match on file name (e.g. 'raw'). PRIDE ignores a param named 'filter' here." },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
                { name: "page", type: "number", required: false, description: "Zero-based page index" },
            ],
        },
        {
            method: "GET",
            path: "/pride/files/{fileAccession}",
            summary: "Get a single PRIDE file record by file accession. PRIDE v3 has no cross-project file search — list files per project instead.",
            category: "pride_files",
            pathParams: [
                { name: "fileAccession", type: "string", required: true, description: "PRIDE file accession" },
            ],
        },
        {
            method: "GET",
            path: "/pride/files/sdrf/{projectAccession}",
            summary: "Get a project's SDRF (sample-to-data relationship) rows — the experimental design table",
            category: "pride_files",
            pathParams: [
                { name: "projectAccession", type: "string", required: true, description: "PXD accession" },
            ],
        },
        {
            method: "GET",
            path: "/pride/stats/submissions-monthly",
            summary: "PRIDE Archive monthly submission counts",
            category: "pride_meta",
        },
        {
            method: "GET",
            path: "/pride/facet/projects",
            summary: "Faceted breakdown of PRIDE projects (organism, instrument, disease, tissue, etc.)",
            category: "pride_meta",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Restrict facets to matching projects (honored here — this route is search-index backed)" },
                { name: "filter", type: "string", required: false, description: "Structured filter, same syntax as /pride/search/projects" },
                { name: "facetPageSize", type: "number", required: false, description: "Facet values per field" },
                { name: "facetPage", type: "number", required: false, description: "Zero-based facet page index" },
                { name: "dateGap", type: "string", required: false, description: "Date range bucket (e.g. '+1YEAR')" },
            ],
            usageHint: "Empty facet objects ({}) mean the keyword matched no projects — a real zero-hit answer.",
        },

        // ===================================================================
        // ProteomeXchange PROXI — federated PSM / peptide / protein / spectrum
        // ===================================================================
        {
            method: "GET",
            path: "/proxi/datasets",
            summary: "List ProteomeXchange datasets across all member repositories",
            category: "proxi_datasets",
            queryParams: [
                { name: "resultType", type: "string", required: false, description: "Response detail level", enum: ["compact", "full"] },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
                { name: "pageNumber", type: "number", required: false, description: "Zero-based page number" },
            ],
        },
        {
            method: "GET",
            path: "/proxi/datasets/{accession}",
            summary: "Retrieve a ProteomeXchange dataset record (PXD/MSV) with cross-repository metadata",
            category: "proxi_datasets",
            pathParams: [
                { name: "accession", type: "string", required: true, description: "PXD or MSV accession" },
            ],
        },
        {
            method: "GET",
            path: "/proxi/libraries",
            summary: "List spectral libraries available via PROXI",
            category: "proxi_libraries",
            queryParams: [
                { name: "resultType", type: "string", required: false, description: "compact or full" },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        {
            method: "GET",
            path: "/proxi/spectra",
            summary: "Fetch mass spectra by Universal Spectrum Identifier (USI) or dataset filter",
            category: "proxi_spectra",
            queryParams: [
                { name: "usi", type: "string", required: false, description: "Universal Spectrum Identifier" },
                { name: "accession", type: "string", required: false, description: "Dataset accession filter" },
                { name: "resultType", type: "string", required: true, description: "REQUIRED here — omitting it is an HTTP 400", enum: ["compact", "full"] },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        {
            method: "GET",
            path: "/proxi/usi_examples",
            summary: "Curated example USIs — useful when learning the PROXI spectrum identifier format",
            category: "proxi_spectra",
        },

        // ===================================================================
        // PROXI — officially specified but NOT IMPLEMENTED at ProteomeCentral.
        // Verified live 2026-07-16: each returns HTTP 501 "Although this is an
        // officially defined PROXI endpoint, it has not yet been implemented at
        // this server" (the 400 you get first is only the resultType check
        // firing ahead of the 501). Marked deprecated so Code Mode cannot
        // select them; delete the flag if ProteomeCentral ever implements them.
        // ===================================================================
        {
            method: "GET",
            path: "/proxi/peptidoforms",
            summary: "[NOT IMPLEMENTED UPSTREAM — HTTP 501] Search peptidoforms (peptide + localized modifications) across repositories",
            category: "proxi_peptides",
            deprecated: true,
            queryParams: [
                { name: "peptideSequence", type: "string", required: false, description: "Stripped peptide sequence (e.g. 'AGSPTAEGR')" },
                { name: "modification", type: "string", required: false, description: "Modification accession / name filter" },
                { name: "resultType", type: "string", required: true, description: "compact or full", enum: ["compact", "full"] },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        {
            method: "GET",
            path: "/proxi/proteins",
            summary: "[NOT IMPLEMENTED UPSTREAM — HTTP 501] Search protein identifications across PROXI repositories",
            category: "proxi_proteins",
            deprecated: true,
            queryParams: [
                { name: "accession", type: "string", required: false, description: "UniProt accession" },
                { name: "resultType", type: "string", required: true, description: "compact or full", enum: ["compact", "full"] },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        {
            method: "GET",
            path: "/proxi/psms",
            summary: "[NOT IMPLEMENTED UPSTREAM — HTTP 501] Search peptide-spectrum matches (PSMs) across PROXI repositories",
            category: "proxi_psms",
            deprecated: true,
            queryParams: [
                { name: "peptideSequence", type: "string", required: false, description: "Stripped peptide sequence" },
                { name: "accession", type: "string", required: false, description: "Dataset accession filter" },
                { name: "resultType", type: "string", required: true, description: "compact or full", enum: ["compact", "full"] },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        {
            method: "GET",
            path: "/proxi/status",
            summary: "[DOES NOT EXIST — HTTP 404] PROXI endpoint health / status probe",
            category: "proxi_meta",
            deprecated: true,
        },
    ],
};
