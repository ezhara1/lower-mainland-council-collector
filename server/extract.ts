import * as cheerio from "cheerio";
import JSZip from "jszip";
import { PDFParse } from "pdf-parse";

export function cleanText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export function htmlToText(html: string) {
  const $ = cheerio.load(html);
  $("script, style, nav, footer, header").remove();
  return cleanText($("main, article").first().text() || $("body").text());
}

export async function extractText(bytes: Buffer, contentType: string) {
  if (contentType.includes("pdf")) {
    const parser = new PDFParse({ data: bytes });
    const result = await parser.getText();
    await parser.destroy();
    return cleanText(result.text);
  }
  if (
    contentType.includes("wordprocessingml")
  ) {
    const archive = await JSZip.loadAsync(bytes);
    const documentXml = await archive.file("word/document.xml")?.async("string");
    if (!documentXml) return "";
    const $ = cheerio.load(documentXml, { xmlMode: true });
    return cleanText(
      $("w\\:p")
        .map((_, paragraph) =>
          $(paragraph)
            .find("w\\:t")
            .map((__, text) => $(text).text())
            .get()
            .join(""),
        )
        .get()
        .join("\n"),
    );
  }
  if (contentType.includes("html")) {
    return htmlToText(bytes.toString("utf8"));
  }
  if (contentType.startsWith("text/")) {
    return cleanText(bytes.toString("utf8"));
  }
  return "";
}
