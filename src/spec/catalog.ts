/**
 * Proteomics Hub API catalog — two APIs fronted through one Code Mode tool pair.
 *
 * PRIDE Archive (EMBL-EBI):
 *   base: https://www.ebi.ac.uk/pride/ws/archive/v2
 *   Project-level proteomics submissions (PXD accessions).
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
    version: "1.0",
    auth: "none",
    endpointCount: 15,
    notes:
        "- Dual API. Always prefix paths: '/pride/...' for PRIDE Archive, '/proxi/...' for ProteomeXchange PROXI.\n" +
        "- PRIDE project search: api.get('/pride/projects', {keyword: 'cancer', pageSize: 20})\n" +
        "- PRIDE project detail: api.get('/pride/projects/PXD001357')\n" +
        "- PROXI datasets federate results across PRIDE, MassIVE, PeptideAtlas, jPOST, iProX.\n" +
        "- PROXI PSM / peptidoform / protein / spectrum queries usually accept accession, peptideSequence, or usi params.\n" +
        "- PROXI 'resultType=full' returns every repository hit — expect very large responses (stage them).\n" +
        "- Use /proxi/usi_examples when building a Universal Spectrum Identifier by hand.",
    endpoints: [
        // ===================================================================
        // PRIDE Archive v2 — project / file discovery
        // ===================================================================
        {
            method: "GET",
            path: "/pride/projects",
            summary: "Search PRIDE Archive projects by keyword, organism, tissue, disease, instrument, or date range",
            category: "pride_projects",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Free-text keyword search" },
                { name: "filter", type: "string", required: false, description: "Structured filter (e.g. 'organisms==Homo sapiens')" },
                { name: "pageSize", type: "number", required: false, description: "Results per page (default 100)" },
                { name: "page", type: "number", required: false, description: "Zero-based page index" },
                { name: "sortFields", type: "string", required: false, description: "Sort field (e.g. 'submission_date')" },
                { name: "sortDirection", type: "string", required: false, description: "ASC or DESC", enum: ["ASC", "DESC"] },
            ],
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
                { name: "filter", type: "string", required: false, description: "File-level filter" },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        {
            method: "GET",
            path: "/pride/files",
            summary: "Search files directly across all PRIDE projects",
            category: "pride_files",
            queryParams: [
                { name: "filter", type: "string", required: false, description: "Structured file filter" },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
                { name: "page", type: "number", required: false, description: "Zero-based page index" },
            ],
        },
        {
            method: "GET",
            path: "/pride/stats",
            summary: "PRIDE Archive summary statistics (submissions, organisms, instruments)",
            category: "pride_meta",
        },
        {
            method: "GET",
            path: "/pride/facet/projects",
            summary: "Faceted breakdown of PRIDE projects (organism, instrument, disease, tissue, etc.)",
            category: "pride_meta",
            queryParams: [
                { name: "keyword", type: "string", required: false, description: "Restrict facets to matching projects" },
                { name: "facetPageSize", type: "number", required: false, description: "Facet values per field" },
            ],
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
            path: "/proxi/peptidoforms",
            summary: "Search peptidoforms (peptide + localized modifications) across repositories",
            category: "proxi_peptides",
            queryParams: [
                { name: "peptideSequence", type: "string", required: false, description: "Stripped peptide sequence (e.g. 'AGSPTAEGR')" },
                { name: "modification", type: "string", required: false, description: "Modification accession / name filter" },
                { name: "resultType", type: "string", required: false, description: "compact or full" },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        {
            method: "GET",
            path: "/proxi/proteins",
            summary: "Search protein identifications across PROXI repositories",
            category: "proxi_proteins",
            queryParams: [
                { name: "accession", type: "string", required: false, description: "UniProt accession" },
                { name: "resultType", type: "string", required: false, description: "compact or full" },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        {
            method: "GET",
            path: "/proxi/psms",
            summary: "Search peptide-spectrum matches (PSMs) across PROXI repositories",
            category: "proxi_psms",
            queryParams: [
                { name: "peptideSequence", type: "string", required: false, description: "Stripped peptide sequence" },
                { name: "accession", type: "string", required: false, description: "Dataset accession filter" },
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
                { name: "resultType", type: "string", required: false, description: "compact or full" },
                { name: "pageSize", type: "number", required: false, description: "Results per page" },
            ],
        },
        {
            method: "GET",
            path: "/proxi/usi_examples",
            summary: "Curated example USIs — useful when learning the PROXI spectrum identifier format",
            category: "proxi_spectra",
        },
        {
            method: "GET",
            path: "/proxi/status",
            summary: "PROXI endpoint health / status probe",
            category: "proxi_meta",
        },
    ],
};
