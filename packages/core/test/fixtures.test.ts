import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slugify, writeFixture, readFixture, listFixtures, fixtureStore, FIXTURES_DIR, type Fixture } from "../src/fixtures";
import { claim } from "./helpers";

function fixture(over: Partial<Fixture> = {}): Fixture {
  return {
    slug: "sm-buying-pepe",
    edge: "the base case",
    input: "Smart Money is aping $PEPE",
    source: "manual",
    claim: claim(),
    options: {},
    now: 0,
    recordedAt: "2026-09-18T00:00:00.000Z",
    live: { calls: 6, credits: 10, ms: 400 },
    responses: { abc123: { storedAt: "2026-09-18T00:00:00.000Z", ttlMs: 3_600_000, endpoint: "tgm/holders", body: { a: 1 }, text: '{"data":[]}' } },
    verdict: { label: "CONFIRMED" } as unknown as Fixture["verdict"],
    ...over,
  };
}

describe("slugify", () => {
  it("lowercases, collapses non-alphanumerics to a single hyphen, trims edge hyphens, and bounds the length", () => {
    expect(slugify("Smart Money is aping $PEPE!!")).toBe("smart-money-is-aping-pepe");
    expect(slugify("--leading and trailing--")).toBe("leading-and-trailing");
    expect(slugify("x".repeat(60))).toHaveLength(40);
  });
});

describe("writeFixture / readFixture round-trip", () => {
  it("writes JSON to <dir>/<slug>.json and reads it back byte-identical in shape", () => {
    const dir = mkdtempSync(join(tmpdir(), "rebuttal-fixtures-"));
    const f = fixture();
    const path = writeFixture(f, dir);
    expect(path).toBe(join(dir, "sm-buying-pepe.json"));
    const back = readFixture(path);
    expect(back).toEqual(f);
  });
  it("creates the directory if it does not exist yet", () => {
    const dir = join(mkdtempSync(join(tmpdir(), "rebuttal-fixtures-")), "nested", "deeper");
    const path = writeFixture(fixture({ slug: "nested-case" }), dir);
    expect(readFixture(path).slug).toBe("nested-case");
  });
  it("defaults to the FIXTURES_DIR constant when no dir is given", () => {
    expect(FIXTURES_DIR).toBe("fixtures");
  });
});

describe("listFixtures", () => {
  it("lists only .json files, sorted, and returns [] when the directory does not exist", () => {
    const dir = mkdtempSync(join(tmpdir(), "rebuttal-fixtures-"));
    writeFixture(fixture({ slug: "b-case" }), dir);
    writeFixture(fixture({ slug: "a-case" }), dir);
    const listed = listFixtures(dir);
    expect(listed).toEqual([join(dir, "a-case.json"), join(dir, "b-case.json")]);
  });
  it("a missing directory yields an empty list rather than throwing", () => {
    expect(listFixtures(join(tmpdir(), "rebuttal-fixtures-does-not-exist-xyz"))).toEqual([]);
  });
});

describe("fixtureStore", () => {
  it("pre-loads a MemoryCache with the fixture's recorded responses, keyed the same way", () => {
    const f = fixture();
    const store = fixtureStore(f);
    expect(store.get("abc123")).toEqual(f.responses.abc123);
    expect(store.entries()).toEqual(f.responses);
  });
  it("an empty responses map yields an empty store", () => {
    const store = fixtureStore(fixture({ responses: {} }));
    expect(store.entries()).toEqual({});
  });
});
