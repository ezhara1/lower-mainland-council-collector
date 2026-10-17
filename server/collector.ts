import path from "node:path";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { extractText } from "./extract.js";
import { findDate, inRange } from "./date.js";
import type { CollectedDocument, MunicipalSource } from "./types.js";

const DOCUMENT_PATTERN =
  /\.(pdf|docx?|txt)(?:$|\?)|agenda|minutes|meeting|council|package|report/i;

function safeFileName(value: string) {
  return value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function extension(url: string, contentType: string) {
  const pathnameExtension = path.extname(new URL(url).pathname).toLowerCase();
  if (pathnameExtension && pathnameExtension.length <= 6) {
    return pathnameExtension;
  }
  if (contentType.includes("pdf")) return ".pdf";
  if (contentType.includes("wordprocessingml")) return ".docx";
  if (contentType.includes("msword")) return ".doc";
  if (contentType.includes("html")) return ".html";
  return ".bin";
}

async function fetchBuffer(url: string) {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "LowerMainlandCouncilCollector/0.1 (+personal civic research)",
      accept: "text/html,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,*/*",
    },
    redirect: "follow",
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return {
    bytes: Buffer.from(await response.arrayBuffer()),
    contentType:
      response.headers.get("content-type")?.split(";")[0] ??
      "application/octet-stream",
    finalUrl: response.url,
  };
}

type Candidate = { url: string; title: string; date: string | null };

function escribeBase(source: MunicipalSource) {
  return [source.meetingPortalUrl, source.calendarUrl].find((url) =>
    url.includes("escribemeetings.com"),
  );
}

async function discoverEscribeCandidates(
  source: MunicipalSource,
  dateFrom: string,
  dateTo: string,
) {
  const base = escribeBase(source);
  if (!base) throw new Error("eSCRIBE source has no eSCRIBE portal URL.");
  const endpoint = new URL("/MeetingsCalendarView.aspx/GetCalendarMeetings", base);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      referer: base,
      "user-agent":
        "LowerMainlandCouncilCollector/0.1 (+personal civic research)",
    },
    body: JSON.stringify({
      calendarStartDate: `${dateFrom}T00:00:00-08:00`,
      calendarEndDate: `${dateTo}T23:59:59-08:00`,
    }),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`eSCRIBE calendar returned ${response.status}.`);
  }
  const payload = (await response.json()) as {
    d?: {
      MeetingName?: string;
      StartDate?: string;
      Url?: string;
      MeetingDocumentLink?: { Title?: string; Url?: string }[];
    }[];
  };
  const candidates: Candidate[] = [];
  for (const meeting of payload.d ?? []) {
    const date = findDate(meeting.StartDate?.replaceAll("/", "-") ?? "");
    for (const document of meeting.MeetingDocumentLink ?? []) {
      if (!document.Url) continue;
      if (/video/i.test(document.Title ?? "") || /player/i.test(document.Url)) {
        continue;
      }
      candidates.push({
        url: new URL(document.Url, base).toString(),
        title: `${meeting.MeetingName ?? "Council meeting"} - ${
          document.Title ?? "document"
        }`,
        date,
      });
    }
    if (!(meeting.MeetingDocumentLink ?? []).length && meeting.Url) {
      candidates.push({
        url: new URL(meeting.Url, base).toString(),
        title: meeting.MeetingName ?? "Council meeting",
        date,
      });
    }
  }
  return candidates;
}

async function renderPage(url: string) {
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    browser = await chromium.launch({ headless: true });
  }
  try {
    const page = await browser.newPage({
      userAgent:
        "LowerMainlandCouncilCollector/0.1 (+personal civic research)",
    });
    await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
    return { html: await page.content(), finalUrl: page.url() };
  } finally {
    await browser.close();
  }
}

