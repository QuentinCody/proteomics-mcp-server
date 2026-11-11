const MAX_SPECTRA = 100;
const MAX_REQUEST_BYTES = 4 * 1024 * 1024;

function invalid(message: string): never {
  throw Object.assign(new Error(message), { status: 400 });
}

function validateSpectrum(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("Each spectrum must be an object");
  // SAFETY: the guard above excludes primitives, null, and arrays.
  const spectrum = value as Record<string, unknown>;
  const { mzs, intensities } = spectrum;
  if (!Array.isArray(mzs) || !Array.isArray(intensities) || !mzs.length || mzs.length !== intensities.length) {
    invalid("Each spectrum requires nonempty mzs and intensities arrays of equal length");
  }
  if (![...mzs, ...intensities].every(item => typeof item === "number" && Number.isFinite(item))) invalid("Peak arrays must contain finite numbers");
  if (mzs.some((mz, index) => index > 0 && mz < mzs[index - 1])) invalid("mzs must be monotonically increasing; reorder paired intensities upstream");
}

/** Validate documented minimum fields without projecting away provider extensions. */
export function annotationBody(body: unknown, params?: Record<string, unknown>): string {
  if (!Array.isArray(body) || !body.length || body.length > MAX_SPECTRA) invalid("Send an array of 1–100 spectra (local request limit)");
  for (const spectrum of body) validateSpectrum(spectrum);
  if (params?.resultType !== undefined && params.resultType !== "full") invalid("Annotation uses resultType=full");
  if (params?.tolerance !== undefined && (typeof params.tolerance !== "number" || !Number.isFinite(params.tolerance) || params.tolerance <= 0)) invalid("tolerance must be a positive finite number in ppm");
  const text = JSON.stringify(body);
  if (new TextEncoder().encode(text).byteLength > MAX_REQUEST_BYTES) throw Object.assign(new Error("Annotation request exceeds the local 4 MiB limit"), { status: 413 });
  return text;
}
