"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { checkTemplateHeaderMedia } from "@/lib/whatsapp/outbound-media";

export type HeaderMediaType = "image" | "video" | "document";

export interface HeaderMediaUpload {
  type: HeaderMediaType;
  /** Meta media ID, sent as `header_media.id`. */
  id: string;
  filename: string;
  /** Local thumbnail for photo headers. */
  previewUrl?: string;
}

/**
 * Uploads the photo/video/PDF for a template's media header to Meta once,
 * so the inbox and broadcasts can send it by ID.
 */
export function useTemplateHeaderUpload() {
  const [media, setMedia] = useState<HeaderMediaUpload | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);

  // Release the photo thumbnail when it is replaced or the picker unmounts.
  useEffect(() => {
    const url = media?.previewUrl;
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [media?.previewUrl]);

  const reset = useCallback(() => {
    generation.current += 1;
    setMedia(null);
    setUploading(false);
    setError("");
  }, []);

  const upload = useCallback(async (type: HeaderMediaType, file: File) => {
    const check = checkTemplateHeaderMedia(type, file);
    if (!check.ok) {
      setError(check.error);
      return null;
    }
    const current = ++generation.current;
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.append("header_type", type);
      form.append("file", file, file.name);
      const res = await fetch("/api/whatsapp/media/upload", { method: "POST", body: form });
      const body = await res.json().catch(() => ({}));
      if (current !== generation.current) return null;
      if (!res.ok || !body?.id) {
        setError(body?.error || `Upload failed (HTTP ${res.status})`);
        return null;
      }
      const next: HeaderMediaUpload = {
        type,
        id: String(body.id),
        filename: check.filename,
        previewUrl: type === "image" ? URL.createObjectURL(file) : undefined,
      };
      setMedia(next);
      return next;
    } catch {
      if (current === generation.current) setError("Upload failed. Check your connection and retry.");
      return null;
    } finally {
      if (current === generation.current) setUploading(false);
    }
  }, []);

  return { media, uploading, error, upload, reset };
}
