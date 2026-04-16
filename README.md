# proteomics-mcp-server

Dual-API MCP server that fronts two proteomics archives behind one Code Mode
tool pair, following the routing pattern from `ontology-hub-mcp-server`.

- Upstreams:
  - PRIDE Archive v2 — `https://www.ebi.ac.uk/pride/ws/archive/v2`
  - ProteomeXchange PROXI — `https://proteomecentral.proteomexchange.org/api/proxi/v0.1`
- Port: `8888`
- Tools: `proteomics_search`, `proteomics_execute`, `proteomics_query_data`, `proteomics_get_schema`

## Routing

Virtual paths are namespaced. The adapter (`src/lib/api-adapter.ts`) strips
the first path segment and routes the rest to the matching upstream:

| Virtual path                       | Upstream call                                                                 |
|------------------------------------|-------------------------------------------------------------------------------|
| `/pride/projects`                  | `GET https://www.ebi.ac.uk/pride/ws/archive/v2/projects`                      |
| `/pride/projects/PXD001357`        | `GET https://www.ebi.ac.uk/pride/ws/archive/v2/projects/PXD001357`            |
| `/proxi/datasets`                  | `GET https://proteomecentral.proteomexchange.org/api/proxi/v0.1/datasets`     |
| `/proxi/datasets/PXD000001`        | `GET https://proteomecentral.proteomexchange.org/api/proxi/v0.1/datasets/PXD000001` |

## Local dev

```bash
./scripts/dev-servers.sh proteomics
```
