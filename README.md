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

## ProteomicsDB extension — October 23, 2026

The existing tools now expose three documented public OData reads. Search with
`ProteomicsDB expression`, then use the virtual paths above. This extends the
existing multi-API server; no new tool prefix or credentials are required.

```javascript
return await api.get('/proteomicsdb/protein-expression', {
  PROTEINFILTER: 'P00533', // EGFR
  MS_LEVEL: 1, TISSUE_CATEGORY_SELECTION: 'tissue;fluid',
  SCOPE_SELECTION: 1, GROUP_BY_TISSUE: 1, CALCULATION_METHOD: 0, EXP_ID: -1,
  '$top': 20,
  '$select': 'UNIQUE_IDENTIFIER,TISSUE_ID,TISSUE_NAME,NORMALIZED_INTENSITY'
});
```

The adapter constructs fixed upstream service URLs from typed selectors rather
than accepting raw OData expressions. `$top` is 1–100 (default 20), `$skip` is
0–10000, and `$select` allows at most 32 native field names. `$format=json` is
fixed. Unknown parameters, arbitrary URLs, mutation methods and bodies fail before
network access. Each call makes one request with no retries or automatic paging;
the existing 25-second header, 10-second body and 4 MiB body limits apply.

The complete parsed OData response stays under `native`, including `d.results`,
`__metadata`, numeric-looking strings, nulls, counts and continuation URLs. The
adapter never follows `__next`. `_proteomicsdb` records the precise source URL,
retrieval time, parsed-response SHA-256, response headers and page bounds.
Malformed OData and upstream row-limit violations fail with their native payload
retained. Pages do not establish complete coverage, and offsets on the live view
are not release-pinned. Existing staging retains the original envelope and
projects returned rows to `proteomicsdb_rows` for SQL access.

Read-only upstream probes on October 23 returned HTTP 200 with `$top=1`:

- Peptide query for `Q92769`: `HDAC2_HUMAN`, `Q92769` (316-byte JSON).
- Expression query for `P00533`: adrenal gland (`BTO:0000047`) with native
  `NORMALIZED_INTENSITY` string `4.483880889224657` (378-byte JSON).
- Tissue catalog: HEK-293 cell (`BTO:0000007`), category `cell line` (337-byte JSON).

These qualify the three provider services, not the deployed MCP Worker. Automated
tests cover typed bounds, injection rejection, native OData and paging preservation,
failure envelopes, source hashes, staging, SQL, citations and both tool aliases.
Run the server's focused tests and live contract harness before deployment.

Expression is biological context; it is neither exposure nor toxicity. The peptide
service reports aggregated experimental identification evidence, not a complete
PSM or modification inventory. Affinity experiment scope does **not** turn an
abundance estimate into a binding constant. Although ProteomicsDB contains
Kinobeads data, a supported dose-response API route was not verified, so none is
exposed. Benchmark labels must remain outside prediction inputs.

Provider references: [public API documentation](https://www.proteomicsdb.org/api),
[ProteomicsDB biochemical-assay description](https://doi.org/10.1093/nar/gkx1029),
and [2026 database update](https://doi.org/10.1093/nar/gkaf1265).
Drift risk is medium: recheck the three examples and OData `$metadata` schemas
monthly and before relying on new fields. Access without registration does not
establish unrestricted redistribution rights for every underlying study.