function candidatesFromHtml(html: string, finalUrl: string) {
  const $ = cheerio.load(html);
  const candidates = new Map<string, Candidate>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    let url: string;
    try {
      url = new URL(href, finalUrl).toString();
    } catch {
      return;
    }
    const title = $(element).text().replace(/\s+/g, " ").trim();
    const context = $(element)
      .closest("tr, li, article, section, div")
      .text()
      .replace(/\s+/g, " ")
      .trim();
    if (!DOCUMENT_PATTERN.test(`${url} ${title} ${context}`)) return;
    candidates.set(url, {
      url,
      title: title || "Council meeting document",
      date: findDate(`${context} ${url}`),
    });
  });
  return [...candidates.values()];
}

async function discoverCandidates(
  source: MunicipalSource,
  dateFrom: string,
  dateTo: string,
) {
  if (source.platform === "escribe") {
    return discoverEscribeCandidates(source, dateFrom, dateTo);
  }
  const startUrl = source.calendarUrl || source.meetingPortalUrl;
  try {
    const { bytes, contentType, finalUrl } = await fetchBuffer(startUrl);
    if (!contentType.includes("html")) {
      return [
        {
          url: finalUrl,
          title: `${source.name} council document`,
          date: findDate(finalUrl),
        },
      ];
    }
    const candidates = candidatesFromHtml(bytes.toString("utf8"), finalUrl);
    if (candidates.length) return candidates;
  } catch {
    // Browser fallback below handles JavaScript portals and bot-protected HTML.
  }
  const rendered = await renderPage(startUrl);
  const renderedCandidates = candidatesFromHtml(rendered.html, rendered.finalUrl);
  if (!renderedCandidates.length) {
    throw new Error(
      "Source health check failed: no meeting or document links were found after direct and browser access.",
    );
  }
  return renderedCandidates;
}

function nestedDocuments(html: string, baseUrl: string, meetingDate: string | null) {
  const $ = cheerio.load(html);
  const documents = new Map<string, Candidate>();
  $("a[href]").each((_, element) => {
    const href = $(element).attr("href");
    if (!href) return;
    let url: string;
    try {
      url = new URL(href, baseUrl).toString();
    } catch {
      return;
    }
    const title = $(element).text().replace(/\s+/g, " ").trim();
    if (!/\.(pdf|docx?|txt)(?:$|\?)/i.test(url)) return;
    documents.set(url, {
      url,
      title: title || "Council meeting attachment",
      date: meetingDate,
    });
  });
  return [...documents.values()];
}

export async function collectSource(
  source: MunicipalSource,
  dateFrom: string,
  dateTo: string,
) {
  const candidates = await discoverCandidates(source, dateFrom, dateTo);
  const dated = candidates.filter((candidate) =>
    inRange(candidate.date, dateFrom, dateTo),
  );
  const documents: CollectedDocument[] = [];
  const downloadErrors: string[] = [];

  for (const candidate of dated.slice(0, 100)) {
    let fetched;
    try {
      fetched = await fetchBuffer(candidate.url);
    } catch (error) {
      downloadErrors.push(
        `${candidate.title}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    const nested = fetched.contentType.includes("html")
      ? nestedDocuments(
          fetched.bytes.toString("utf8"),
          fetched.finalUrl,
          candidate.date,
        )
      : [];
    const downloadable = nested.length ? nested : [candidate];
    for (const item of downloadable.slice(0, 50)) {
      let downloaded;
      try {
        downloaded =
          item.url === fetched.finalUrl ? fetched : await fetchBuffer(item.url);
      } catch (error) {
        downloadErrors.push(
          `${item.title}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
      const { bytes, contentType, finalUrl } = downloaded;
      const text = await extractText(bytes, contentType);
      const datePrefix = item.date ?? "undated";
      documents.push({
        sourceId: source.id,
        municipality: source.name,
        title: item.title,
        url: finalUrl,
        meetingDate: item.date,
        publishedDate: null,
        mimeType: contentType,
        fileName: `${datePrefix} - ${safeFileName(item.title)}${extension(finalUrl, contentType)}`,
        bytes,
        text,
      });
    }
  }

  if (!documents.length && downloadErrors.length) {
    throw new Error(
      `Found matching documents but could not download them. ${downloadErrors[0]}`,
    );
  }
  return [...new Map(documents.map((document) => [document.url, document])).values()];
}
