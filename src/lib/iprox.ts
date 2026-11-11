import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { requestProteomics } from "./request";

/** iProX's documented public dataset read; other hosts' PROXI filters are not assumed. */
export const iproxFetch: ApiFetchFn = async request => {
  if (request.method !== "GET" || request.body !== undefined) {
    throw Object.assign(new Error("iProX dataset reads require GET without a body"), { status: 405 });
  }
  const match = /^\/iprox\/datasets\/(PXD[0-9]{6})$/.exec(request.path);
  if (!match || Object.keys(request.params ?? {}).length) {
    throw Object.assign(new Error("Use /iprox/datasets/{PXD accession} without query parameters; other iProX routes are not qualified"), { status: 400 });
  }
  const sourceUrl = `https://www.iprox.cn/proxi/datasets/${match[1]}`;
  let observed: Awaited<ReturnType<typeof requestProteomics>>;
  try { observed = await requestProteomics(sourceUrl, { Accept: "application/json", "User-Agent": "bio-mcp-proteomics" }); }
  catch (error) {
    if (error instanceof Error) {
      const detail = error as Error & { data?: unknown };
      detail.data = { native_error: detail.data, source_url: sourceUrl, requested_accession: match[1] };
    }
    throw error;
  }
  const { result, response } = observed;
  if (result.data === null || typeof result.data !== "object") {
    throw Object.assign(new Error("iProX did not return a JSON dataset response"), { status: 502, data: { native: result.data, source_url: sourceUrl } });
  }
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(result.data)));
  return { status: result.status, data: {
    requested_accession: match[1], native: result.data,
    _iprox: {
      source_url: sourceUrl, retrieved_at: new Date().toISOString(),
      etag: response.headers.get("etag"), last_modified: response.headers.get("last-modified"),
      response_sha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join(""),
      hash_scope: "JSON.stringify of the complete parsed upstream response",
      dataset_identity_verified: false, release_pinned: false,
      interpretation: "Native iProX dataset metadata, not federated results or protein/peptide identification evidence. The requested accession is request context; inspect the native identifiers, status and provider errors. Response schema and live coverage remain unqualified. Linked data files are not fetched.",
    },
  } };
};
