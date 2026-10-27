import { describe, expect, it } from "vitest";
import {
  checkOutboundMedia,
  formatFileSize,
  MEDIA_ACCEPT,
  mediaMessageText,
  mediaPreviewText,
} from "./outbound-media";

const MB = 1024 * 1024;

describe("checkOutboundMedia", () => {
  it("accepts JPG/PNG photos up to 5 MB", () => {
    expect(checkOutboundMedia({ name: "tiles.JPG", type: "image/jpeg", size: 2 * MB })).toEqual({
      ok: true,
      kind: "image",
      mimeType: "image/jpeg",
      filename: "tiles.JPG",
    });
    expect(checkOutboundMedia({ name: "a.png", size: 5 * MB }).ok).toBe(true);
    expect(checkOutboundMedia({ name: "big.png", size: 5 * MB + 1 })).toEqual({
      ok: false,
      error: "Photos can be at most 5 MB.",
    });
  });

  it("treats PDFs and Office files as documents by extension, even with a blank type", () => {
    const pdf = checkOutboundMedia({ name: "Quotation.pdf", type: "", size: 10 * MB });
    expect(pdf).toMatchObject({ ok: true, kind: "document", mimeType: "application/pdf" });
    const xlsx = checkOutboundMedia({ name: "rates.xlsx", type: "application/octet-stream", size: 1000 });
    expect(xlsx).toMatchObject({ ok: true, kind: "document" });
    expect(checkOutboundMedia({ name: "huge.pdf", size: 26 * MB })).toEqual({
      ok: false,
      error: "Documents can be at most 25 MB.",
    });
  });

  it("rejects formats WhatsApp can't send and empty files", () => {
    expect(checkOutboundMedia({ name: "photo.heic", size: 1000 }).ok).toBe(false);
    expect(checkOutboundMedia({ name: "setup.exe", size: 1000 }).ok).toBe(false);
    expect(checkOutboundMedia({ name: "noext", size: 1000 }).ok).toBe(false);
    expect(checkOutboundMedia({ name: "empty.pdf", size: 0 })).toEqual({ ok: false, error: "This file is empty." });
  });

  it("lists every accepted extension for the file picker", () => {
    for (const part of ["image/jpeg", "image/png", ".pdf", ".docx", ".xlsx", ".pptx", ".txt"]) {
      expect(MEDIA_ACCEPT.split(",")).toContain(part);
    }
  });
});

describe("stored text", () => {
  it("stores the caption, or the filename for documents, like inbound media", () => {
    expect(mediaMessageText("image", "a.jpg", "  ")).toBeNull();
    expect(mediaMessageText("image", "a.jpg", "New design")).toBe("New design");
    expect(mediaMessageText("document", "Quote.pdf", "")).toBe("Quote.pdf");
    expect(mediaMessageText("document", "Quote.pdf", "Your quote")).toBe("Your quote");
  });

  it("gives the inbox list a readable preview", () => {
    expect(mediaPreviewText("image", "a.jpg")).toBe("📷 Photo");
    expect(mediaPreviewText("document", "Quote.pdf")).toBe("📄 Quote.pdf");
    expect(formatFileSize(1536)).toBe("2 KB");
    expect(formatFileSize(3.5 * MB)).toBe("3.5 MB");
  });
});
