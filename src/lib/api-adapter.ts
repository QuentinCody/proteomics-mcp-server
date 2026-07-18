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

/**
 * PRIDE (Spring) silently DISCARDS query params a route does not declare — it
 * answers 200 with the default unfiltered page instead of rejecting the request.
 * A `keyword` on /projects therefore comes back as a plausible-looking project
 * list that answers a different question than the one asked, which is worse than
 * an error: the caller cannot tell a match from a default. Refuse the known
 * dropped params and name the route that actually honors them.
 *
 * Keep in sync with the v3 OpenAPI doc (see spec/catalog.ts header).
 */
const PRIDE_DROPPED_PARAM_GUARDS: ReadonlyArray<{
    match: RegExp;
    dropped: string[];
    hint: string;
}> = [
    {
        match: /^\/projects\/?$/,
        dropped: ["keyword", "filter", "sortFields", "sortDirection", "dateGap"],
        hint: "GET /pride/projects is an unfiltered dump and declares only pageSize/page. Use api.get('/pride/search/projects', { keyword, filter, pageSize, page, sortFields, sortDirection }) — the only PRIDE route that honors a query.",
    },
    {
        match: /^\/projects\/[^/]+\/files\/?$/,
        dropped: ["filter"],
        hint: "Project file listing filters on 'filenameFilter'. Use api.get('/pride/projects/{accession}/files', { filenameFilter: 'raw' }).",
    },
];

function assertNoDroppedPrideParams(
    path: string,
    params?: Record<string, unknown>,
): void {
    if (!params) return;
    for (const guard of PRIDE_DROPPED_PARAM_GUARDS) {
        if (!guard.match.test(path)) continue;
        const offenders = guard.dropped.filter(
            (name) => params[name] !== undefined && params[name] !== null && params[name] !== "",
        );
        if (offenders.length === 0) continue;
        const named = offenders.map((name) => `'${name}'`).join(", ");
        const err = new Error(
            `PRIDE ignores ${named} on ${path}: the request would have returned the DEFAULT UNFILTERED list as though it matched your query. Refusing rather than answering a different question. ${guard.hint}`,
        ) as Error & { status: number };
        err.status = 400;
        throw err;
    }
}

export function createProteomicsApiFetch(): ApiFetchFn {
    return async (request) => {
        let targetPath: string;
        let fetchFn: typeof prideFetch;

        if (request.path === PRIDE_PREFIX || request.path.startsWith(`${PRIDE_PREFIX}/`)) {
            targetPath = stripPrefix(request.path, PRIDE_PREFIX);
            assertNoDroppedPrideParams(targetPath, request.params);
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
