import { describe, expect, it } from "vitest";
import { derivedFindingPriority } from "./priority";
import { KEY_REQUIREMENT_NUMBERS } from "@/lib/rules/constants";

const KEY_SL_NO = KEY_REQUIREMENT_NUMBERS[0]!;
const NON_KEY_SL_NO = 1;

describe("derivedFindingPriority", () => {
  it("is high for Not Compliant on a key requirement", () => {
    expect(derivedFindingPriority("Not Compliant", KEY_SL_NO)).toBe("high");
  });

  it("is medium for Not Compliant on a non-key requirement", () => {
    expect(derivedFindingPriority("Not Compliant", NON_KEY_SL_NO)).toBe("medium");
  });

  it("is medium for Partial on a key requirement", () => {
    expect(derivedFindingPriority("Partial", KEY_SL_NO)).toBe("medium");
  });

  it("is low for Partial on a non-key requirement", () => {
    expect(derivedFindingPriority("Partial", NON_KEY_SL_NO)).toBe("low");
  });
});
