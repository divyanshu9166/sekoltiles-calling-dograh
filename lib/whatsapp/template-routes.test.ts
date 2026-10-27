import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Route-level checks for template sync and submit, with the database,
// session and Meta all faked. Lives here because vitest only runs lib/**.

const prisma = vi.hoisted(() => ({
  waWhatsappConfig: { findUnique: vi.fn() },
  waMessageTemplate: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("@/lib/db", () => ({ prisma }));
vi.mock("@/lib/session", () => ({ getSession: async () => ({ id: "1" }) }));
vi.mock("@/lib/whatsapp/encryption", () => ({ decrypt: () => "token" }));

const { POST: syncTemplates } = await import("@/app/api/whatsapp/templates/sync/route");
const { POST: submitTemplate } = await import("@/app/api/whatsapp/templates/[id]/submit/route");

function mockMeta(body: unknown) {
  const calls: Array<{ url: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}

beforeEach(() => {
  vi.resetAllMocks();
  prisma.waWhatsappConfig.findUnique.mockResolvedValue({ user_id: "1", waba_id: "WABA1", access_token: "enc" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /api/whatsapp/templates/sync", () => {
  it("turns submitted rows Meta no longer has back into drafts that can be submitted again", async () => {
    mockMeta({ data: [] });
    prisma.waMessageTemplate.findMany.mockResolvedValue([{ id: "t1", name: "festive_offer", language: "en_US" }]);
    prisma.waMessageTemplate.updateMany.mockResolvedValue({ count: 1 });

    const res = await syncTemplates();
    expect(res.status).toBe(200);
    expect((await res.json()).markedStale).toBe(1);

    // Pending/Rejected rows carrying a Meta ID are checked, not only Approved ones.
    expect(prisma.waMessageTemplate.findMany.mock.calls[0][0].where).toEqual({
      user_id: "1",
      OR: [{ status: "Approved" }, { meta_template_id: { not: null } }],
    });
    expect(prisma.waMessageTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["t1"] } },
      data: { status: "Draft", meta_template_id: null },
    });
  });

  it("keeps rows Meta still returns", async () => {
    mockMeta({
      data: [{ id: "77", name: "festive_offer", language: "en_US", status: "PENDING", category: "MARKETING" }],
    });
    prisma.waMessageTemplate.findFirst.mockResolvedValue({ id: "t1" });
    prisma.waMessageTemplate.findMany.mockResolvedValue([{ id: "t1", name: "festive_offer", language: "en_US" }]);

    const res = await syncTemplates();
    expect((await res.json()).markedStale).toBe(0);
    expect(prisma.waMessageTemplate.updateMany).not.toHaveBeenCalled();
    expect(prisma.waMessageTemplate.update.mock.calls[0][0].data).toMatchObject({ meta_template_id: "77" });
  });
});

describe("POST /api/whatsapp/templates/[id]/submit", () => {
  const draft = {
    id: "t9",
    user_id: "1",
    name: "order_ready",
    category: "Utility",
    language: "en_US",
    header_type: null,
    header_content: null,
    body_text: "Hi {{ 1 }}, your order is ready for pickup.",
    footer_text: null,
    buttons: null,
    status: "Draft",
    meta_template_id: null,
  };

  function submit(body: unknown) {
    return submitTemplate(
      new Request("http://test/api/whatsapp/templates/t9/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "t9" }) },
    );
  }

  it("saves the category Meta files the template under and the normalised text", async () => {
    const calls = mockMeta({ id: "555", status: "PENDING", category: "MARKETING" });
    prisma.waMessageTemplate.findFirst.mockResolvedValue(draft);
    prisma.waMessageTemplate.update.mockImplementation(async ({ data }) => ({ ...draft, ...data }));

    const res = await submit({ body_examples: ["Ravi"] });
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ status: "Pending", category: "Marketing", meta_template_id: "555" });

    expect(calls[0].body).toMatchObject({
      category: "UTILITY",
      components: [{ type: "BODY", text: "Hi {{1}}, your order is ready for pickup." }],
    });
    expect(prisma.waMessageTemplate.update.mock.calls[0][0].data).toMatchObject({
      category: "Marketing",
      body_text: "Hi {{1}}, your order is ready for pickup.",
      meta_template_id: "555",
      status: "Pending",
    });
  });

  it("explains a text header that has no text", async () => {
    const calls = mockMeta({});
    prisma.waMessageTemplate.findFirst.mockResolvedValue({ ...draft, header_type: "text", header_content: null });

    const res = await submit({ body_examples: ["Ravi"] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/no header text\. Delete it and create it again/);
    expect(calls).toHaveLength(0);
  });
});
