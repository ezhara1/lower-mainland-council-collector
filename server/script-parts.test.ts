import { describe, expect, it } from "vitest";
import { splitScript } from "./script-parts.js";

describe("splitScript", () => {
  it("splits podcast scripts at segment headings", () => {
    const parts = splitScript(
      "## Regional opening\n\nHOST_A: Welcome.\nHOST_B: Hi.\n\n## Burnaby\n\nHOST_A: Burnaby approved a **budget**.",
    );
    expect(parts.map((part) => part.title)).toEqual(["Regional opening", "Burnaby"]);
    expect(parts[1].text).toBe("HOST_A: Burnaby approved a budget.");
  });

  it("reads headings aloud for plain digests and splits long sections", () => {
    const paragraph = "A".repeat(2_500);
    const parts = splitScript(`# Digest\n\n## Surrey\n\n${paragraph}\n\n${paragraph}`);
    expect(parts.map((part) => part.title)).toEqual(["Surrey", "Surrey (2)"]);
    expect(parts[0].text.startsWith("Surrey.")).toBe(true);
  });
});
