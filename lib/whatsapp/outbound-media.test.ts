import { describe, expect, it } from "vitest";
import {
  checkOutboundMedia,
  checkTemplateHeaderMedia,
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

  it("accepts MP4 video and common audio up to 16 MB", () => {
    expect(checkOutboundMedia({ name: "showroom.mp4", type: "", size: 10 * MB })).toMatchObject({
      ok: true,
      kind: "video",
      mimeType: "video/mp4",
    });
    expect(checkOutboundMedia({ name: "note.ogg", size: 1000 })).toMatchObject({ ok: true, kind: "audio", mimeType: "audio/ogg" });
    expect(checkOutboundMedia({ name: "song.MP3", size: 1000 })).toMatchObject({ ok: true, kind: "audio", mimeType: "audio/mpeg" });
    expect(checkOutboundMedia({ name: "long.mp4", size: 16 * MB + 1 })).toEqual({
      ok: false,
      error: "Videos can be at most 16 MB.",
    });
    expect(checkOutboundMedia({ name: "clip.mov", size: 1000 }).ok).toBe(false);
  });

  it("lists every accepted extension for the file picker", () => {
    for (const part of ["image/jpeg", "image/png", ".mp4", ".mp3", ".ogg", ".pdf", ".docx", ".xlsx", ".pptx", ".txt"]) {
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

  it("stores no text for audio and the caption for video", () => {
    expect(mediaMessageText("audio", "note.ogg", "ignored")).toBeNull();
    expect(mediaMessageText("video", "a.mp4", "")).toBeNull();
    expect(mediaMessageText("video", "a.mp4", "Walkthrough")).toBe("Walkthrough");
  });

  it("gives the inbox list a readable preview", () => {
    expect(mediaPreviewText("video", "a.mp4")).toBe("🎬 Video");
    expect(mediaPreviewText("audio", "a.mp3")).toBe("🎵 Audio");
    expect(mediaPreviewText("image", "a.jpg")).toBe("📷 Photo");
    expect(mediaPreviewText("document", "Quote.pdf")).toBe("📄 Quote.pdf");
    expect(formatFileSize(1536)).toBe("2 KB");
    expect(formatFileSize(3.5 * MB)).toBe("3.5 MB");
  });
});

describe("checkTemplateHeaderMedia", () => {
  it("only takes the file type the template header was approved with", () => {
    expect(checkTemplateHeaderMedia("image", { name: "offer.png", size: 1000 })).toMatchObject({ ok: true, kind: "image" });
    expect(checkTemplateHeaderMedia("video", { name: "tour.mp4", size: 1000 })).toMatchObject({ ok: true, kind: "video" });
    expect(checkTemplateHeaderMedia("document", { name: "catalogue.pdf", size: 1000 })).toMatchObject({ ok: true });
    expect(checkTemplateHeaderMedia("image", { name: "catalogue.pdf", size: 1000 })).toEqual({
      ok: false,
      error: "This template's header needs a JPG or PNG photo.",
    });
    expect(checkTemplateHeaderMedia("video", { name: "tour.3gp", size: 1000 }).ok).toBe(false);
    expect(checkTemplateHeaderMedia("document", { name: "rates.xlsx", size: 1000 })).toEqual({
      ok: false,
      error: "This template's header needs a PDF.",
    });
  });
});
