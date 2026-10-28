import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTemplateCreatePayload,
  fromMetaCategory,
  normalizeVariables,
  parseStoredButtons,
  templateVariables,
  toMetaCategory,
  toMetaTemplateName,
  type BuildTemplateCreatePayloadArgs,
} from "./template-submission";
import { createMessageTemplate, getTokenAppId, uploadTemplateSample } from "./meta-api";

const base: BuildTemplateCreatePayloadArgs = {
  name: "festive_offer",
  language: "en_US",
  category: "MARKETING",
  body: "Hi {{1}}, get {{2}} off on floor tiles this week.",
  bodyExamples: ["Ravi", "₹2,000"],
};

describe("buildTemplateCreatePayload", () => {
  it("builds a body-only template with examples for every variable", () => {
    expect(buildTemplateCreatePayload(base)).toEqual({
      name: "festive_offer",
      language: "en_US",
      category: "MARKETING",
      parameter_format: "positional",
      components: [
        {
          type: "BODY",
          text: "Hi {{1}}, get {{2}} off on floor tiles this week.",
          example: { body_text: [["Ravi", "₹2,000"]] },
        },
      ],
    });
  });

  it("leaves out the example when the body has no variables", () => {
    const payload = buildTemplateCreatePayload({ ...base, body: "New tiles are in.", bodyExamples: [] });
    expect(payload.components).toEqual([{ type: "BODY", text: "New tiles are in." }]);
  });

  it("orders header, body, footer and buttons the way Meta documents them", () => {
    const payload = buildTemplateCreatePayload({
      ...base,
      header: { format: "TEXT", text: "Offer for {{1}}", example: "Diwali" },
      footer: "Reply STOP to opt out",
      buttons: [
        { type: "QUICK_REPLY", text: "Interested" },
        { type: "URL", text: "See designs", url: "https://sekol.example/d/{{1}}", example: "wood-look" },
        { type: "PHONE_NUMBER", text: "Call us", phone_number: "+91 98765 43210" },
      ],
    });
    expect(payload.components).toEqual([
      { type: "HEADER", format: "TEXT", text: "Offer for {{1}}", example: { header_text: ["Diwali"] } },
      expect.objectContaining({ type: "BODY" }),
      { type: "FOOTER", text: "Reply STOP to opt out" },
      {
        type: "BUTTONS",
        buttons: [
          { type: "QUICK_REPLY", text: "Interested" },
          { type: "URL", text: "See designs", url: "https://sekol.example/d/{{1}}", example: ["wood-look"] },
          { type: "PHONE_NUMBER", text: "Call us", phone_number: "+919876543210" },
        ],
      },
    ]);
  });

  it("uses an upload handle for media headers", () => {
    const payload = buildTemplateCreatePayload({ ...base, header: { format: "IMAGE", handle: "4::aGFuZGxl" } });
    expect(payload.components[0]).toEqual({
      type: "HEADER",
      format: "IMAGE",
      example: { header_handle: ["4::aGFuZGxl"] },
    });
  });

  it("keeps a static link button without an example", () => {
    const payload = buildTemplateCreatePayload({
      ...base,
      buttons: [{ type: "URL", text: "Website", url: "https://sekol.example" }],
    });
    expect(payload.components.at(-1)).toEqual({
      type: "BUTTONS",
      buttons: [{ type: "URL", text: "Website", url: "https://sekol.example" }],
    });
  });

  it.each([
    [{ bodyExamples: ["Ravi"] }, "Add a sample value for {{2}} in the body."],
    [{ name: "Festive Offer" }, "festive_offer"],
    [{ body: "Hi {{1}}, {{3}} off today." }, "must appear in order"],
    [{ body: "Hi {{2}}, order {{1}} is ready." }, "found {{2}} where {{1}} should be"],
    [{ header: { format: "TEXT" as const, text: "Offer {{2}}", example: "a" } }, "Header variables must appear in order"],
    [{ header: { format: "TEXT" as const, text: "   " } }, "Delete it and create it again"],
    [{ body: "Hi {{name}}, welcome." }, "Use numbered variables"],
    [{ body: "{{1}}, your tiles are ready.", bodyExamples: ["Ravi"] }, "starts or ends with a variable"],
    [{ body: "Your tiles are ready, {{1}}", bodyExamples: ["Ravi"] }, "starts or ends with a variable"],
    [{ body: "x".repeat(1025), bodyExamples: [] }, "at most 1024 characters"],
    [{ footer: "Offer for {{1}}" }, "Footer text can't contain variables."],
    [{ language: "English" }, "is not a WhatsApp language code"],
    [{ header: { format: "TEXT" as const, text: "{{1}} and {{2}}", example: "a" } }, "only one variable"],
    [{ header: { format: "TEXT" as const, text: "Hi {{1}}" } }, "Add a sample value for {{1}} in the header."],
    [{ header: { format: "VIDEO" as const, handle: "" } }, "Upload a sample file"],
  ])("rejects %j with a readable message", (override, message) => {
    expect(() => buildTemplateCreatePayload({ ...base, ...override })).toThrow(message);
  });

  it("enforces Meta's button rules", () => {
    const url = (n: number) => ({ type: "URL" as const, text: `Link ${n}`, url: `https://sekol.example/${n}` });
    const qr = { type: "QUICK_REPLY" as const, text: "Yes" };
    const call = { type: "PHONE_NUMBER" as const, text: "Call", phone_number: "919876543210" };
    const build = (buttons: BuildTemplateCreatePayloadArgs["buttons"]) => () =>
      buildTemplateCreatePayload({ ...base, buttons });

    expect(build([url(1), url(2), url(3)])).toThrow("at most 2 link buttons");
    expect(build([call, call])).toThrow("only one call button");
    expect(build([qr, url(1), qr])).toThrow("Keep quick-reply buttons next to each other");
    expect(build(Array(11).fill(qr))).toThrow("at most 10 buttons");
    expect(build([{ ...qr, text: "x".repeat(26) }])).toThrow("at most 25 characters");
    expect(build([{ type: "URL", text: "Go", url: "sekol.example" }])).toThrow("starting with https://");
    expect(build([{ type: "URL", text: "Go", url: "https://s.example/{{1}}/x" }])).toThrow("at the very end");
    expect(build([{ type: "URL", text: "Go", url: "https://s.example/{{1}}" }])).toThrow("Add a sample value");
    expect(build([{ ...call, phone_number: "call me" }])).toThrow("country code");
    expect(build([url(1), qr, qr, call])).toThrow("Keep quick-reply buttons next to each other");
    expect(build([qr, qr, url(1), call])).not.toThrow();
    expect(build([url(1), call, qr, qr])).not.toThrow();
  });
});

