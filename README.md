# Lower Mainland Council Collector

A local web application that gathers official council agendas, minutes, reports, and meeting attachments from Metro Vancouver municipalities. It can save new documents to Google Drive, analyze them through OpenRouter, and optionally turn a two-host podcast script into local audio with Kokoro or Chatterbox.

## What it does

- Select municipalities and a `From` / `To` date range.
- Discover official meeting documents from each configured council portal.
- Skip URLs collected by earlier runs, including overlapping date ranges.
- Organize Google Drive uploads by municipality and meeting date.
- Extract text from PDF, DOCX, HTML, and plain-text files.
- Produce a regional digest, two-host podcast script, or custom output through OpenRouter.
- Configure podcast style, humor, profanity, energy, audience, and target length.
- Generate WAV audio locally with Kokoro or Chatterbox.
- Pipeline numbered podcast segments through text to speech while later OpenRouter segments are still being written, then combine them in order.

The source registry covers Metro Vancouver municipalities and Electoral Area A. Communities without a separate municipal council use their governing municipality, for example Fort Langley uses Township of Langley and South Surrey uses City of Surrey.

## Run locally

Requirements:

- Node.js 22
- npm
- Python 3.10 or later only if local audio generation is enabled

```bash
npm install
npx playwright install chromium
npm run dev
```

Open `http://localhost:5173`. The API listens on `http://localhost:8787`.

Data and credentials are written to `.data/`, which is excluded from Git.

## Desktop app

The same app runs as a standalone Electron window, with the collector service running inside it.

```bash
npm install
npx playwright install chromium
npm run desktop
```

To build an installer for the current operating system (`.dmg` on macOS, `.exe` on Windows, `.AppImage` on Linux):

```bash
npm run package:desktop
```

Installers are written to `release/`. Build each platform's installer on that platform. The desktop app stores settings, run history, downloads, and browser profiles in the operating system's app-data folder instead of `.data/`. Google sign-in opens in your default browser and returns to the app through `http://localhost:8787/api/google/callback`, so keep port 8787 free while the app is open.

## Google Drive setup

1. Create a Google Cloud project.
2. Enable the Google Drive API.
3. Configure an OAuth consent screen.
4. Create a Web application OAuth client.
5. Add `http://localhost:8787/api/google/callback` as an authorized redirect URI.
6. Paste the client ID and secret into the app.
7. Create the destination folder in Drive and paste its folder ID into the app.
8. Save settings, then select **Connect Google Drive**.

The app requests the narrow `drive.file` scope. It can manage files and folders it creates, rather than access every file in the account.

## OpenRouter

Enter an OpenRouter API key when running a collection. The key is sent directly to OpenRouter by the local backend and is not saved to disk.

The default model is `google/gemini-2.5-flash`, but any compatible OpenRouter model identifier can be entered in settings.

Long documents are summarized in chunks before municipality and regional outputs are created.

## Local text to speech

Audio generation is optional and runs after a script has been created.

### Kokoro

Create a virtual environment and install the Kokoro runtime:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-kokoro.txt
```

Use Kokoro voice IDs in the Host A and Host B fields, for example `af_heart` and `am_michael`.

### Chatterbox

Chatterbox is substantially heavier and benefits from a CUDA-capable GPU:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements-chatterbox.txt
```

For distinct Chatterbox hosts, enter paths to two local reference audio files in the voice fields. Leave them blank to use the default generated voice.

Podcast audio is rendered as numbered parts under `.data/generated/<run-id>/`. The app begins speech generation as soon as each script segment is returned, keeps OpenRouter and speech work moving concurrently, and concatenates the completed WAV parts in order. Keep audio concurrency at `1` for typical laptops or Chatterbox; use `2` or `3` only when the machine has sufficient RAM or GPU memory.

For portals protected by Cloudflare, enable browser-assisted access before a run. The app opens a visible local Chrome window with a persistent profile under `.data/browser-profiles/`, waits up to two minutes for any manual verification, and reuses the resulting cookies on later runs.

When using a virtual environment, start the Node app from the activated environment so `python3` resolves to that interpreter.

## Development checks

```bash
npm test
npm run typecheck
npm run build
npm audit
```

## Current portal limitations

Municipal meeting platforms vary. Some expose stable server-rendered lists, while others use JavaScript-only applications, bot protection, or changing vendor APIs. Each source includes platform and access notes in `source-registry.json`. A source failure is isolated to that municipality and reported at the end of the run.

The collector tries direct HTTP and vendor links first. It starts a headless Playwright browser only when a portal blocks direct requests or returns a JavaScript shell without document links.

Vancouver and West Vancouver sit behind Cloudflare and block cloud or datacenter IP addresses. Vancouver's meeting list loads through a local browser, and its agenda and minutes pages are then downloaded through that browser session. Both work best from a home connection with browser-assisted access enabled.

The collector only follows official municipal or official meeting-portal URLs.
