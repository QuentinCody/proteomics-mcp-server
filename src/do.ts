import { RestStagingDO } from "@bio-mcp/shared/staging/rest-staging-do";
import type { SchemaHints } from "@bio-mcp/shared/staging/schema-inference";

export class ProteomicsDataDO extends RestStagingDO {
    protected getSchemaHints(data: unknown): SchemaHints | undefined {
        if (!data || typeof data !== "object") return undefined;

        // PRIDE wraps paged results under _embedded.compactprojects / projects / files
        const embedded = (data as { _embedded?: Record<string, unknown[]> })._embedded;
        if (embedded && typeof embedded === "object") {
            const [key, rows] = Object.entries(embedded)[0] ?? [];
            const keyName = typeof key === "string" ? key.toLowerCase() : "";
            if (rows && Array.isArray(rows) && rows.length > 0) {
                if (keyName.includes("project")) {
                    return { tableName: "pride_projects", indexes: ["accession", "submissionType"] };
                }
                if (keyName.includes("file")) {
                    return { tableName: "pride_files", indexes: ["accession", "fileCategory"] };
                }
                return { tableName: key || "pride_results" };
            }
        }

        if (Array.isArray(data) && data.length > 0) {
            const sample = data[0] as Record<string, unknown> | undefined;
            if (sample && typeof sample === "object") {
                if ("identifier" in sample && ("title" in sample || "species" in sample)) {
                    return { tableName: "proxi_datasets", indexes: ["identifier"] };
                }
                if ("usi" in sample) {
                    return { tableName: "proxi_spectra", indexes: ["usi"] };
                }
                if ("peptideSequence" in sample) {
                    return { tableName: "proxi_peptides", indexes: ["peptideSequence"] };
                }
            }
        }

        // Single PRIDE project detail
        const obj = data as Record<string, unknown>;
        if (typeof obj.accession === "string" && String(obj.accession).startsWith("PXD")) {
            return { tableName: "pride_project", indexes: ["accession"] };
        }

        return undefined;
    }
}
