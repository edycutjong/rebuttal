import { describe, it, expect, afterEach, vi } from "vitest";
import { isTweetUrl, fetchTweetText } from "../src/tweet";
import { rebut } from "../src/rebut";
import { fakeClient, pepeRoutes } from "./helpers";

const oembed = (html: string, author = "lookonchain") => new Response(JSON.stringify({ html, author_name: author }), { status: 200 });

describe("tweet URLs", () => {
  it("recognises x.com and twitter.com status URLs only", () => {
    expect(isTweetUrl("https://x.com/lookonchain/status/2099673587125014572")).toBe(true);
    expect(isTweetUrl("https://twitter.com/OnchainLens/status/2100824200957366630?s=20")).toBe(true);
    expect(isTweetUrl("https://mobile.x.com/a_b/status/12345/photo/1")).toBe(true);
    expect(isTweetUrl("https://x.com/lookonchain")).toBe(false);
    expect(isTweetUrl("https://example.com/status/123")).toBe(false);
    expect(isTweetUrl("Smart Money is aping $PEPE")).toBe(false);
  });
  it("extracts the text from the oEmbed html, decoding entities and <br>", async () => {
    const t = await fetchTweetText("https://x.com/lookonchain/status/2099673587125014572", {
      fetchImpl: async () => oembed('<blockquote class="twitter-tweet"><p lang="en" dir="ltr">Whales have been accumulating $EDEL.<br>ezhomi.base.eth bought 5.33M $EDEL (&#36;98K) &amp; more <a href="https://t.co/x">pic.twitter.com/x</a></p>&mdash; Lookonchain (@lookonchain) <a href="https://twitter.com/x">September 15, 2026</a></blockquote>'),
    });
    expect(t).toEqual({ text: "Whales have been accumulating $EDEL. ezhomi.base.eth bought 5.33M $EDEL ($98K) & more pic.twitter.com/x", author: "lookonchain" });
  });
  it("decodes entities in one pass — an escaped ampersand never re-decodes what follows it (CodeQL js/double-escaping)", async () => {
    const t = await fetchTweetText("https://x.com/a/status/12345", {
      fetchImpl: async () => oembed("<p>&amp;lt;b&amp;gt; is text, &lt;i&gt; was markup, &#x24;1 &#36;2 &apos;q&apos; &quot;q&quot; &unknown; &#1114112;</p>"),
    });
    expect(t?.text).toBe("&lt;b&gt; is text, <i> was markup, $1 $2 'q' \"q\" &unknown; &#1114112;");
  });
  it("returns null on a non-200, a missing html, a timeout, or a non-status URL", async () => {
    // a real status id: STATUS_RE requires 5-25 digits, so "status/1" below would fail to match at all and these
    // assertions would pass for the wrong reason (the pre-match gate, never reaching fetchImpl) — assert the mock
    // fetchImpl actually ran, so a regression here fails loudly instead of silently.
    let calls = 0;
    const counted = (fetchImpl: typeof fetch): typeof fetch => async (u, init) => {
      calls++;
      return fetchImpl(u, init);
    };
    expect(await fetchTweetText("https://x.com/a/status/12345", { fetchImpl: counted(async () => new Response("", { status: 404 })) })).toBeNull();
    expect(await fetchTweetText("https://x.com/a/status/12345", { fetchImpl: counted(async () => new Response("{}", { status: 200 })) })).toBeNull();
    const hang: typeof fetch = async (_u, init) => new Promise((_, rej) => init!.signal!.addEventListener("abort", () => rej(Object.assign(new Error("aborted"), { name: "AbortError" }))));
    expect(await fetchTweetText("https://x.com/a/status/12345", { fetchImpl: counted(hang), timeoutMs: 100 })).toBeNull();
    expect(calls).toBe(3);
    expect(await fetchTweetText("https://x.com/a", {})).toBeNull();
  });
  it("falls back to the raw html when the oEmbed markup carries no <p> tag", async () => {
    const t = await fetchTweetText("https://x.com/a/status/12345", { fetchImpl: async () => oembed("Whales are &amp; buying $PEPE") });
    expect(t?.text).toBe("Whales are & buying $PEPE");
  });
  it("html that decodes to nothing (tags and whitespace only) is a null result, not an empty string", async () => {
    const t = await fetchTweetText("https://x.com/a/status/12345", { fetchImpl: async () => oembed("<p>   <a href=\"x\"></a>  </p>") });
    expect(t).toBeNull();
  });
  it("a missing author_name falls back to the handle in the URL", async () => {
    const t = await fetchTweetText("https://x.com/someone/status/12345", {
      fetchImpl: async () => new Response(JSON.stringify({ html: "<p>hi</p>" }), { status: 200 }),
    });
    expect(t).toEqual({ text: "hi", author: "someone" });
  });
  it("with no fetchImpl given, it falls back to the global fetch", async () => {
    vi.stubGlobal("fetch", async () => oembed("<p>global fetch path</p>"));
    const t = await fetchTweetText("https://x.com/a/status/12345", {});
    expect(t?.text).toBe("global fetch path");
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  it("rebut() takes the URL, checks the tweet's text, and says who wrote it", async () => {
    const events: unknown[] = [];
    const v = await rebut(fakeClient(pepeRoutes()), "https://x.com/whoever/status/123456789", {
      llm: null,
      now: 0,
      fetchImpl: async () => oembed("<p>Smart Money is aping $PEPE hard today</p>", "whoever"),
      onProgress: (e) => e.type === "input" && events.push(e),
    });
    expect(events[0]).toMatchObject({ type: "input", fromUrl: true, author: "whoever", text: "Smart Money is aping $PEPE hard today" });
    expect(v.claim.token).toBe("PEPE");
    expect(v.label).toBe("CONTRADICTED");
  });
  it("an unreachable tweet becomes a warning and an UNVERIFIABLE claim, 0 credits", async () => {
    const v = await rebut(fakeClient(pepeRoutes()), "https://x.com/whoever/status/123456789", { llm: null, fetchImpl: async () => new Response("", { status: 403 }) });
    expect(v.warnings[0]).toMatch(/could not fetch that tweet/);
    expect(v.label).toBe("UNVERIFIABLE");
    expect(v.credits).toBe(0);
  });
});
