import { describe, expect, it } from "vitest";
import {
  describeInboundExtras,
  inboundReplyText,
  isChangedNumberNotice,
  isOptInKeyword,
  isOptOutKeyword,
} from "./inbound-message";

describe("describeInboundExtras", () => {
  it("shows what the customer tapped on a template or interactive message", () => {
    expect(describeInboundExtras({ type: "button", button: { payload: "INTERESTED", text: "Interested" } })).toBe("Interested");
    expect(describeInboundExtras({ type: "button", button: { payload: "YES" } })).toBe("YES");
    expect(
      describeInboundExtras({ type: "interactive", interactive: { type: "button_reply", button_reply: { id: "X", title: "Visit shop" } } }),
    ).toBe("Visit shop");
    expect(
      describeInboundExtras({
        type: "interactive",
        interactive: { type: "list_reply", list_reply: { id: "2", title: "Floor tiles", description: "600x600" } },
      }),
    ).toBe("Floor tiles (600x600)");
  });

  it("lists shared contact cards with their numbers", () => {
    expect(
      describeInboundExtras({
        type: "contacts",
        contacts: [
          { name: { formatted_name: "Ramesh Contractor" }, phones: [{ phone: "+91 98290 12345" }] },
          { name: { first_name: "Sita" }, phones: [{ wa_id: "919811111111" }] },
        ],
      }),
    ).toBe("👤 Shared contact\nRamesh Contractor: +91 98290 12345\nSita: +919811111111");
  });

  it("summarises orders, number changes and unsupported messages", () => {
    expect(
      describeInboundExtras({ type: "order", order: { text: "Need by Friday", product_items: [{ quantity: 2 }, { quantity: "3" }] } }),
    ).toBe("🛒 Order: 5 items\nNeed by Friday");
    expect(
      describeInboundExtras({ type: "system", system: { type: "customer_changed_number", wa_id: "919800000000", body: "x" } }),
    ).toBe("ℹ️ Customer changed their number to +919800000000");
    expect(
      describeInboundExtras({ type: "system", system: { type: "user_changed_number", wa_id: "919811122233", body: "x" } }),
    ).toBe("ℹ️ Customer changed their number to +919811122233");
    expect(isChangedNumberNotice("user_changed_user_id")).toBe(false);
    expect(describeInboundExtras({ type: "unsupported", errors: [{ code: 131051, title: "Message type unknown" }] })).toBe(
      "[Message type WhatsApp can't show here: Message type unknown]",
    );
    expect(describeInboundExtras({ type: "request_welcome" })).toBe("👋 Opened the chat");
  });

  it("leaves media and text types to the media parser", () => {
    expect(describeInboundExtras({ type: "text" })).toBeNull();
    expect(describeInboundExtras({ type: "image" })).toBeNull();
  });
});

describe("inboundReplyText", () => {
  it("is set only for taps that should act like typed text", () => {
    expect(inboundReplyText({ type: "button", button: { text: "Stop promotions", payload: "STOP" } })).toBe("Stop promotions");
    expect(inboundReplyText({ type: "interactive", interactive: { list_reply: { id: "1", title: "Wall tiles" } } })).toBe("Wall tiles");
    expect(inboundReplyText({ type: "contacts" })).toBeNull();
    expect(inboundReplyText({ type: "text" })).toBeNull();
  });
});

describe("opt-out keywords", () => {
  it("matches only whole STOP / START style replies", () => {
    for (const text of ["STOP", "stop", " Stop! ", "Unsubscribe", "STOP PROMOTIONS", "opt-out"]) {
      expect(isOptOutKeyword(text)).toBe(true);
    }
    for (const text of ["please stop calling after 6", "cancel my visit", "stopped by the shop", "", null]) {
      expect(isOptOutKeyword(text)).toBe(false);
    }
    expect(isOptInKeyword("START")).toBe(true);
    expect(isOptInKeyword("subscribe.")).toBe(true);
    expect(isOptInKeyword("start the work tomorrow")).toBe(false);
  });
});
