// The canonical site origin must survive every value `vercel pull` can hand the build: on a CI runner it writes the
// literal "[SENSITIVE]" for sensitive env vars, which made `new URL()` throw while Next collected page data
// (CI/CD run 35403618340, 2026-09-18). Anything that is not a parseable http(s) URL resolves to the canonical domain.
import { describe, it, expect } from "vitest";
import { resolveSite, SITE } from "@/lib/site";

const D = "https://rebuttal.edycu.dev";
describe("resolveSite", () => {
  it.each(["[SENSITIVE]", "", undefined, "   ", "not a url", "ftp://x.y", "javascript:alert(1)"])("falls back for %j", (v) => {
    expect(resolveSite(v as string | undefined, D)).toBe(D);
  });
  it("keeps a real http(s) origin and drops any path", () => {
    expect(resolveSite("https://rebuttal-edycutjong.vercel.app/judge?x=1", D)).toBe("https://rebuttal-edycutjong.vercel.app");
    expect(resolveSite("http://localhost:3400", D)).toBe("http://localhost:3400");
  });
  it("SITE is always a URL new URL() accepts", () => {
    expect(() => new URL(SITE)).not.toThrow();
  });
});
