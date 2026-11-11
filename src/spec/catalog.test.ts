import { expect, it } from "vitest";
import { proteomicsCatalog } from "./catalog";

it("discovers annotation without advertising unimplemented ProteomeCentral searches", () => {
  expect(proteomicsCatalog.endpointCount).toBe(proteomicsCatalog.endpoints.length);
  expect(proteomicsCatalog.endpoints.find(route => route.path === "/proxi/annotate")).toMatchObject({ method: "POST", body: { contentType: "application/json" } });
  for (const path of ["/proxi/proteins", "/proxi/psms", "/proxi/peptidoforms"]) {
    expect(proteomicsCatalog.endpoints.find(route => route.path === path)).toMatchObject({ deprecated: true });
  }
  expect(proteomicsCatalog.endpoints.find(route => route.path === "/pride/files/sdrf/{projectAccession}")).toMatchObject({ responseShape: "string[]" });
});