describe("variable order and spacing", () => {
  it("allows a later repeat of an earlier variable", () => {
    const payload = buildTemplateCreatePayload({
      ...base,
      body: "Hi {{1}}, {{2}} off for you, {{1}}, this week.",
    });
    expect(payload.components[0]).toMatchObject({ example: { body_text: [["Ravi", "₹2,000"]] } });
  });

  it("sends {{ 1 }} as {{1}} in the header, body and link", () => {
    const payload = buildTemplateCreatePayload({
      ...base,
      header: { format: "TEXT", text: "Offer for {{ 1 }}", example: "Diwali" },
      body: "Hi {{ 1 }}, get {{2 }} off on floor tiles.",
      buttons: [{ type: "URL", text: "Designs", url: "https://sekol.example/d/{{ 1 }}", example: "wood" }],
    });
    expect(payload.components[0]).toMatchObject({ text: "Offer for {{1}}" });
    expect(payload.components[1]).toMatchObject({ text: "Hi {{1}}, get {{2}} off on floor tiles." });
    expect(payload.components[2]).toEqual({
      type: "BUTTONS",
      buttons: [{ type: "URL", text: "Designs", url: "https://sekol.example/d/{{1}}", example: ["wood"] }],
    });
  });

  it("only rewrites numbered variables", () => {
    expect(normalizeVariables("{{ 12 }} and {{name}} and {{  3}}")).toBe("{{12}} and {{name}} and {{3}}");
  });
});

