import { describe, expect, it } from "vitest";
import { findDate, inRange } from "./date";

describe("findDate", () => {
  it("parses ISO-like dates", () => {
    expect(findDate("Council agenda 2026-10-14.pdf")).toBe("2026-10-14");
  });

  it("parses named dates", () => {
    expect(findDate("Meeting held October 7, 2026")).toBe("2026-10-07");
  });

  it("parses Canadian numeric dates", () => {
    expect(findDate("Minutes 7/10/2026")).toBe("2026-10-07");
  });
});

describe("inRange", () => {
  it("includes both boundaries", () => {
    expect(inRange("2026-10-01", "2026-10-01", "2026-10-07")).toBe(true);
    expect(inRange("2026-10-07", "2026-10-01", "2026-10-07")).toBe(true);
  });

  it("rejects missing and out-of-range dates", () => {
    expect(inRange(null, "2026-10-01", "2026-10-07")).toBe(false);
    expect(inRange("2026-10-08", "2026-10-01", "2026-10-07")).toBe(false);
  });
});
