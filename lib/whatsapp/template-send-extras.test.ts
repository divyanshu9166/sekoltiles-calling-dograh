import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasSendNeeds,
  parseSendExtras,
  parseStoredSendParams,
  sendExtrasComponentParams,
  sendExtrasProblem,
  templateSendNeeds,
} from "./template-send-extras";
import { fillVariables, formatWhatsAppText, nextVariableNumber } from "./whatsapp-format";
import { sendTemplateMessage } from "./meta-api";

const offer = {
  header_type: "text",
  header_content: "Offer for {{1}}",
  buttons: [
    { type: "QUICK_REPLY", text: "Interested" },
    { type: "URL", text: "See designs", url: "https://sekol.example/d/{{1}}" },
    { type: "COPY_CODE", text: "Copy offer code", example: ["DIWALI20"] },
  ],
};

describe("templateSendNeeds", () => {
  it("finds header, link and offer-code values a send must fill in", () => {
    expect(templateSendNeeds(offer)).toEqual({
      headerText: true,
      location: false,
      urlButtons: [{ index: 1, text: "See designs", url: "https://sekol.example/d/{{1}}" }],
      copyCodeIndex: 2,
    });
    expect(templateSendNeeds({ header_type: "location" }).location).toBe(true);
    expect(hasSendNeeds(templateSendNeeds({ header_type: "image", buttons: [{ type: "URL", text: "x", url: "https://a.b" }] }))).toBe(
      false,
    );
  });
});

describe("parseSendExtras", () => {
  it("accepts complete values and builds Meta's header and button parameters", () => {
    const parsed = parseSendExtras(offer, {
      headerText: " Diwali ",
      urlSuffixes: { 1: "wood-look" },
      couponCode: "DIWALI20",
      location: { latitude: "1" },
    });
    expect(parsed).toEqual({
      ok: true,
      extras: { headerText: "Diwali", urlSuffixes: { 1: "wood-look" }, couponCode: "DIWALI20" },
    });
    if (!parsed.ok) return;
    expect(sendExtrasComponentParams(offer, parsed.extras)).toEqual({
      header: ["Diwali"],
      buttons: [
        { index: 1, sub_type: "url", value: "wood-look" },
        { index: 2, sub_type: "copy_code", value: "DIWALI20" },
      ],
    });
  });

  it("refuses missing or invalid values with a readable reason", () => {
    expect(parseSendExtras(offer, {})).toEqual({ ok: false, error: "Fill in the header value for {{1}}." });
    expect(parseSendExtras(offer, { headerText: "x", urlSuffixes: { 1: "y" }, couponCode: "X".repeat(21) })).toMatchObject({
      ok: false,
      error: expect.stringMatching(/at most 20/),
    });
    const location = { header_type: "location" };
    expect(parseSendExtras(location, { location: { latitude: "95", longitude: "70" } }).ok).toBe(false);
    expect(parseSendExtras(location, { location: { latitude: "22.8173", longitude: "70.8378", name: "Showroom" } })).toEqual({
      ok: true,
      extras: { location: { latitude: 22.8173, longitude: 70.8378, name: "Showroom" } },
    });
    expect(sendExtrasProblem(templateSendNeeds(location), { location: { latitude: "", longitude: "" } })).toMatch(/latitude/);
  });

  it("reads back what a broadcast stored and drops anything malformed", () => {
    expect(
      parseStoredSendParams({
        header: ["Diwali"],
        headerLocation: { latitude: 22.8, longitude: 70.8, name: "Showroom" },
        buttons: [
          { index: 1, sub_type: "url", value: "wood" },
          { index: 99, sub_type: "url", value: "x" },
          { index: 2, sub_type: "flow", value: "x" },
        ],
      }),
    ).toEqual({
      header: ["Diwali"],
      headerLocation: { latitude: 22.8, longitude: 70.8, name: "Showroom" },
      buttons: [{ index: 1, sub_type: "url", value: "wood" }],
    });
    expect(parseStoredSendParams(null)).toEqual({});
  });
});

describe("sendTemplateMessage with location header and offer code", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("sends Meta's location header and coupon_code button parameters", async () => {
    const calls: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
      }),
    );
    await sendTemplateMessage({
      phoneNumberId: "P",
      accessToken: "t",
      to: "919800000000",
      templateName: "visit_us",
      componentParams: {
        body: ["Honey"],
        headerLocation: { latitude: 22.8173, longitude: 70.8378, name: "Showroom" },
        buttons: [{ index: 0, sub_type: "copy_code", value: "DIWALI20" }],
      },
    });
    expect((calls[0].template as { components: unknown[] }).components).toEqual([
      { type: "header", parameters: [{ type: "location", location: { latitude: "22.8173", longitude: "70.8378", name: "Showroom" } }] },
      { type: "body", parameters: [{ type: "text", text: "Honey" }] },
      { type: "button", sub_type: "copy_code", index: "0", parameters: [{ type: "coupon_code", coupon_code: "DIWALI20" }] },
    ]);
  });
});

describe("WhatsApp formatting helpers", () => {
  it("splits *bold*, _italic_, ~strike~ and ```code``` like WhatsApp", () => {
    expect(formatWhatsAppText("Get *20% off* on _floor_ tiles")).toEqual([
      { text: "Get " },
      { text: "20% off", bold: true },
      { text: " on " },
      { text: "floor", italic: true },
      { text: " tiles" },
    ]);
    expect(formatWhatsAppText("~old~ ```CODE1```")).toEqual([
      { text: "old", strike: true },
      { text: " " },
      { text: "CODE1", mono: true },
    ]);
    expect(formatWhatsAppText("2*3*4 and a * b")).toEqual([{ text: "2*3*4 and a * b" }]);
  });

  it("numbers the next variable and fills samples for the preview", () => {
    expect(nextVariableNumber("Hi {{1}}, {{ 2 }} off")).toBe(3);
    expect(nextVariableNumber("No variables")).toBe(1);
    expect(fillVariables("Hi {{1}}, {{2}} off", ["Honey"])).toBe("Hi Honey, {{2}} off");
  });
});