describe("helpers", () => {
  it("maps Meta's category back to the CRM's", () => {
    expect(fromMetaCategory("MARKETING")).toBe("Marketing");
    expect(fromMetaCategory("utility")).toBe("Utility");
    expect(fromMetaCategory("AUTHENTICATION")).toBe("Authentication");
    expect(fromMetaCategory(undefined)).toBeNull();
  });

  it("lists positional variables once, in order of appearance", () => {
    expect(templateVariables("{{2}} and {{1}} and {{2}}")).toEqual([2, 1]);
  });

  it("turns a display name into a Meta template name", () => {
    expect(toMetaTemplateName(" Festive Offer - Diwali 2026! ")).toBe("festive_offer_diwali_2026");
    expect(toMetaTemplateName("showroom_visit_invite")).toBe("showroom_visit_invite");
  });

  it("maps categories and refuses authentication", () => {
    expect(toMetaCategory("Marketing")).toBe("MARKETING");
    expect(toMetaCategory("Utility")).toBe("UTILITY");
    expect(toMetaCategory("Authentication")).toBeNull();
  });

  it("reads stored buttons and drops unknown shapes", () => {
    expect(
      parseStoredButtons([
        { type: "url", text: "Go", url: "https://s.example" },
        { type: "CATALOG", text: "x" },
        "junk",
      ]),
    ).toEqual([{ type: "URL", text: "Go", url: "https://s.example" }]);
    expect(parseStoredButtons(null)).toEqual([]);
  });
});

describe("Meta template calls", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(responses: Array<{ status?: number; body: unknown }>) {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, init });
        const next = responses.shift() ?? { body: {} };
        return new Response(JSON.stringify(next.body), { status: next.status ?? 200 });
      }),
    );
    return calls;
  }

  it("posts the payload to the WABA's message_templates edge", async () => {
    const calls = mockFetch([{ body: { id: "123", status: "PENDING", category: "MARKETING" } }]);
    const payload = buildTemplateCreatePayload(base);
    const result = await createMessageTemplate({ wabaId: "WABA1", accessToken: "token", payload: { ...payload } });

    expect(result).toEqual({ id: "123", status: "PENDING", category: "MARKETING" });
    // v21.0 stops working on 2027-01-21; the default must be newer.
    expect(calls[0].url).toBe("https://graph.facebook.com/v24.0/WABA1/message_templates");
    expect(calls[0].init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual(payload);
  });

  it("surfaces Meta's user-facing error text", async () => {
    mockFetch([
      {
        status: 400,
        body: {
          error: {
            message: "Invalid parameter",
            error_user_title: "Content in this language already exists",
            error_user_msg: "festive_offer already has English (US) content.",
          },
        },
      },
    ]);
    await expect(
      createMessageTemplate({ wabaId: "WABA1", accessToken: "token", payload: {} }),
    ).rejects.toThrow("Content in this language already exists: festive_offer already has English (US) content.");
  });

  it("reads the app ID from debug_token", async () => {
    const calls = mockFetch([{ body: { data: { app_id: "APP9", is_valid: true } } }]);
    await expect(getTokenAppId({ accessToken: "token" })).resolves.toBe("APP9");
    expect(calls[0].url).toMatch(/\/debug_token\?input_token=token$/);
  });

  it("uploads a header sample with the Resumable Upload API", async () => {
    const calls = mockFetch([{ body: { id: "upload:SESSION1" } }, { body: { h: "4::HANDLE" } }]);
    const file = new Blob([new Uint8Array([1, 2, 3, 4])], { type: "image/png" });
    const result = await uploadTemplateSample({
      appId: "APP9",
      accessToken: "token",
      file,
      filename: "tiles.png",
      mimeType: "image/png",
    });

    expect(result).toEqual({ handle: "4::HANDLE" });
    expect(calls[0].url).toMatch(/\/APP9\/uploads\?file_name=tiles.png&file_length=4&file_type=image%2Fpng$/);
    expect(calls[1].url).toMatch(/\/upload:SESSION1$/);
    const headers = calls[1].init?.headers as Record<string, string>;
    expect(headers.Authorization).toBe("OAuth token");
    expect(headers.file_offset).toBe("0");
    expect((calls[1].init?.body as ArrayBuffer).byteLength).toBe(4);
  });
});

