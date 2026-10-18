import { useEffect, useMemo, useState } from "react";

type Source = {
  id: string;
  name: string;
  officialName: string;
  platform: string;
  documentTypes: string[];
  accessNotes: string;
  enabledByDefault: boolean;
};

type Settings = {
  outputFolder: string;
  resolvedOutputFolder: string;
  openRouterModel: string;
};

type LibraryDocument = {
  id: string;
  sourceId: string;
  municipality: string;
  title: string;
  meetingDate: string | null;
  filePath: string;
};

type ScriptFile = { name: string; modifiedAt: string };

type CollectResult = {
  collected: number;
  skippedDuplicates: number;
  failedSources: { sourceId: string; error: string }[];
  warnings: string[];
};

type ScriptResult = { name: string; location: string; documents: number; warnings: string[] };
type AudioResult = { location: string; parts: number };
type Busy = "" | "settings" | "collect" | "script" | "save-script" | "audio";

const today = new Date().toISOString().slice(0, 10);
const daysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body as T;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>({
    outputFolder: "",
    resolvedOutputFolder: "",
    openRouterModel: "google/gemini-2.5-flash",
  });
  const [dateFrom, setDateFrom] = useState(daysAgo(7));
  const [dateTo, setDateTo] = useState(today);
  const [browserAssisted, setBrowserAssisted] = useState(false);
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [chosenDocuments, setChosenDocuments] = useState<string[]>([]);
  const [apiKey, setApiKey] = useState("");
  const [outputMode, setOutputMode] = useState<"summary" | "podcast" | "custom">("summary");
  const [customPrompt, setCustomPrompt] = useState("");
  const [podcastStyle, setPodcastStyle] = useState("conversational");
  const [podcastStyleNotes, setPodcastStyleNotes] = useState("");
  const [humorLevel, setHumorLevel] = useState("light");
  const [allowProfanity, setAllowProfanity] = useState(false);
  const [energyLevel, setEnergyLevel] = useState("balanced");
  const [targetMinutes, setTargetMinutes] = useState(10);
  const [targetAudience, setTargetAudience] = useState("Lower Mainland residents");
  const [scripts, setScripts] = useState<ScriptFile[]>([]);
  const [scriptName, setScriptName] = useState("");
  const [scriptText, setScriptText] = useState("");
  const [scriptEdited, setScriptEdited] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<"kokoro" | "chatterbox">("kokoro");
  const [hostAVoice, setHostAVoice] = useState("af_heart");
  const [hostBVoice, setHostBVoice] = useState("am_michael");
  const [audioConcurrency, setAudioConcurrency] = useState(1);
  const [busy, setBusy] = useState<Busy>("");
  const [error, setError] = useState("");
  const [collectResult, setCollectResult] = useState<CollectResult | null>(null);
  const [scriptResult, setScriptResult] = useState<ScriptResult | null>(null);
  const [audioResult, setAudioResult] = useState<AudioResult | null>(null);

  const refreshDocuments = () => api<LibraryDocument[]>("/api/documents").then(setDocuments);
  const refreshScripts = () => api<ScriptFile[]>("/api/scripts").then(setScripts);

  useEffect(() => {
    Promise.all([
      api<{ sources: Source[] }>("/api/sources"),
      api<Settings>("/api/settings"),
      refreshDocuments(),
      refreshScripts(),
    ])
      .then(([registry, loadedSettings]) => {
        setSources(registry.sources);
        setSelected(
          registry.sources.filter((source) => source.enabledByDefault).map((source) => source.id),
        );
        setSettings(loadedSettings);
      })
      .catch((loadError) => setError(errorText(loadError)));
  }, []);

  const allSelected = sources.length > 0 && selected.length === sources.length;
  const groupedSources = useMemo(
    () =>
      sources.reduce<Record<string, Source[]>>((groups, source) => {
        const key = source.platform || "Other";
        groups[key] = [...(groups[key] ?? []), source];
        return groups;
      }, {}),
    [sources],
  );
  const shownDocuments = useMemo(
    () =>
      documents
        .filter(
          (document) =>
            selected.includes(document.sourceId) &&
            (!document.meetingDate ||
              (document.meetingDate >= dateFrom && document.meetingDate <= dateTo)),
        )
        .sort(
          (left, right) =>
            left.municipality.localeCompare(right.municipality) ||
            (right.meetingDate ?? "").localeCompare(left.meetingDate ?? ""),
        ),
    [documents, selected, dateFrom, dateTo],
  );
  const chosenShown = shownDocuments.filter((document) => chosenDocuments.includes(document.id));

  async function task(kind: Busy, operation: () => Promise<void>) {
    setBusy(kind);
    setError("");
    try {
      await operation();
    } catch (taskError) {
      setError(errorText(taskError));
    } finally {
      setBusy("");
    }
  }

  function toggle(list: string[], id: string) {
    return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
  }

  const saveSettings = () =>
    task("settings", async () => {
      setSettings(
        await api<Settings>("/api/settings", {
          method: "PUT",
          body: JSON.stringify({
            outputFolder: settings.outputFolder,
            openRouterModel: settings.openRouterModel,
          }),
        }),
      );
      await refreshScripts();
    });

  const collect = () =>
    task("collect", async () => {
      setCollectResult(null);
      setCollectResult(
        await api<CollectResult>("/api/collect", {
          method: "POST",
          body: JSON.stringify({ sourceIds: selected, dateFrom, dateTo, browserAssisted }),
        }),
      );
      await refreshDocuments();
    });

  async function openScript(name: string) {
    setScriptName(name);
    setAudioResult(null);
    if (!name) {
      setScriptText("");
      return;
    }
    const { content } = await api<{ content: string }>(
      `/api/scripts/${encodeURIComponent(name)}`,
    );
    setScriptText(content);
    setScriptEdited(false);
  }

  const writeScript = () =>
    task("script", async () => {
      setScriptResult(null);
      const result = await api<ScriptResult>("/api/scripts", {
        method: "POST",
        body: JSON.stringify({
          documentIds: chosenShown.map((document) => document.id),
          openRouterApiKey: apiKey,
          openRouterModel: settings.openRouterModel,
          outputMode,
          customPrompt,
          podcastStyle,
          podcastStyleNotes,
          humorLevel,
          allowProfanity,
          energyLevel,
          targetMinutes,
          targetAudience,
        }),
      });
      setScriptResult(result);
      await refreshScripts();
      await openScript(result.name);
    });

  async function persistScript() {
    await api(`/api/scripts/${encodeURIComponent(scriptName)}`, {
      method: "PUT",
      body: JSON.stringify({ content: scriptText }),
    });
    setScriptEdited(false);
  }

  const saveScript = () => task("save-script", persistScript);

  const makeAudio = () =>
    task("audio", async () => {
      setAudioResult(null);
      if (scriptEdited) await persistScript();
      setAudioResult(
        await api<AudioResult>("/api/audio", {
          method: "POST",
          body: JSON.stringify({
            scriptName,
            ttsProvider,
            hostAVoice,
            hostBVoice,
            audioConcurrency,
          }),
        }),
      );
    });

  return (
    <div className="shell">
      <header>
        <div>
          <p className="eyebrow">Civic research workspace</p>
          <h1>Lower Mainland Council Collector</h1>
          <p className="lede">
            Collect official meeting records, write a digest or podcast script, and turn
            it into audio. Each step runs on its own.
          </p>
        </div>
        <div className={`status ${settings.resolvedOutputFolder ? "ok" : ""}`}>
          <span />
          {settings.resolvedOutputFolder || "Loading output folder"}
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      <main>
        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="step">01</span>
              <h2>Output folder</h2>
            </div>
            <p>
              Choose a folder inside Google Drive for desktop to sync files to Drive. The app
              adds Council Documents, Scripts and Audio subfolders.
            </p>
          </div>
          <div className="form-grid">
            <label className="span-two">
              Folder path
              <input
                value={settings.outputFolder}
                placeholder="~/Google Drive/My Drive/Council Collector"
                onChange={(event) =>
                  setSettings({ ...settings, outputFolder: event.target.value })
                }
              />
            </label>
          </div>
          <div className="button-row">
            <button className="secondary" onClick={saveSettings} disabled={busy !== ""}>
              {busy === "settings" ? "Saving…" : "Save folder"}
            </button>
          </div>
        </section>

        <section className="panel run-panel">
          <div className="section-heading">
            <div>
              <span className="step">02</span>
              <h2>Collect council documents</h2>
            </div>
            <p>Overlapping date ranges are safe. Documents saved earlier are skipped.</p>
          </div>
          <div className="date-grid">
            <label>
              From
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} />
            </label>
            <label>
              To
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} />
            </label>
            <div className="quick-ranges">
              <button className="ghost" onClick={() => setDateFrom(daysAgo(7))}>
                Last 7 days
              </button>
              <button className="ghost" onClick={() => setDateFrom(daysAgo(30))}>
                Last 30 days
              </button>
            </div>
          </div>
          <label className="check-row">
            <input
              type="checkbox"
              checked={browserAssisted}
              onChange={(event) => setBrowserAssisted(event.target.checked)}
            />
            Open a local browser for protected portals such as West Vancouver
          </label>

          <div className="section-heading compact">
            <div>
              <h2>Municipalities</h2>
            </div>
            <button
              className="text-button"
              onClick={() => setSelected(allSelected ? [] : sources.map((source) => source.id))}
            >
              {allSelected ? "Clear all" : "Select all"}
            </button>
          </div>
          <div className="source-grid">
            {Object.entries(groupedSources).map(([platform, platformSources]) => (
              <div className="source-group" key={platform}>
                <p>{platform}</p>
                {platformSources.map((source) => (
                  <label className="source" key={source.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(source.id)}
                      onChange={() => setSelected(toggle(selected, source.id))}
                    />
                    <span>
                      <strong>{source.name}</strong>
                      <small>{source.documentTypes.join(" · ")}</small>
                    </span>
                  </label>
                ))}
              </div>
            ))}
          </div>
          <div className="launch">
            <div>
              <p className="eyebrow">Collect</p>
              <h2>
                {selected.length} municipalities, {dateFrom} to {dateTo}
              </h2>
            </div>
            <button
              className="run-button"
              disabled={busy !== "" || !selected.length || dateFrom > dateTo}
              onClick={collect}
            >
              {busy === "collect" ? "Collecting documents…" : "Collect documents"}
            </button>
          </div>
          {collectResult && (
            <div className="result">
              <h2>{collectResult.collected} new documents saved</h2>
              <p>
                {collectResult.skippedDuplicates} already saved · {collectResult.failedSources.length}{" "}
                sources failed
              </p>
              {collectResult.failedSources.map((failure) => (
                <div className="alert" key={failure.sourceId}>
                  {failure.sourceId}: {failure.error}
                </div>
              ))}
              {collectResult.warnings.map((warning) => (
                <div className="alert" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="step">03</span>
              <h2>Write a digest or podcast script</h2>
            </div>
            <p>Uses saved documents for the municipalities and dates chosen above.</p>
          </div>
          <div className="section-heading compact">
            <div>
              <h2>
                {chosenShown.length} of {shownDocuments.length} documents chosen
              </h2>
            </div>
            <button
              className="text-button"
              onClick={() =>
                setChosenDocuments(
                  chosenShown.length === shownDocuments.length
                    ? []
                    : shownDocuments.map((document) => document.id),
                )
              }
            >
              {shownDocuments.length && chosenShown.length === shownDocuments.length
                ? "Clear all"
                : "Select all"}
            </button>
          </div>
          <div className="doc-list">
            {!shownDocuments.length && <p>No saved documents match. Collect some first.</p>}
            {shownDocuments.map((document) => (
              <label className="source" key={document.id} title={document.filePath}>
                <input
                  type="checkbox"
                  checked={chosenDocuments.includes(document.id)}
                  onChange={() => setChosenDocuments(toggle(chosenDocuments, document.id))}
                />
                <span>
                  <strong>{document.title}</strong>
                  <small>
                    {document.municipality} · {document.meetingDate ?? "Undated"}
                  </small>
                </span>
              </label>
            ))}
          </div>

          <div className="three-options">
            {[
              ["summary", "Civic digest", "Brief city and regional takeaways"],
              ["podcast", "Podcast script", "A two-host spoken narrative"],
              ["custom", "Custom", "Your exact instruction and format"],
            ].map(([value, title, detail]) => (
              <button
                key={value}
                className={`option ${outputMode === value ? "active" : ""}`}
                onClick={() => setOutputMode(value as "summary" | "podcast" | "custom")}
              >
                <strong>{title}</strong>
                <span>{detail}</span>
              </button>
            ))}
          </div>
          <div className="form-grid">
            <label>
              OpenRouter API key
              <input
                type="password"
                value={apiKey}
                placeholder="Not saved"
                onChange={(event) => setApiKey(event.target.value)}
              />
            </label>
            <label>
              Model
              <input
                value={settings.openRouterModel}
                onChange={(event) =>
                  setSettings({ ...settings, openRouterModel: event.target.value })
                }
              />
            </label>
          </div>
          {outputMode === "custom" && (
            <label>
              Output instruction
              <textarea
                value={customPrompt}
                placeholder="For example: Write a one-page briefing for a housing policy analyst."
                onChange={(event) => setCustomPrompt(event.target.value)}
              />
            </label>
          )}
          {outputMode === "podcast" && (
            <div className="podcast-controls">
              <div className="form-grid three">
                <label>
                  Style
                  <select value={podcastStyle} onChange={(event) => setPodcastStyle(event.target.value)}>
                    <option value="analytical">Analytical</option>
                    <option value="conversational">Conversational</option>
                    <option value="witty">Witty</option>
                    <option value="sensational">Sensational</option>
                    <option value="executive">Executive briefing</option>
                  </select>
                </label>
                <label>
                  Humor
                  <select value={humorLevel} onChange={(event) => setHumorLevel(event.target.value)}>
                    <option value="none">None</option>
                    <option value="light">Light</option>
                    <option value="strong">Strong</option>
                  </select>
                </label>
                <label>
                  Energy
                  <select value={energyLevel} onChange={(event) => setEnergyLevel(event.target.value)}>
                    <option value="calm">Calm</option>
                    <option value="balanced">Balanced</option>
                    <option value="high">High</option>
                  </select>
                </label>
                <label>
                  Target minutes
                  <input
                    type="number"
                    min="2"
                    max="60"
                    value={targetMinutes}
                    onChange={(event) => setTargetMinutes(Number(event.target.value))}
                  />
                </label>
                <label>
                  Audience
                  <input
                    value={targetAudience}
                    onChange={(event) => setTargetAudience(event.target.value)}
                  />
                </label>
                <label className="check-field">
                  <input
                    type="checkbox"
                    checked={allowProfanity}
                    onChange={(event) => setAllowProfanity(event.target.checked)}
                  />
                  Permit occasional profanity
                </label>
              </div>
              <label>
                Additional style direction
                <textarea
                  value={podcastStyleNotes}
                  placeholder="For example: Dry Vancouver humor, but never mock residents."
                  onChange={(event) => setPodcastStyleNotes(event.target.value)}
                />
              </label>
            </div>
          )}
          <div className="button-row">
            <button
              disabled={busy !== "" || !chosenShown.length || !apiKey}
              onClick={writeScript}
            >
              {busy === "script" ? "Writing script…" : "Write script"}
            </button>
          </div>
          {scriptResult && (
            <div className="result">
              <h2>Saved {scriptResult.name}</h2>
              <p>
                From {scriptResult.documents} documents · {scriptResult.location}
              </p>
              {scriptResult.warnings.map((warning) => (
                <div className="alert" key={warning}>
                  {warning}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="step">04</span>
              <h2>Review a script and make audio</h2>
            </div>
            <p>Pick any saved script. Edits are saved back to the Scripts folder.</p>
          </div>
          <div className="form-grid">
            <label className="span-two">
              Script
              <select
                value={scriptName}
                onChange={(event) => openScript(event.target.value).catch((openError) => setError(errorText(openError)))}
              >
                <option value="">Choose a script</option>
                {scripts.map((script) => (
                  <option key={script.name} value={script.name}>
                    {script.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          {scriptName && (
            <>
              <textarea
                className="script-editor"
                value={scriptText}
                onChange={(event) => {
                  setScriptText(event.target.value);
                  setScriptEdited(true);
                }}
              />
              <div className="form-grid three">
                <label>
                  Speech engine
                  <select
                    value={ttsProvider}
                    onChange={(event) => setTtsProvider(event.target.value as "kokoro" | "chatterbox")}
                  >
                    <option value="kokoro">Kokoro</option>
                    <option value="chatterbox">Chatterbox</option>
                  </select>
                </label>
                <label>
                  Host A voice
                  <input value={hostAVoice} onChange={(event) => setHostAVoice(event.target.value)} />
                </label>
                <label>
                  Host B voice
                  <input value={hostBVoice} onChange={(event) => setHostBVoice(event.target.value)} />
                </label>
                <label>
                  Parallel audio jobs
                  <select
                    value={audioConcurrency}
                    onChange={(event) => setAudioConcurrency(Number(event.target.value))}
                  >
                    <option value={1}>1, safest</option>
                    <option value={2}>2, faster</option>
                    <option value={3}>3, high-memory systems</option>
                  </select>
                </label>
              </div>
              <div className="button-row">
                <button
                  className="secondary"
                  disabled={busy !== "" || !scriptEdited}
                  onClick={saveScript}
                >
                  {busy === "save-script" ? "Saving…" : "Save edits"}
                </button>
                <button disabled={busy !== "" || !scriptText.trim()} onClick={makeAudio}>
                  {busy === "audio" ? "Making audio…" : "Make audio"}
                </button>
              </div>
            </>
          )}
          {audioResult && (
            <div className="result">
              <h2>Audio saved</h2>
              <p>
                {audioResult.parts} parts combined · {audioResult.location}
              </p>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
