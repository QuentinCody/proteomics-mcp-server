import type { ApiEndpoint, WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";

export const iproxDatasetEndpoint: ApiEndpoint = {
  method: "GET", path: "/iprox/datasets/{accession}", category: "iprox_datasets", featured: true,
  summary: "Read public dataset metadata directly from iProX by PXD accession",
  description: "Provider-documented https://www.iprox.cn/proxi/datasets/{accession}. Returns the complete native JSON under native, with request context and _iprox source/hash metadata. No extra filters, pagination, credentials, automatic host fallback or linked-file downloads. Protein/peptide/spectrum and list contracts require separate qualification. HTTP failures retain provider evidence. Live schema/data acceptance remains pending; inspect native identifiers/status before joining.",
  pathParams: [{name: "accession", type: "string", required: true, description: "PXD followed by six digits; provider example PXD008840. An iProX IPX identifier is distinct."}],
};

export const iproxDatasetWorkflow: WorkflowRecipe = {
  title: "Inspect iProX dataset metadata at its source",
  description: "Use the provider's documented example or another known public iProX PXD accession. Retain native response and source context. Staged handles remain available through proteomics_get_schema/proteomics_query_data. Dataset metadata is not evidence of a protein identification or a verified sample-to-spectrum join.",
  keywords: ["iProX", "PROXI", "dataset", "PXD", "alternate repository"],
  code: 'return await api.get("/iprox/datasets/PXD008840");',
};