describe("WhatsApp Manager button types and location header", () => {
  const buttonsOf = (args: Partial<BuildTemplateCreatePayloadArgs>) =>
    buildTemplateCreatePayload({ ...base, ...args }).components.find((c) => c.type === "BUTTONS")?.buttons;

  it("builds Call on WhatsApp, Complete flow, Copy offer code and Share contact info buttons", () => {
    expect(
      buttonsOf({
        buttons: [
          { type: "COPY_CODE", text: "", example: " DIWALI20 " },
          { type: "VOICE_CALL", text: "Call Now" },
          { type: "FLOW", text: "Book a visit", flow_id: "1234567890123", navigate_screen: "BOOKING" },
          { type: "REQUEST_CONTACT_INFO", text: "Share contact info" },
          { type: "QUICK_REPLY", text: "Interested" },
        ],
      }),
    ).toEqual([
      { type: "COPY_CODE", example: "DIWALI20" },
      { type: "VOICE_CALL", text: "Call Now" },
      { type: "FLOW", text: "Book a visit", flow_id: "1234567890123", flow_action: "navigate", navigate_screen: "BOOKING" },
      { type: "REQUEST_CONTACT_INFO", text: "Share contact info" },
      { type: "QUICK_REPLY", text: "Interested" },
    ]);
    expect(buttonsOf({ buttons: [{ type: "FLOW", text: "Open", flow_id: "98765" }] })).toEqual([
      { type: "FLOW", text: "Open", flow_id: "98765", flow_action: "navigate" },
    ]);
  });

  it("checks each new button against Meta's limits", () => {
    expect(() => buttonsOf({ buttons: [{ type: "COPY_CODE", text: "" }] })).toThrow(/sample offer code/);
    expect(() => buttonsOf({ buttons: [{ type: "COPY_CODE", text: "", example: "X".repeat(21) }] })).toThrow(/at most 20/);
    expect(() =>
      buttonsOf({ buttons: [{ type: "COPY_CODE", text: "", example: "A" }, { type: "COPY_CODE", text: "", example: "B" }] }),
    ).toThrow(/only one "Copy offer code"/);
    expect(() => buttonsOf({ buttons: [{ type: "VOICE_CALL", text: "Call our showroom today" }] })).toThrow(/at most 20/);
    expect(() => buttonsOf({ buttons: [{ type: "FLOW", text: "Open", flow_id: "abc" }] })).toThrow(/Flow ID/);
    expect(() => buttonsOf({ buttons: [{ type: "FLOW", text: "Open", flow_id: "12345", navigate_screen: "bad screen" }] })).toThrow(
      /screen name/,
    );
    expect(() =>
      buttonsOf({ buttons: [{ type: "QUICK_REPLY", text: "A" }, { type: "VOICE_CALL", text: "Call" }, { type: "QUICK_REPLY", text: "B" }] }),
    ).toThrow(/next to each other/);
  });

  it("reserves a location header with no example", () => {
    expect(buildTemplateCreatePayload({ ...base, header: { format: "LOCATION" } }).components[0]).toEqual({
      type: "HEADER",
      format: "LOCATION",
    });
  });

  it("reads new button types back from a synced template", () => {
    expect(
      parseStoredButtons([
        { type: "COPY_CODE", text: "Copy offer code", example: ["DIWALI20"] },
        { type: "VOICE_CALL", text: "Call Now" },
        { type: "FLOW", text: "Book", flow_id: 12345, flow_action: "navigate", navigate_screen: "START" },
        { type: "CATALOG", text: "View" },
      ]),
    ).toEqual([
      { type: "COPY_CODE", text: "Copy offer code", example: "DIWALI20" },
      { type: "VOICE_CALL", text: "Call Now" },
      { type: "FLOW", text: "Book", flow_id: "12345", navigate_screen: "START" },
    ]);
  });
});
