import { describe, expect, it } from "vitest";
import { buildExtractionSystemPrompt } from "./shared";

describe("buildExtractionSystemPrompt", () => {
  const prompt = buildExtractionSystemPrompt("WPS report", [
    { key: "wps_transfer_date", expectedType: "ISO date", description: "The date funds were transferred." },
  ]);

  it("embeds the forbidden-field instruction (this prompt's 'Do not' rule)", () => {
    expect(prompt).toMatch(/never include a field named "status", "rating", "compliant", or "score"/i);
  });

  it("embeds the never-calculate/never-infer instructions (CONTEXT.md rule 2/3)", () => {
    expect(prompt).toMatch(/never calculate, sum, average/i);
    expect(prompt).toMatch(/never infer, judge, or state a compliance conclusion/i);
  });

  it("embeds the null/reason contract", () => {
    expect(prompt).toContain('{"value": null, "reason": "not_present"}');
    expect(prompt).toContain('{"value": null, "reason": "illegible"}');
  });

  it("embeds the JSON-only instruction", () => {
    expect(prompt).toMatch(/respond with json only/i);
    expect(prompt).toMatch(/no markdown code fences/i);
  });

  it("lists every given fact key", () => {
    expect(prompt).toContain("wps_transfer_date");
  });

  it("names the document class", () => {
    expect(prompt).toContain("WPS report");
  });
});
