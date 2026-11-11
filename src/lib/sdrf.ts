import type { ApiFetchFn } from "@bio-mcp/shared/codemode/catalog";
import { requestProteomics } from "./request";
import { parseSdrf } from "./sdrf-table";

const REPOSITORY = "bigbio/sdrf-annotated-datasets";
const API_BASE = `https://api.github.com/repos/${REPOSITORY}`;
const COMMIT = /^[a-f0-9]{40}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\.sdrf\.tsv$/;
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }

async function read(url: string) {
  const { result } = await requestProteomics(url,
    { Accept: url.startsWith(API_BASE) ? "application/vnd.github+json" : "text/plain", "User-Agent": "bio-mcp-proteomics", "X-GitHub-Api-Version": "2022-11-28" }, !url.startsWith(API_BASE));
  return result.data;
}

function source(url: string, commit: string) {
  return { repository: REPOSITORY, commit, source_url: url, retrieved_at: new Date().toISOString(),
    annotation_source: "Community SDRF annotations; may include AI-assisted curation",
    submitter_verified: null, deposited_file_identity_verified: false };
}

async function revision() {
  const url = `${API_BASE}/git/ref/heads/main`;
  const native = await read(url);
  if (!object(native) || native.ref !== "refs/heads/main" || !object(native.object) || native.object.type !== "commit" || typeof native.object.sha !== "string" || !COMMIT.test(native.object.sha)) fail("Unexpected SDRF repository reference", 502);
  return { native, commit: native.object.sha, _sdrf: source(url, native.object.sha) };
}

async function files(accession: string, commit: string) {
  const directory = `datasets/${accession}`;
  const url = `${API_BASE}/contents/${directory}?ref=${commit}`;
  const native = await read(url);
  if (!Array.isArray(native)) fail("Expected an SDRF repository directory listing", 502);
  const selected = [];
  for (const entry of native) {
    if (!object(entry) || typeof entry.name !== "string" || typeof entry.path !== "string") fail("Malformed SDRF directory entry", 502);
    if (entry.type !== "file" || !FILE.test(entry.name)) continue;
    if (entry.path !== `${directory}/${entry.name}`) fail("SDRF entry lies outside the requested project", 502);
    selected.push({ filename: entry.name, git_blob_sha: entry.sha, bytes: entry.size,
      source_url: `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/${directory}/${entry.name}` });
  }
  return { accession, native, files: selected, directory_listing_complete: native.length < 1000,
    scope: "Immediate curated project directory only; split designs may use multiple files", _sdrf: source(url, commit) };
}

async function file(accession: string, commit: string, filename: string, dataFile?: string) {
  const url = `https://raw.githubusercontent.com/${REPOSITORY}/${commit}/datasets/${accession}/${filename}`;
  const text = await read(url);
  if (typeof text !== "string") fail("Expected SDRF tab-delimited text", 502);
  const table = parseSdrf(text, dataFile);
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return { accession, filename, native_tsv: text, ...table, _sdrf: { ...source(url, commit),
    decoded_utf8_sha256: Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("") } };
}

/** Fixed repository only; every project read requires an immutable commit selector. */
export const sdrfFetch: ApiFetchFn = async request => {
  if (request.method !== "GET" || request.body !== undefined) fail("SDRF routes require bodyless GET", 405);
  const params = request.params ?? {};
  if (request.path === "/sdrf/revision") {
    if (Object.keys(params).length) fail("SDRF revision discovery accepts no parameters");
    return { status: 200, data: await revision() };
  }
  const match = /^\/sdrf\/projects\/((?:PXD|MSV|JPST|IPX|PASS)\d+)\/(files|file)$/.exec(request.path);
  if (!match) fail("Unknown SDRF path or unsupported project accession");
  const allowed = match[2] === "files" ? ["commit"] : ["commit", "filename", "data_file"];
  if (Object.keys(params).some(key => !allowed.includes(key))) fail("Unsupported SDRF query parameter");
  if (typeof params.commit !== "string" || !COMMIT.test(params.commit)) fail("SDRF reads require a full lowercase 40-character commit SHA; discover /sdrf/revision first");
  if (match[2] === "files") return { status: 200, data: await files(match[1], params.commit) };
  if (typeof params.filename !== "string" || !FILE.test(params.filename)) fail("Select an explicit .sdrf.tsv filename from the project directory listing");
  if (params.data_file !== undefined && (typeof params.data_file !== "string" || !params.data_file.length || params.data_file.length > 1024)) fail("data_file must be a nonempty exact filename, at most 1024 characters");
  return { status: 200, data: await file(match[1], params.commit, params.filename, params.data_file as string | undefined) };
};
