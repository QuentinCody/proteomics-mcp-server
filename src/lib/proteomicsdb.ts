import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { requestProteomics } from "./request";

const BASE = "https://www.proteomicsdb.org/proteomicsdb/logic/api/";
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const fail = (message: string): never => { throw Object.assign(new Error(message), { status: 400 }); };
const COMMON = ["$top", "$skip", "$select"];
const EXPRESSION = ["PROTEINFILTER", "MS_LEVEL", "TISSUE_ID_SELECTION", "TISSUE_CATEGORY_SELECTION", "SCOPE_SELECTION", "GROUP_BY_TISSUE", "CALCULATION_METHOD", "EXP_ID"];

function integer(params: Record<string, unknown>, key: string, fallback: number, min: number, max: number) {
  const value = params[key] === undefined ? fallback : params[key];
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail(`${key} must be an integer from ${min} to ${max}`);
  return value as number;
}

function accession(params: Record<string, unknown>) {
  const value = params.PROTEINFILTER;
  // Accept accession/entry-name syntax, not raw OData expressions or wildcard scans.
  if (typeof value !== "string" || !/^[A-Z0-9][A-Z0-9_-]{1,63}$/.test(value)) fail("PROTEINFILTER requires one UniProt accession or entry name (2–64 uppercase letters, digits, underscore or hyphen)");
  return `'${value}'`;
}

function expressionInputs(params: Record<string, unknown>) {
  const tissue = params.TISSUE_ID_SELECTION === undefined ? "" : params.TISSUE_ID_SELECTION;
  const categories = params.TISSUE_CATEGORY_SELECTION === undefined ? "tissue;fluid" : params.TISSUE_CATEGORY_SELECTION;
  if (typeof tissue !== "string" || (tissue !== "" && !/^BTO:[0-9]{7}$/.test(tissue))) fail("TISSUE_ID_SELECTION must be empty or one BTO identifier, for example BTO:0000047");
  if (typeof categories !== "string" || !/^(tissue|fluid|cell line)(;(tissue|fluid|cell line)){0,2}$/.test(categories) || new Set(categories.split(";")).size !== categories.split(";").length) fail("TISSUE_CATEGORY_SELECTION requires distinct tissue, fluid or cell line values separated by semicolons");
  return [
    `PROTEINFILTER=${accession(params)}`, `MS_LEVEL=${integer(params, "MS_LEVEL", 1, 1, 2)}`,
    `TISSUE_ID_SELECTION='${tissue}'`, `TISSUE_CATEGORY_SELECTION='${categories}'`,
    `SCOPE_SELECTION=${integer(params, "SCOPE_SELECTION", 1, 1, 2)}`,
    `GROUP_BY_TISSUE=${integer(params, "GROUP_BY_TISSUE", 1, 0, 1)}`,
    `CALCULATION_METHOD=${integer(params, "CALCULATION_METHOD", 0, 0, 1)}`,
    `EXP_ID=${integer(params, "EXP_ID", -1, -1, 2147483647)}`,
  ].join(",");
}

/** Fixed upstream services; no raw OData, arbitrary hosts, mutations or automatic paging. */
export function proteomicsdbRequest(path: string, params: Record<string, unknown> = {}) {
  const supported = ["/proteomicsdb/protein-peptides", "/proteomicsdb/protein-expression", "/proteomicsdb/tissues"];
  if (!supported.includes(path)) fail("Use /proteomicsdb/protein-peptides, /proteomicsdb/protein-expression or /proteomicsdb/tissues; Kinobeads dose-response routes are not qualified");
  const allowed = [...COMMON, ...(path.endsWith("protein-expression") ? EXPRESSION : path.endsWith("protein-peptides") ? ["PROTEINFILTER"] : [])];
  for (const key of Object.keys(params)) if (!allowed.includes(key)) fail(`Unsupported ProteomicsDB parameter: ${key}`);
  const top = integer(params, "$top", 20, 1, 100);
  const skip = integer(params, "$skip", 0, 0, 10000);
  const select = params.$select;
  if (select !== undefined && (typeof select !== "string" || select.length > 1024 || !/^[A-Z][A-Z0-9_]*(,[A-Z][A-Z0-9_]*){0,31}$/.test(select))) fail("$select requires up to 32 comma-separated uppercase field names (at most 1024 characters)");
  const resource = path.endsWith("tissues") ? "tissuelist.xsodata/CA_AVAILABLEBIOLOGICALSOURCES_API"
    : path.endsWith("protein-peptides") ? `proteinpeptideresult.xsodata/InputParams(PROTEINFILTER=${accession(params)})/Results`
      : `proteinexpression.xsodata/InputParams(${expressionInputs(params)})/Results`;
  const url = new URL(BASE + resource);
  url.searchParams.set("$format", "json");
  url.searchParams.set("$top", String(top));
  url.searchParams.set("$skip", String(skip));
  if (typeof select === "string") url.searchParams.set("$select", select);
  return { url: url.toString(), top, skip };
}

export const proteomicsdbFetch: ApiFetchFn = async request => {
  if (request.method !== "GET" || request.body !== undefined) throw Object.assign(new Error("ProteomicsDB supports GET without a body"), { status: 405 });
  const { url, top, skip } = proteomicsdbRequest(request.path, request.params);
  let observed: Awaited<ReturnType<typeof requestProteomics>>;
  try { observed = await requestProteomics(url, { Accept: "application/json", "User-Agent": "bio-mcp-proteomics" }); }
  catch (error) {
    if (error instanceof Error) {
      const detail = error as Error & { data?: unknown };
      detail.data = { native_error: detail.data, source_url: url };
    }
    throw error;
  }
  const { result, response } = observed;
  const native = result.data;
  if (!record(native) || !record(native.d) || !Array.isArray(native.d.results) || native.d.results.some(row => !record(row))) {
    throw Object.assign(new Error("ProteomicsDB did not return the documented OData d.results collection"), { status: 502, data: { native, source_url: url } });
  }
  if (native.d.results.length > top) throw Object.assign(new Error("ProteomicsDB exceeded the requested $top; no rows were silently discarded"), { status: 502, data: { native, source_url: url } });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(native)));
  return { status: result.status, data: { native, _proteomicsdb: {
    source_url: url, retrieved_at: new Date().toISOString(),
    etag: response.headers.get("etag"), last_modified: response.headers.get("last-modified"),
    response_sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
    hash_scope: "JSON.stringify of the complete parsed upstream response",
    returned_records: native.d.results.length, requested_top: top, requested_skip: skip,
    automatic_paging: false, release_pinned: false, complete_dataset: false,
    evidence_scope: request.path.endsWith("protein-peptides") ? "Aggregated observed peptides: best-scoring peptide per experiment, independent of modifications. Not a complete PSM/modification inventory or drug-target binding assay."
      : request.path.endsWith("tissues") ? "One page of biological sources with expression data; no inference of absence from a missing tissue."
        : "Protein abundance estimates for the requested MS level, tissue, scope, grouping, calculation method and experiment. Affinity scope does not establish a drug-binding affinity or a Kinobeads dose-response curve.",
  } } };
};
