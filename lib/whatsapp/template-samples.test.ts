import { describe, expect, it } from "vitest";
import {
  checkTemplateSubmission,
  EMPTY_SAMPLES,
  hasSampleNeeds,
  sampleNeeds,
  templateSubmitFormData,
  type TemplateDraft,
} from "./template-samples";

const base: TemplateDraft = {
  name: "diwali_catalogue",
  category: "Marketing",
  language: "en",
  header_type: null,
  header_content: null,
  body_text: "Diwali offers on {{1}} tiles. Visit us this week!",
  footer_text: null,
  buttons: [],
};

const pdf = new File(["%PDF-1.4"], "catalogue.pdf", { type: "application/pdf" });

describe("sampleNeeds", () => {
  it("asks for a file, header/body examples and URL suffixes only where needed", () => {
    expect(hasSampleNeeds(sampleNeeds({ ...base, body_text: "No variables here." }))).toBe(false);
    expect(
      sampleNeeds({
        ...base,
        header_type: "document",
        buttons: [
          { type: "QUICK_REPLY", text: "Interested" },
          { type: "URL", text: "Catalogue", url: "https://sekol.in/c/{{1}}" },
          { type: "URL", text: "Site", url: "https://sekol.in" },
        ],
      }),
    ).toEqual({ mediaHeader: "document", headerVars: 0, bodyVars: 1, urlButtonIndexes: [1] });
    expect(sampleNeeds({ ...base, header_type: "text", header_content: "Hi {{1}}" }).headerVars).toBe(1);
  });
});

describe("checkTemplateSubmission", () => {
  it("needs a sample file of the right type for a media header", () => {
    const doc = { ...base, header_type: "document" };
    expect(() => checkTemplateSubmission(doc, { ...EMPTY_SAMPLES, bodyExamples: ["vitrified"] })).toThrow(/sample file/);
    expect(() =>
      checkTemplateSubmission(doc, {
        ...EMPTY_SAMPLES,
        bodyExamples: ["vitrified"],
        file: new File(["x"], "photo.png", { type: "image/png" }),
      }),
    ).toThrow(/needs a PDF/);
    expect(() => checkTemplateSubmission(doc, { ...EMPTY_SAMPLES, bodyExamples: ["vitrified"], file: pdf })).not.toThrow();
  });

  it("needs an example for every variable and refuses authentication templates", () => {
    expect(() => checkTemplateSubmission(base, EMPTY_SAMPLES)).toThrow();
    expect(() => checkTemplateSubmission(base, { ...EMPTY_SAMPLES, bodyExamples: ["floor"] })).not.toThrow();
    expect(() => checkTemplateSubmission({ ...base, category: "Authentication" }, EMPTY_SAMPLES)).toThrow(/WhatsApp Manager/);
  });
});

describe("templateSubmitFormData", () => {
  it("sends the examples, and the file only for media headers", () => {
    const samples = { ...EMPTY_SAMPLES, bodyExamples: ["floor"], file: pdf };
    const withFile = templateSubmitFormData({ ...base, header_type: "document" }, samples);
    expect(JSON.parse(String(withFile.get("body_examples")))).toEqual(["floor"]);
    expect((withFile.get("file") as File).name).toBe("catalogue.pdf");
    expect(templateSubmitFormData(base, samples).get("file")).toBeNull();
  });
});
