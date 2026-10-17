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
  googleClientId: string;
  googleClientSecret: string;
  googleDriveFolderId: string;
  googleConnected: boolean;
  openRouterModel: string;
};

type RunResult = {
  runId: string;
  completedAt: string;
  collected: number;
  skippedDuplicates: number;
  failedSources: { sourceId: string; error: string }[];
  files: { municipality: string; title: string; location: string }[];
  digestLocation?: string;
  audioLocation?: string;
  warnings: string[];
};

const today = new Date().toISOString().slice(0, 10);
const weekAgo = new Date(Date.now() - 7 * 86_400_000)
  .toISOString()
  .slice(0, 10);

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "content-type": "application/json", ...init?.headers },
  });
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || response.statusText);
  return body as T;
}

export function App() {
  const [sources, setSources] = useState<Source[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [settings, setSettings] = useState<Settings>({
    googleClientId: "",
    googleClientSecret: "",
    googleDriveFolderId: "",
    googleConnected: false,
    openRouterModel: "google/gemini-2.5-flash",
  });
  const [dateFrom, setDateFrom] = useState(weekAgo);
  const [dateTo, setDateTo] = useState(today);
  const [summarize, setSummarize] = useState(true);
  const [apiKey, setApiKey] = useState("");
  const [outputMode, setOutputMode] = useState<"summary" | "podcast" | "custom">(
    "summary",
  );
  const [customPrompt, setCustomPrompt] = useState("");
  const [podcastStyle, setPodcastStyle] = useState("conversational");
  const [podcastStyleNotes, setPodcastStyleNotes] = useState("");
  const [humorLevel, setHumorLevel] = useState("light");
  const [allowProfanity, setAllowProfanity] = useState(false);
  const [energyLevel, setEnergyLevel] = useState("balanced");
  const [targetMinutes, setTargetMinutes] = useState(10);
  const [targetAudience, setTargetAudience] = useState(
    "Lower Mainland residents",
  );
  const [generateAudio, setGenerateAudio] = useState(false);
  const [ttsProvider, setTtsProvider] = useState<"kokoro" | "chatterbox">(
    "kokoro",
  );
  const [hostAVoice, setHostAVoice] = useState("af_heart");
  const [hostBVoice, setHostBVoice] = useState("am_michael");
  const [audioConcurrency, setAudioConcurrency] = useState(1);
  const [browserAssisted, setBrowserAssisted] = useState(false);
  const [running, setRunning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<RunResult | null>(null);

  useEffect(() => {
    Promise.all([
      api<{ sources: Source[] }>("/api/sources"),
      api<Settings>("/api/settings"),
    ])
      .then(([registry, loadedSettings]) => {
        setSources(registry.sources);
        setSelected(
          registry.sources
            .filter((source) => source.enabledByDefault)
            .map((source) => source.id),
        );
        setSettings(loadedSettings);
      })
      .catch((loadError: Error) => setError(loadError.message));
  }, []);

  const selectedCount = selected.length;
  const allSelected = sources.length > 0 && selectedCount === sources.length;
  const groupedSources = useMemo(
    () =>
      sources.reduce<Record<string, Source[]>>((groups, source) => {
        const key = source.platform || "Other";
        groups[key] = [...(groups[key] ?? []), source];
        return groups;
      }, {}),
    [sources],
  );

  function toggleSource(id: string) {
    setSelected((current) =>
      current.includes(id)
        ? current.filter((sourceId) => sourceId !== id)
        : [...current, id],
    );
  }

  async function saveConfiguration() {
    setSaving(true);
    setError("");
    try {
      await api("/api/settings", {
        method: "PUT",
        body: JSON.stringify(settings),
      });
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : String(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function connectGoogle() {
    try {
      await saveConfiguration();
      const { url } = await api<{ url: string }>("/api/google/auth-url");
      window.location.href = url;
    } catch (connectError) {
      setError(
        connectError instanceof Error ? connectError.message : String(connectError),
      );
    }
  }

  async function run() {
    setRunning(true);
    setError("");
    setResult(null);
    try {
      const runResult = await api<RunResult>("/api/run", {
        method: "POST",
        body: JSON.stringify({
          sourceIds: selected,
          dateFrom,
          dateTo,
          summarize,
          openRouterApiKey: apiKey || undefined,
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
          generateAudio,
          ttsProvider,
          hostAVoice,
          hostBVoice,
          audioConcurrency,
          browserAssisted,
        }),
      });
      setResult(runResult);
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : String(runError));
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="shell">
      <header>
        <div>
          <p className="eyebrow">Civic research workspace</p>
          <h1>Lower Mainland Council Collector</h1>
          <p className="lede">
            Gather official meeting records, build a regional digest, and turn
            it into something worth listening to.
          </p>
        </div>
        <div className={`status ${settings.googleConnected ? "ok" : ""}`}>
          <span />
          {settings.googleConnected ? "Google Drive connected" : "Drive setup required"}
        </div>
      </header>

      {error && <div className="alert error">{error}</div>}

      <main>
        <section className="panel run-panel">
          <div className="section-heading">
            <div>
              <span className="step">01</span>
              <h2>Choose the coverage window</h2>
            </div>
            <p>Overlapping runs are safe. Previously saved URLs are skipped.</p>
          </div>
          <div className="date-grid">
            <label>
              From
              <input
                type="date"
                value={dateFrom}
                onChange={(event) => setDateFrom(event.target.value)}
              />
            </label>
            <label>
              To
              <input
                type="date"
                value={dateTo}
                onChange={(event) => setDateTo(event.target.value)}
              />
            </label>
            <div className="quick-ranges">
              <button
                className="ghost"
                onClick={() =>
                  setDateFrom(
                    new Date(Date.now() - 7 * 86_400_000)
                      .toISOString()
                      .slice(0, 10),
                  )
                }
              >
                Last 7 days
              </button>
              <button
                className="ghost"
                onClick={() =>
                  setDateFrom(
                    new Date(Date.now() - 30 * 86_400_000)
                      .toISOString()
                      .slice(0, 10),
                  )
                }
              >
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
              <span className="step">02</span>
              <h2>Select municipalities</h2>
            </div>
            <button
              className="text-button"
              onClick={() =>
                setSelected(allSelected ? [] : sources.map((source) => source.id))
              }
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
                      onChange={() => toggleSource(source.id)}
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
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="step">03</span>
              <h2>Shape the output</h2>
            </div>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={summarize}
                onChange={(event) => setSummarize(event.target.checked)}
              />
              Analyze with OpenRouter
            </label>
          </div>
          {summarize && (
            <>
              <div className="three-options">
                {[
                  ["summary", "Civic digest", "Brief city and regional takeaways"],
                  ["podcast", "Podcast script", "A two-host spoken narrative"],
                  ["custom", "Custom", "Your exact instruction and format"],
                ].map(([value, title, detail]) => (
                  <button
                    key={value}
                    className={`option ${outputMode === value ? "active" : ""}`}
                    onClick={() =>
                      setOutputMode(value as "summary" | "podcast" | "custom")
                    }
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
                    placeholder="Used for this run only"
                    onChange={(event) => setApiKey(event.target.value)}
                  />
                </label>
                <label>
                  Model
                  <input
                    value={settings.openRouterModel}
                    onChange={(event) =>
                      setSettings({
                        ...settings,
                        openRouterModel: event.target.value,
                      })
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
                      <select
                        value={podcastStyle}
                        onChange={(event) => setPodcastStyle(event.target.value)}
                      >
                        <option value="analytical">Analytical</option>
                        <option value="conversational">Conversational</option>
                        <option value="witty">Witty</option>
                        <option value="sensational">Sensational</option>
                        <option value="executive">Executive briefing</option>
                      </select>
                    </label>
                    <label>
                      Humor
                      <select
                        value={humorLevel}
                        onChange={(event) => setHumorLevel(event.target.value)}
                      >
                        <option value="none">None</option>
                        <option value="light">Light</option>
                        <option value="strong">Strong</option>
                      </select>
                    </label>
                    <label>
                      Energy
                      <select
                        value={energyLevel}
                        onChange={(event) => setEnergyLevel(event.target.value)}
                      >
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
                        onChange={(event) =>
                          setTargetMinutes(Number(event.target.value))
                        }
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
                        onChange={(event) =>
                          setAllowProfanity(event.target.checked)
                        }
                      />
                      Permit occasional profanity
                    </label>
                  </div>
                  <label>
                    Additional style direction
                    <textarea
                      value={podcastStyleNotes}
                      placeholder="For example: Dry Vancouver humor, but never mock residents."
                      onChange={(event) =>
                        setPodcastStyleNotes(event.target.value)
                      }
                    />
                  </label>
                  <label className="switch-row inline">
                    <input
                      type="checkbox"
                      checked={generateAudio}
                      onChange={(event) => setGenerateAudio(event.target.checked)}
                    />
                    Generate local audio after writing the script
                  </label>
                  {generateAudio && (
                    <div className="form-grid three">
                      <label>
                        Speech engine
                        <select
                          value={ttsProvider}
                          onChange={(event) =>
                            setTtsProvider(
                              event.target.value as "kokoro" | "chatterbox",
                            )
                          }
                        >
                          <option value="kokoro">Kokoro</option>
                          <option value="chatterbox">Chatterbox</option>
                        </select>
                      </label>
                      <label>
                        Host A voice
                        <input
                          value={hostAVoice}
                          onChange={(event) => setHostAVoice(event.target.value)}
                        />
                      </label>
                      <label>
                        Host B voice
                        <input
                          value={hostBVoice}
                          onChange={(event) => setHostBVoice(event.target.value)}
                        />
                      </label>
                      <label>
                        Parallel audio jobs
                        <select
                          value={audioConcurrency}
                          onChange={(event) =>
                            setAudioConcurrency(Number(event.target.value))
                          }
                        >
                          <option value={1}>1, safest</option>
                          <option value={2}>2, faster</option>
                          <option value={3}>3, high-memory systems</option>
                        </select>
                      </label>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </section>

        <section className="panel">
          <div className="section-heading">
            <div>
              <span className="step">04</span>
              <h2>Connect Google Drive</h2>
            </div>
            <p>Documents are organized by municipality and meeting date.</p>
          </div>
          <div className="form-grid">
            <label>
              OAuth client ID
              <input
                value={settings.googleClientId}
                onChange={(event) =>
                  setSettings({ ...settings, googleClientId: event.target.value })
                }
              />
            </label>
            <label>
              OAuth client secret
              <input
                type="password"
                value={settings.googleClientSecret}
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    googleClientSecret: event.target.value,
                  })
                }
              />
            </label>
            <label className="span-two">
              Destination folder ID
              <input
                value={settings.googleDriveFolderId}
                placeholder="The ID from your Google Drive folder URL"
                onChange={(event) =>
                  setSettings({
                    ...settings,
                    googleDriveFolderId: event.target.value,
                  })
                }
              />
            </label>
          </div>
          <div className="button-row">
            <button className="secondary" onClick={saveConfiguration} disabled={saving}>
              {saving ? "Saving…" : "Save settings"}
            </button>
            <button onClick={connectGoogle}>
              {settings.googleConnected ? "Reconnect Google Drive" : "Connect Google Drive"}
            </button>
          </div>
        </section>

        <section className="launch">
          <div>
            <p className="eyebrow">Ready to collect</p>
            <h2>
              {selectedCount} municipalities, {dateFrom} to {dateTo}
            </h2>
          </div>
          <button
            className="run-button"
            disabled={running || !selectedCount || dateFrom > dateTo}
            onClick={run}
          >
            {running ? "Collecting documents…" : "Run collection"}
          </button>
        </section>

        {result && (
          <section className="panel result">
            <div>
              <p className="eyebrow">Run complete</p>
              <h2>{result.collected} new documents collected</h2>
              <p>
                {result.skippedDuplicates} duplicates skipped ·{" "}
                {result.failedSources.length} sources failed
              </p>
            </div>
            {(result.digestLocation || result.audioLocation) && (
              <div className="artifacts">
                {result.digestLocation && <span>Digest: {result.digestLocation}</span>}
                {result.audioLocation && <span>Audio: {result.audioLocation}</span>}
              </div>
            )}
            {result.warnings.map((warning) => (
              <div className="alert" key={warning}>
                {warning}
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  );
}
