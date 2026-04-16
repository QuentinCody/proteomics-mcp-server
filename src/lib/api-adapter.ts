/**
 * Proteomics API adapter — routes to PRIDE Archive (`/pride/...`) or
 * ProteomeXchange PROXI (`/proxi/...`) based on the first virtual path
 * segment. Pattern lifted from `ontology-hub-mcp-server/src/lib/api-adapter.ts`.
 */

import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { prideFetch, proxiFetch } from "./http";

const PRIDE_PREFIX = "/pride";
const PROXI_PREFIX = "/proxi";

function stripPrefix(path: string, prefix: string): string {
    const stripped = path.slice(prefix.length);
    if (stripped.length === 0) return "/";
    if (!stripped.startsWith("/")) return `/${stripped}`;
    return stripped;
}

export function createProteomicsApiFetch(): ApiFetchFn {
    return async (request) => {
        let targetPath: string;
        let fetchFn: typeof prideFetch;

        if (request.path === PRIDE_PREFIX || request.path.startsWith(`${PRIDE_PREFIX}/`)) {
            targetPath = stripPrefix(request.path, PRIDE_PREFIX);
            fetchFn = prideFetch;
        } else if (request.path === PROXI_PREFIX || request.path.startsWith(`${PROXI_PREFIX}/`)) {
            targetPath = stripPrefix(request.path, PROXI_PREFIX);
            fetchFn = proxiFetch;
        } else {
            const err = new Error(
                `Unknown proteomics path '${request.path}'. Paths must start with '/pride/' (PRIDE Archive) or '/proxi/' (ProteomeXchange PROXI).`,
            ) as Error & { status: number };
            err.status = 400;
            throw err;
        }

        const response = await fetchFn(targetPath, request.params);

        if (!response.ok) {
            let errorBody: string;
            try {
                errorBody = await response.text();
            } catch {
                errorBody = response.statusText;
            }
            const error = new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`) as Error & {
                status: number;
                data: unknown;
            };
            error.status = response.status;
            error.data = errorBody;
            throw error;
        }

        const contentType = response.headers.get("content-type") || "";
        if (!contentType.includes("json")) {
            const text = await response.text();
            return { status: response.status, data: text };
        }

        const data = await response.json();
        return { status: response.status, data };
    };
}
