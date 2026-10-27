import { afterEach, describe, expect, it, vi } from "vitest";
import { markMessageRead, sendMediaMessage, sendTemplateMessage } from "./meta-api";

function mockMeta() {
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: JSON.parse(String(init?.body ?? "{}")) });
      return new Response(JSON.stringify({ success: true, messages: [{ id: "wamid.1" }] }), { status: 200 });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const base = { phoneNumberId: "PHONE1", accessToken: "token", to: "919800000000" };

describe("markMessageRead", () => {
  it("sends a read receipt, with a typing indicator when asked", async () => {
    const calls = mockMeta();
    await markMessageRead({ phoneNumberId: "PHONE1", accessToken: "token", messageId: "wamid.in" });
    await markMessageRead({ phoneNumberId: "PHONE1", accessToken: "token", messageId: "wamid.in", typing: true });
    expect(calls[0].url).toMatch(/\/PHONE1\/messages$/);
    expect(calls[0].body).toEqual({ messaging_product: "whatsapp", status: "read", message_id: "wamid.in" });
    expect(calls[1].body.typing_indicator).toEqual({ type: "text" });
  });
});

describe("sendTemplateMessage", () => {
  it("puts an uploaded photo in the template header", async () => {
    const calls = mockMeta();
    await sendTemplateMessage({
      ...base,
      templateName: "new_arrivals",
      language: "en",
      componentParams: { body: ["Honey"], headerMedia: { type: "image", id: "MEDIA9" } },
    });
    const template = calls[0].body.template as Record<string, unknown>;
    expect(template.language).toEqual({ code: "en" });
    expect(template.components).toEqual([
      { type: "header", parameters: [{ type: "image", image: { id: "MEDIA9" } }] },
      { type: "body", parameters: [{ type: "text", text: "Honey" }] },
    ]);
  });

  it("names a PDF header document", async () => {
    const calls = mockMeta();
    await sendTemplateMessage({
      ...base,
      templateName: "catalogue",
      componentParams: { headerMedia: { type: "document", id: "DOC1", filename: "Catalogue.pdf" } },
    });
    const template = calls[0].body.template as { components: unknown[] };
    expect(template.components).toEqual([
      { type: "header", parameters: [{ type: "document", document: { id: "DOC1", filename: "Catalogue.pdf" } }] },
    ]);
  });
});

describe("sendMediaMessage", () => {
  it("sends video with a caption and audio without one", async () => {
    const calls = mockMeta();
    await sendMediaMessage({ ...base, kind: "video", mediaId: "V1", caption: "Showroom tour" });
    await sendMediaMessage({ ...base, kind: "audio", mediaId: "A1", caption: "dropped" });
    expect(calls[0].body.video).toEqual({ id: "V1", caption: "Showroom tour" });
    expect(calls[1].body.type).toBe("audio");
    expect(calls[1].body.audio).toEqual({ id: "A1" });
  });
});
