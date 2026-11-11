import type { ApiCatalog } from "@bio-mcp/shared/codemode/catalog";

const commit = { name: "commit", type: "string" as const, required: true, description: "Full lowercase 40-character Git commit SHA from /sdrf/revision; reuse it for every read" };
const accession = { name: "accession", type: "string" as const, required: true, description: "Exact public project accession, e.g. PXD000070" };

export const sdrfEndpoints: ApiCatalog["endpoints"] = [
  { method: "GET", path: "/sdrf/revision", category: "sdrf", summary: "Discover the current immutable revision of the community SDRF annotation repository", usageHint: "Native Git reference retained. A repository revision is not a PRIDE release or submitter verification." },
  { method: "GET", path: "/sdrf/projects/{accession}/files", category: "sdrf", summary: "Discover all SDRF files in a commit-pinned project directory, including split designs", pathParams: [accession], queryParams: [commit], usageHint: "Native directory entries retained; at GitHub's 1,000-entry cap completeness is false. Select filenames explicitly; sandbox drafts are excluded." },
  { method: "GET", path: "/sdrf/projects/{accession}/file", category: "sdrf", summary: "Read commit-pinned community SDRF sample-to-file relationships with raw TSV, ordered columns and a content hash", pathParams: [accession], queryParams: [commit,
    { name: "filename", type: "string", required: true, description: "Exact .sdrf.tsv filename discovered in this project's directory" },
    { name: "data_file", type: "string", required: false, description: "Optional exact case-sensitive comment[data file] filter; retains all matching sample/channel rows and the full native TSV" },
  ], usageHint: "columns and cells_json preserve repeated headers and strings. One run can have many sample/channel rows. Parsing is not full SDRF validation, submitter verification or evidence that an archive file/USI identifies a unique sample. 4 MiB, 20,000-row and 512-column local limits; oversized responses stage through Code Mode." },
];
