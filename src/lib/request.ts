import { readProteomics } from "./read";

/** Separate header/body budgets also bound uncooperative fetch and cancellation. */
export async function requestProteomics(url: string, headers: Record<string, string>, textAllowed = false) {
  const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const pending = fetch(url, { headers, redirect: "manual", signal: controller.signal });
    // Cleanup is best effort after the request has already timed out.
    void pending.then(late => { if (controller.signal.aborted) void late.body?.cancel().catch(() => {}); }, () => {});
    const response = await Promise.race([pending, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(Object.assign(new Error("Proteomics headers exceeded 25 seconds"), { status: 504 })); }, 25000);
    })]);
    if (timer !== undefined) clearTimeout(timer);
    return { response, result: await readProteomics(response, textAllowed) };
  } finally { if (timer !== undefined) clearTimeout(timer); controller.abort(); }
}
