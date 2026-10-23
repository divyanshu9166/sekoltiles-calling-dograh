import { describe, expect, it } from "vitest";
import {
  buildLeadDeal,
  parseDealDate,
  statusForStageMove,
  toDateInputValue,
} from "./pipeline-rules";

describe("buildLeadDeal", () => {
  it("titles the deal with the contact's name and keeps the first message", () => {
    expect(buildLeadDeal({ name: "Ravi Kumar", phone: "919812345678" }, "Price of 2x2 tiles?")).toEqual({
      title: "Ravi Kumar",
      notes: "WhatsApp inquiry: Price of 2x2 tiles?",
    });
  });

  it("falls back to the phone number when the name is missing or just the phone", () => {
    expect(buildLeadDeal({ name: null, phone: "919812345678" }).title).toBe("+919812345678");
    expect(buildLeadDeal({ name: "919812345678", phone: "919812345678" }).title).toBe("+919812345678");
    expect(buildLeadDeal({ name: "  ", phone: "919812345678" }, "  ").notes).toBe("WhatsApp inquiry");
  });

  it("truncates very long first messages", () => {
    const { notes } = buildLeadDeal({ phone: "91" }, "x".repeat(800));
    expect(notes.length).toBeLessThan(530);
    expect(notes.endsWith("…")).toBe(true);
  });
});

describe("statusForStageMove", () => {
  it("marks a deal won when it lands in the Won stage", () => {
    expect(statusForStageMove("open", { name: "Won" })).toBe("won");
    expect(statusForStageMove("lost", { name: " won " })).toBe("won");
  });

  it("reopens a won deal dragged out of Won and leaves others alone", () => {
    expect(statusForStageMove("won", { name: "Negotiation" })).toBe("open");
    expect(statusForStageMove("won", { name: "Won" })).toBeNull();
    expect(statusForStageMove("open", { name: "Qualified" })).toBeNull();
    expect(statusForStageMove("lost", { name: "Qualified" })).toBeNull();
  });
});

describe("parseDealDate", () => {
  it("turns the date input's YYYY-MM-DD into UTC midnight", () => {
    expect(parseDealDate("2026-10-30")?.toISOString()).toBe("2026-10-30T00:00:00.000Z");
    expect(parseDealDate("2026-10-30T00:00:00.000Z")?.toISOString()).toBe("2026-10-30T00:00:00.000Z");
  });

  it("clears on empty and rejects garbage", () => {
    expect(parseDealDate("")).toBeNull();
    expect(parseDealDate(null)).toBeNull();
    expect(parseDealDate("not a date")).toBeUndefined();
    expect(parseDealDate(42)).toBeUndefined();
  });

  it("round-trips through the date input format", () => {
    expect(toDateInputValue(parseDealDate("2026-01-05")?.toISOString())).toBe("2026-01-05");
    expect(toDateInputValue(null)).toBe("");
    expect(toDateInputValue("nope")).toBe("");
  });
});
