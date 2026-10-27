import { describe, expect, it } from "vitest";
import { describeStatusErrors, isMarketingOptOutError } from "./delivery-errors";
import { normalizeTemplateStatus, templateStatusChange, templateStatusReason } from "./template-status";
import { parseHeaderMedia } from "./template-header";

describe("describeStatusErrors", () => {
  it("explains the failures the team can act on", () => {
    expect(describeStatusErrors([{ code: 131047, title: "Re-engagement message" }])).toMatch(/24 hours/);
    expect(describeStatusErrors([{ code: 131026 }])).toMatch(/not be on WhatsApp/);
    expect(describeStatusErrors([{ code: 132012 }])).toMatch(/photo header/);
  });

  it("falls back to Meta's own details for codes it doesn't know", () => {
    expect(
      describeStatusErrors([{ code: 999999, title: "Something", error_data: { details: "Odd failure" } }]),
    ).toBe("Not delivered: Odd failure (#999999)");
    expect(describeStatusErrors(undefined)).toBe("Not delivered.");
  });

  it("spots WhatsApp's own marketing opt-out", () => {
    expect(isMarketingOptOutError([{ code: 131050 }])).toBe(true);
    expect(isMarketingOptOutError([{ code: 131047 }])).toBe(false);
    expect(isMarketingOptOutError(null)).toBe(false);
  });
});

describe("template status", () => {
  it("maps Meta's events onto the stored status", () => {
    expect(normalizeTemplateStatus("APPROVED")).toBe("Approved");
    expect(normalizeTemplateStatus("PAUSED")).toBe("Rejected");
    expect(normalizeTemplateStatus("IN_APPEAL")).toBe("Pending");
    expect(normalizeTemplateStatus("whatever")).toBe("Draft");
  });

  it("keeps a readable reason only when the template can't be used", () => {
    expect(templateStatusReason("REJECTED", "INCORRECT_CATEGORY")).toBe("Rejected: Incorrect category");
    expect(templateStatusReason("REJECTED", "NONE")).toBe("Rejected by Meta");
    expect(templateStatusReason("PAUSED")).toMatch(/Paused/);
    expect(templateStatusReason("APPROVED", "NONE")).toBeNull();
  });

  it("keeps reinstated and flagged templates sendable and handles lifecycle events", () => {
    expect(templateStatusChange("REINSTATED")).toEqual({ status: "Approved", reason: null });
    expect(templateStatusChange("FLAGGED")?.status).toBe("Approved");
    expect(templateStatusChange("FLAGGED")?.reason).toMatch(/low quality/);
    expect(templateStatusChange("DELETED")).toMatchObject({ status: "Draft", forgetMetaId: true });
    expect(templateStatusChange("UNARCHIVED")?.status).toBeUndefined();
    expect(templateStatusChange("LIMIT_EXCEEDED")).toBeNull();
    expect(templateStatusChange("REJECTED", "INVALID_FORMAT")).toEqual({ status: "Rejected", reason: "Rejected: Invalid format" });
  });
});

describe("parseHeaderMedia", () => {
  it("accepts an uploaded media ID with its header type", () => {
    expect(parseHeaderMedia({ type: "image", id: "1234567890" })).toEqual({ type: "image", id: "1234567890" });
    expect(parseHeaderMedia({ type: "document", id: "55", filename: " Catalogue.pdf " })).toEqual({
      type: "document",
      id: "55",
      filename: "Catalogue.pdf",
    });
  });

  it("rejects anything that isn't a plain media ID", () => {
    expect(parseHeaderMedia(null)).toBeNull();
    expect(parseHeaderMedia({ type: "sticker", id: "1" })).toBeNull();
    expect(parseHeaderMedia({ type: "image", id: "../../me" })).toBeNull();
    expect(parseHeaderMedia({ type: "image", id: 12 })).toBeNull();
  });
});
