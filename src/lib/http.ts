/**
 * HTTP clients for the two proteomics archives this server fronts:
 *   PRIDE Archive    → https://www.ebi.ac.uk/pride/ws/archive/v3
 *   ProteomeXchange  → https://proteomecentral.proteomexchange.org/api/proxi/v0.1
 *
 * PRIDE v2 is retired: EBI serves the v3 application at the /v2 path too, so the
 * old base did not fail loudly — it just answered v3 semantics under a v2 name
 * (v2's keyword-filtered /projects is v3's /search/projects). Pinned to /v3 so
 * the base and the catalog describe the same API.
 */

import { restFetch, type RestFetchOptions } from "@bio-mcp/shared/http/rest-fetch";

const PRIDE_BASE = "https://www.ebi.ac.uk/pride/ws/archive/v3";
const PROXI_BASE = "https://proteomecentral.proteomexchange.org/api/proxi/v0.1";

export interface ProteomicsFetchOptions extends Omit<RestFetchOptions, "retryOn"> {
    baseUrl?: string;
}

export async function prideFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: ProteomicsFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? PRIDE_BASE;
    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "proteomics-mcp-server/1.0 (bio-mcp; pride)",
    });
}

export async function proxiFetch(
    path: string,
    params?: Record<string, unknown>,
    opts?: ProteomicsFetchOptions,
): Promise<Response> {
    const baseUrl = opts?.baseUrl ?? PROXI_BASE;
    const headers: Record<string, string> = {
        Accept: "application/json",
        ...(opts?.headers ?? {}),
    };

    return restFetch(baseUrl, path, params, {
        ...opts,
        headers,
        retryOn: [429, 500, 502, 503],
        retries: opts?.retries ?? 3,
        timeout: opts?.timeout ?? 30_000,
        userAgent: "proteomics-mcp-server/1.0 (bio-mcp; proxi)",
    });
}
