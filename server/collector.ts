import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import * as cheerio from "cheerio";
import { chromium } from "playwright";
import { extractText } from "./extract.js";
import { findDate, inRange } from "./date.js";
import type { CollectedDocument, MunicipalSource } from "./types.js";
import { dataPath } from "./paths.js";

const DOCUMENT_PATTERN =
  /\.(pdf|docx?|txt)(?:$|\?)|agenda|minutes|meeting|council|package|report/i;
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131 Safari/537.36";

async function fetchWithRetry(
  url: string | URL,
  options: RequestInit,
  attempts = 5,
) {
  let response: Response | undefined;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    response = await fetch(url, options);
    if (response.status !== 429 && response.status < 500) return response;
    if (attempt === attempts - 1) return response;
    const retryAfter = Number(response.headers.get("retry-after"));
    const delay = Number.isFinite(retryAfter)
      ? retryAfter * 1_000
      : Math.min(30_000, 2_000 * 2 ** attempt);
    await new Promise((resolve) => setTimeout(resolve, delay));
  }
  return response!;
}

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
  const response = await fetchWithRetry(url, {
    headers: {
      "user-agent": BROWSER_USER_AGENT,
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

async function fetchBrowserDownload(url: string) {
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    browser = await chromium.launch({ headless: true });
  }
  try {
    const context = await browser.newContext({
      acceptDownloads: true,
      userAgent: BROWSER_USER_AGENT,
    });
    const page = await context.newPage();
    const parsed = new URL(url);
    await page.goto(parsed.origin, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    const downloadPromise = page.waitForEvent("download", { timeout: 45_000 });
    await page.evaluate((downloadUrl) => {
      window.location.href = downloadUrl;
    }, url);
    const download = await downloadPromise;
    const temporaryPath = await download.path();
    if (!temporaryPath) throw new Error("Browser download did not create a file.");
    const bytes = await readFile(temporaryPath);
    const fileName = download.suggestedFilename().toLowerCase();
    const contentType = fileName.endsWith(".pdf")
      ? "application/pdf"
      : fileName.endsWith(".docx")
        ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
        : "application/octet-stream";
    return { bytes, contentType, finalUrl: url };
  } finally {
    await browser.close();
  }
}

type Candidate = { url: string; title: string; date: string | null };
let escribeCalendarQueue = Promise.resolve();

async function waitForEscribeCalendarSlot() {
  const current = escribeCalendarQueue.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, 750)),
  );
  escribeCalendarQueue = current.catch(() => undefined);
  await current;
}

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
  await waitForEscribeCalendarSlot();
  const response = await fetchWithRetry(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      referer: base,
      "user-agent": BROWSER_USER_AGENT,
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

async function discoverNorthVancouverDistrictCandidates(
  dateFrom: string,
  dateTo: string,
) {
  const endpoint = new URL(
    "https://simplicity-api.dnv.org/public/event/search/advanced",
  );
  endpoint.searchParams.set("from", `${dateFrom} 00:00:00`);
  endpoint.searchParams.set("to", `${dateTo} 23:59:59`);
  endpoint.searchParams.set("model_filters[0][type]", "model.council-meeting-v3");
  endpoint.searchParams.set("model_filters[1][type]", "model.committee-meeting-v3");
  endpoint.searchParams.set("include[0]", "meeting");
  endpoint.searchParams.set("include[1]", "model");
  endpoint.searchParams.set("page", "1");
  endpoint.searchParams.set("pageSize", "500");
  endpoint.searchParams.set("sort", "start_at");
  endpoint.searchParams.set("sortdir", "asc");
  const response = await fetchWithRetry(endpoint, {
    headers: { "user-agent": BROWSER_USER_AGENT },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`North Vancouver District API returned ${response.status}.`);
  }
  const payload = (await response.json()) as {
    results?: {
      start_at?: string;
      event?: { title?: string };
      model?: {
        fields?: {
          name?: string;
          values?: { value?: string }[];
        }[];
      };
    }[];
  };
  const candidates: Candidate[] = [];
  for (const result of payload.results ?? []) {
    const date = findDate(result.start_at ?? "");
    const documentIds =
      result.model?.fields
        ?.find((field) => field.name === "council_documents")
        ?.values?.flatMap((value) => (value.value ? [value.value] : [])) ?? [];
    for (const documentId of documentIds) {
      const metadataResponse = await fetchWithRetry(
        `https://simplicity-api.dnv.org/public/media/documents/${documentId}`,
        {
          headers: { "user-agent": BROWSER_USER_AGENT },
          signal: AbortSignal.timeout(30_000),
        },
      );
      if (!metadataResponse.ok) continue;
      const metadata = (await metadataResponse.json()) as {
        title?: string;
        url?: string;
      };
      if (!metadata.url) continue;
      candidates.push({
        url: metadata.url,
        title:
          metadata.title ?? result.event?.title ?? "Council meeting document",
        date,
      });
    }
  }
  return candidates;
}

async function renderPersistentPage(
  url: string,
  profileName: string,
  browserAssisted: boolean,
) {
  const profilePath = dataPath("browser-profiles", profileName);
  await mkdir(profilePath, { recursive: true });
  let context;
  try {
    context = await chromium.launchPersistentContext(profilePath, {
      channel: "chrome",
      headless: !browserAssisted,
      userAgent: BROWSER_USER_AGENT,
    });
  } catch {
    context = await chromium.launchPersistentContext(profilePath, {
      headless: !browserAssisted,
      userAgent: BROWSER_USER_AGENT,
    });
  }
  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2_000);
    let bodyText = await page.locator("body").innerText().catch(() => "");
    if (
      browserAssisted &&
      /sorry, you have been blocked|attention required|verify you are human/i.test(
        bodyText,
      )
    ) {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        await page.waitForTimeout(2_000);
        bodyText = await page.locator("body").innerText().catch(() => "");
        if (
          !/sorry, you have been blocked|attention required|verify you are human/i.test(
            bodyText,
          )
        ) {
          break;
        }
      }
    }
    if (/sorry, you have been blocked|attention required/i.test(bodyText)) {
      throw new Error(
        browserAssisted
          ? "Cloudflare still blocked the verified browser session."
          : "Portal blocked the browser session with Cloudflare. Retry with browser-assisted access enabled.",
      );
    }
    return { html: await page.content(), finalUrl: page.url() };
  } finally {
    await context.close();
  }
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
      userAgent: BROWSER_USER_AGENT,
    });
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForTimeout(2_000);
    const html = await page.content();
    const bodyText = await page.locator("body").innerText().catch(() => "");
    if (/sorry, you have been blocked|attention required/i.test(bodyText)) {
      throw new Error("Portal blocked the browser session with Cloudflare.");
    }
    return { html, finalUrl: page.url() };
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
  browserAssisted: boolean,
) {
  if (source.id === "north-vancouver-district") {
    return discoverNorthVancouverDistrictCandidates(dateFrom, dateTo);
  }
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
  const rendered =
    source.id === "west-vancouver"
      ? await renderPersistentPage(startUrl, source.id, browserAssisted)
      : await renderPage(startUrl);
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
  options: { browserAssisted?: boolean } = {},
) {
  const candidates = await discoverCandidates(
    source,
    dateFrom,
    dateTo,
    options.browserAssisted ?? false,
  );
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
      if (/FileStream\.ashx/i.test(candidate.url)) {
        try {
          fetched = await fetchBrowserDownload(candidate.url);
        } catch (browserError) {
          downloadErrors.push(
            `${candidate.title}: ${
              browserError instanceof Error
                ? browserError.message
                : String(browserError)
            }`,
          );
          continue;
        }
      } else {
        downloadErrors.push(
          `${candidate.title}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
    }
    const nested = fetched.contentType.includes("html")
      ? nestedDocuments(
          fetched.bytes.toString("utf8"),
          fetched.finalUrl,
          candidate.date,
        )
      : [];
    const downloadable = fetched.contentType.includes("html")
      ? [candidate, ...nested]
      : [candidate];
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
