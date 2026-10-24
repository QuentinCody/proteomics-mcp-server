import type { McpServer } from "@bio-mcp/shared/mcp";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { proteomicsCatalog } from "../spec/catalog";
import { createProteomicsApiFetch } from "../lib/api-adapter";
import { proteomicsResponse } from "../lib/tool-result";

interface CodeModeEnv {
    PROTEOMICS_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createProteomicsApiFetch();
    const registrar = { tool: (...args: unknown[]) => {
        const [name, ...rest] = args;
        const handler = rest.pop() as (input: unknown, extra: unknown) => ReturnType<typeof proteomicsResponse>;
        const respond = (input: unknown, extra: unknown) => proteomicsResponse(() => handler(input, extra), env, String(name), extra, input);
        // SAFETY: shared factories supply SDK arguments; only the alias and response boundary change.
        const register = server.tool.bind(server) as (...values: unknown[]) => void;
        register(name, ...rest, respond); register(`mcp_${String(name)}`, ...rest, respond);
    } };

    const searchTool = createSearchTool({
        prefix: "proteomics",
        catalog: proteomicsCatalog,
    });
    searchTool.register(registrar);

    const executeTool = createExecuteTool({
        prefix: "proteomics",
        // Verifiable provenance: proteomics_execute results carry a _meta.citation.
        source: { id: "proteomics", name: "PRIDE Archive, ProteomeCentral and ProteomicsDB", url: "https://www.proteomexchange.org" },
        catalog: proteomicsCatalog,
        apiFetch,
        preserveApiErrors: true,
        doNamespace: env.PROTEOMICS_DATA_DO,
        loader: env.CODE_MODE_LOADER,
        maxInlineBytes: 30 * 1024,
        stagingThreshold: 30 * 1024,
        timeout: 60000,
    });
    executeTool.register(registrar);
}
