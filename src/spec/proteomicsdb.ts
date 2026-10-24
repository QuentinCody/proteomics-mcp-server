import type { ApiEndpoint, ParamDef, WorkflowRecipe } from "@bio-mcp/shared/codemode/catalog";

const pagination: ParamDef[] = [
  { name: "$top", type: "number", required: false, default: 20, description: "Integer page size 1–100. No automatic continuation. Oversized responses fail explicitly." },
  { name: "$skip", type: "number", required: false, default: 0, description: "Integer offset 0–10000. Live OData views are not release-pinned; offsets can change as data updates." },
  { name: "$select", type: "string", required: false, description: "Up to 32 comma-separated uppercase native fields, max 1024 characters. Omit for all fields within the bounded page. Native OData metadata, counts and continuation links remain intact." },
];
const protein: ParamDef = { name: "PROTEINFILTER", type: "string", required: true, description: "One UniProt accession or entry name, for example P00533 or Q92769. No raw OData filter expressions." };
const description = "Documented ProteomicsDB public OData API v1.1 (https://www.proteomicsdb.org/api). No registration required. Returns complete parsed native OData JSON under native with _proteomicsdb source URL, timestamp, response hash and query bounds. Numeric-looking strings, nulls, __metadata, __count and __next are preserved. Continuation URLs are never fetched automatically. Requests are GET-only with fixed services, at most 100 rows, a 4 MiB response cap and header/body deadlines; results stage above 30 KiB. A page is not a complete or release-pinned dataset. No supported Kinobeads dose-response API has been qualified.";

export const proteomicsdbEndpoints: ApiEndpoint[] = [
  {
    method: "GET", path: "/proteomicsdb/protein-expression", category: "proteomicsdb.expression", featured: true,
    summary: "Read ProteomicsDB protein expression and tissue abundance evidence using documented OData parameters",
    description,
    queryParams: [protein,
      { name: "MS_LEVEL", type: "number", required: false, default: 1, description: "Quantification MS level: 1 or 2" },
      { name: "TISSUE_ID_SELECTION", type: "string", required: false, default: "", description: "Empty for all eligible tissues, or one BTO identifier, for example BTO:0000047; discover IDs with /proteomicsdb/tissues" },
      { name: "TISSUE_CATEGORY_SELECTION", type: "string", required: false, default: "tissue;fluid", description: "Distinct categories separated by semicolons: tissue, fluid, cell line" },
      { name: "SCOPE_SELECTION", type: "number", required: false, default: 1, description: "1: proteome; 2: affinity. Affinity scope is not itself a compound-binding measurement." },
      { name: "GROUP_BY_TISSUE", type: "number", required: false, default: 1, description: "1: group samples by biological origin; 0: retain separate samples" },
      { name: "CALCULATION_METHOD", type: "number", required: false, default: 0, description: "0: iBAQ; 1: TOP3. Preserve method and units when comparing abundance." },
      { name: "EXP_ID", type: "number", required: false, default: -1, description: "Experiment ID, -1 for the provider's unrestricted experiment selection; integer up to 2147483647" },
      ...pagination],
    example: "await api.get('/proteomicsdb/protein-expression', {PROTEINFILTER:'P00533', '$top':1, '$select':'UNIQUE_IDENTIFIER,TISSUE_ID,TISSUE_NAME,NORMALIZED_INTENSITY'})",
  },
  {
    method: "GET", path: "/proteomicsdb/protein-peptides", category: "proteomicsdb.peptides", featured: true,
    summary: "Read ProteomicsDB experimental protein peptide identification evidence",
    description: `${description} This service aggregates the best-scoring peptide per experiment independently of modifications; it is not a complete PSM inventory.`,
    queryParams: [protein, ...pagination],
    example: "await api.get('/proteomicsdb/protein-peptides', {PROTEINFILTER:'Q92769', '$top':1, '$select':'ENTRY_NAME,UNIQUE_IDENTIFIER'})",
  },
  {
    method: "GET", path: "/proteomicsdb/tissues", category: "proteomicsdb.expression",
    summary: "List ProteomicsDB tissues and cell lines with expression data",
    description,
    queryParams: pagination,
    example: "await api.get('/proteomicsdb/tissues', {'$top':20, '$select':'TISSUE_ID,TISSUE_NAME,TISSUE_CATEGORY'})",
  },
];

export const proteomicsdbWorkflow: WorkflowRecipe = {
  title: "Inspect ProteomicsDB tissue expression for a kinase",
  description: "Read one bounded EGFR abundance page with explicit quantification parameters. Keep this evidence separate from held-out binding labels: tissue expression is biological context, not a toxicity label, exposure measurement or Kinobeads affinity curve.",
  keywords: ["ProteomicsDB", "expression", "kinase", "EGFR", "tissue", "abundance"],
  code: "return await api.get('/proteomicsdb/protein-expression', {PROTEINFILTER:'P00533', MS_LEVEL:1, TISSUE_CATEGORY_SELECTION:'tissue;fluid', SCOPE_SELECTION:1, GROUP_BY_TISSUE:1, CALCULATION_METHOD:0, EXP_ID:-1, '$top':20});",
};
