import JSZip from "jszip";
import { describe, expect, it } from "vitest";
import { extractText, htmlToText } from "./extract";

describe("htmlToText", () => {
  it("uses article content and removes scripts", () => {
    expect(
      htmlToText(
        "<html><body><nav>Menu</nav><article>Council approved housing.</article><script>bad()</script></body></html>",
      ),
    ).toBe("Council approved housing.");
  });
});

describe("extractText", () => {
  it("extracts paragraphs from DOCX XML", async () => {
    const archive = new JSZip();
    archive.file(
      "word/document.xml",
      '<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>First item</w:t></w:r></w:p><w:p><w:r><w:t>Second item</w:t></w:r></w:p></w:body></w:document>',
    );
    const bytes = await archive.generateAsync({ type: "nodebuffer" });
    await expect(
      extractText(
        bytes,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).resolves.toBe("First item Second item");
  });
});
