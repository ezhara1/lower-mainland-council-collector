import type { CollectedDocument } from "./types.js";

const CHUNK_SIZE = 24_000;

export type PodcastSegment = {
  index: number;
  title: string;
  text: string;
};

async function complete(apiKey: string, model: string, prompt: string) {
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
      "http-referer": "http://localhost:5173",
      "x-title": "Lower Mainland Council Collector",
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    throw new Error(`OpenRouter returned ${response.status}: ${await response.text()}`);
  }
  const body = (await response.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content;
  if (!content) throw new Error("OpenRouter returned no summary.");
  return content.trim();
}

async function summarizeDocument(
  document: CollectedDocument,
  apiKey: string,
  model: string,
) {
  if (!document.text) {
    return `${document.title}: Text extraction was unavailable.`;
  }
  const chunks = Array.from(
    { length: Math.ceil(document.text.length / CHUNK_SIZE) },
    (_, index) =>
      document.text.slice(index * CHUNK_SIZE, (index + 1) * CHUNK_SIZE),
  );
  const notes: string[] = [];
  for (const [index, chunk] of chunks.entries()) {
    notes.push(
      await complete(
        apiKey,
        model,
        `Summarize this municipal council document chunk. Capture decisions, proposed projects, budgets, zoning or development items, public hearings, deadlines, and named votes. Be factual and concise. This is chunk ${index + 1} of ${chunks.length}.\n\n${chunk}`,
      ),
    );
  }
  return complete(
    apiKey,
    model,
    `Create a concise final summary of "${document.title}" for a resident. Use 3 to 6 bullets and include the meeting date if known. Do not speculate.\n\n${notes.join("\n\n")}`,
  );
}

export async function buildDigest(
  documents: CollectedDocument[],
  apiKey: string,
  model: string,
  outputMode: "summary" | "podcast" | "custom" = "summary",
  customPrompt = "",
  podcastOptions?: {
    style?: string;
    styleNotes?: string;
    humorLevel?: string;
    allowProfanity?: boolean;
    energyLevel?: string;
    targetMinutes?: number;
    targetAudience?: string;
  },
  onPodcastSegment?: (segment: PodcastSegment) => Promise<void>,
) {
  const grouped = new Map<string, string[]>();
  for (const document of documents) {
    const summary = await summarizeDocument(document, apiKey, model);
    grouped.set(document.municipality, [
      ...(grouped.get(document.municipality) ?? []),
      `### ${document.title}\n${summary}`,
    ]);
  }

  const cityDigests: { municipality: string; text: string }[] = [];
  for (const [municipality, summaries] of grouped) {
    const digest = await complete(
      apiKey,
      model,
      `Create a very brief weekly civic digest for ${municipality}. Focus on what changed, what residents should watch, and material decisions. Use no more than 8 bullets.\n\n${summaries.join("\n\n")}`,
    );
    cityDigests.push({ municipality, text: digest });
  }

  const source = cityDigests
    .map(({ municipality, text }) => `## ${municipality}\n\n${text}`)
    .join("\n\n");
  if (outputMode === "podcast") {
    const options = podcastOptions ?? {};
    const sharedDirection = `Use only lines beginning with "HOST_A:" or "HOST_B:". Do not add stage directions.
Style: ${options.style || "conversational"}.
Additional style direction: ${options.styleNotes || "none"}.
Humor: ${options.humorLevel || "light"}.
Profanity: ${options.allowProfanity ? "permitted sparingly when it serves the requested style" : "not permitted"}.
Energy: ${options.energyLevel || "balanced"}.
Audience: ${options.targetAudience || "Lower Mainland residents"}.
Tone must never distort the facts, fabricate controversy, or present speculation as fact.`;
    const intro = await complete(
      apiKey,
      model,
      `Write a short opening segment for a two-host podcast about this week's Lower Mainland municipal council activity. Preview the most consequential regional themes and tell listeners which cities will be covered. ${sharedDirection}\n\n${source}`,
    );
    await onPodcastSegment?.({ index: 0, title: "Regional opening", text: intro });

    const scripts: PodcastSegment[] = new Array(cityDigests.length);
    let nextIndex = 0;
    const worker = async () => {
      while (nextIndex < cityDigests.length) {
        const index = nextIndex++;
        const city = cityDigests[index];
        const text = await complete(
          apiKey,
          model,
          `Write the ${city.municipality} segment of a two-host civic podcast. Explain the most important items clearly and connect them to resident impact. Aim for roughly ${Math.max(1, Math.round((options.targetMinutes || 10) / Math.max(cityDigests.length, 1)))} spoken minutes. ${sharedDirection}\n\n${city.text}`,
        );
        const segment = {
          index: index + 1,
          title: city.municipality,
          text,
        };
        scripts[index] = segment;
        await onPodcastSegment?.(segment);
      }
    };
    await Promise.all(
      Array.from({ length: Math.min(3, cityDigests.length) }, () => worker()),
    );
    return [intro, ...scripts.map((segment) => segment.text)].join("\n\n");
  }
  if (outputMode === "custom") {
    return complete(
      apiKey,
      model,
      `Follow the user's requested output format using only the supplied municipal council material. Do not invent facts.\n\nUSER REQUEST:\n${customPrompt}\n\nSOURCE DIGESTS:\n${source}`,
    );
  }
  const overview = await complete(
    apiKey,
    model,
    `Create a cross-city Lower Mainland overview from these municipal digests. Start with 5 to 10 bullets covering the most consequential themes, then note notable similarities or differences. Stay factual and concise.\n\n${source}`,
  );
  return `# Lower Mainland Council Digest\n\n## Regional overview\n\n${overview}\n\n${source}\n`;
}
