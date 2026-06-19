import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createSearchTool } from "@bio-mcp/shared/codemode/search-tool";
import { createExecuteTool } from "@bio-mcp/shared/codemode/execute-tool";
import { proteomicsCatalog } from "../spec/catalog";
import { createProteomicsApiFetch } from "../lib/api-adapter";

interface CodeModeEnv {
    PROTEOMICS_DATA_DO: DurableObjectNamespace;
    CODE_MODE_LOADER: WorkerLoader;
}

export function registerCodeMode(
    server: McpServer,
    env: CodeModeEnv,
): void {
    const apiFetch = createProteomicsApiFetch();

    const searchTool = createSearchTool({
        prefix: "proteomics",
        catalog: proteomicsCatalog,
    });
    searchTool.register(server as unknown as { tool: (...args: unknown[]) => void });

    const executeTool = createExecuteTool({
        prefix: "proteomics",
        // Verifiable provenance: proteomics_execute results carry a _meta.citation.
        source: { id: "proteomics", name: "PRIDE (ProteomeXchange)", url: "https://www.ebi.ac.uk/pride", license: "CC BY 4.0" },
        catalog: proteomicsCatalog,
        apiFetch,
        doNamespace: env.PROTEOMICS_DATA_DO,
        loader: env.CODE_MODE_LOADER,
    });
    executeTool.register(server as unknown as { tool: (...args: unknown[]) => void });
}
