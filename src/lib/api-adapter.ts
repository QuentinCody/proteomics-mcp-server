/**
 * Proteomics API adapter — routes to PRIDE Archive (`/pride/...`) or
 * ProteomeCentral PROXI (`/proxi/...`), iProX dataset metadata (`/iprox/...`),
 * or commit-pinned community SDRF (`/sdrf/...`)
 * based on the first virtual path segment.
 */

import { type ApiFetchFn, commercialUseRefusal } from "@bio-mcp/shared/codemode/catalog";
import { prideFetch, proxiFetch } from "./http";
import { readProteomics } from "./read";
import { annotationBody } from "./annotation";
import { sdrfFetch } from "./sdrf";
import { iproxFetch } from "./iprox";
import { proteomicsdbFetch } from "./proteomicsdb";
import { proteomicsCompleteness } from "./completeness";

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

/**
 * License audit 2026-11-10: PRIDE and PROXI are open. iProX has a conflicting
 * personal-use clause, and the ProteomicsDB terms are not confirmed. So the
 * commercial profile gets HTTP 451 for those two routes.
 */
function commercialRefusal(request: Parameters<ApiFetchFn>[0]) {
    if (request.licenseProfile !== "commercial" || !/^\/(iprox|proteomicsdb)(\/|$)/.test(request.path)) return undefined;
    return commercialUseRefusal("The iProX and ProteomicsDB routes", "their terms for commercial use are not confirmed; PRIDE and PROXI stay available");
}

export function createProteomicsApiFetch(): ApiFetchFn {
    const routed = createRoutedFetch();
    return async (request) => commercialRefusal(request) ?? routed(request);
}

function createRoutedFetch(): ApiFetchFn {
    const run: ApiFetchFn = async (request) => {
        if (request.path === "/proteomicsdb" || request.path.startsWith("/proteomicsdb/")) return proteomicsdbFetch(request);
        if (request.path === "/iprox" || request.path.startsWith("/iprox/")) return iproxFetch(request);
        if (request.path.startsWith("/sdrf/")) return sdrfFetch(request);
        if (request.path === "/proxi/annotate" && request.method === "POST") {
            const body = annotationBody(request.body, request.params);
            return readProteomics(await proxiFetch("/annotate", { resultType: "full", tolerance: 10, ...request.params }, {
                method: "POST", body, headers: { "Content-Type": "application/json" },
                timeout: 20000, deadlineMs: 25000, retries: 0,
            }));
        }
        if (request.method !== "GET" || request.path === "/proxi/annotate") {
            throw Object.assign(new Error("Use GET for archive reads; only /proxi/annotate accepts POST"), { status: 405 });
        }
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
                `Unknown proteomics path '${request.path}'. Use '/pride/' (PRIDE Archive), '/proxi/' (ProteomeCentral), '/iprox/datasets/{accession}' (iProX), '/sdrf/' (community annotations), or '/proteomicsdb/' (protein expression and peptide evidence).`,
            ) as Error & { status: number };
            err.status = 400;
            throw err;
        }

        return readProteomics(await fetchFn(targetPath, request.params, { timeout: 20000, deadlineMs: 25000 }));
    };
    return async request => {
        const result = await run(request);
        if (request.path.startsWith("/proxi/") && result.data && typeof result.data === "object" && "status" in result.data) {
            const status = result.data.status;
            if (status && typeof status === "object" && "status_code" in status && typeof status.status_code === "number" && status.status_code >= 400)
                throw Object.assign(new Error("PROXI reported an application error; inspect the complete native status"), { status: 502, data: { http_status: result.status, native: result.data } });
        }
        const completeness = proteomicsCompleteness(result.data);
        return completeness ? { ...result, completeness, upstreamTotal: completeness.total_available ?? null } : result;
    };
}
