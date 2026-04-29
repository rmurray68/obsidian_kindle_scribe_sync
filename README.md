# Kindle Scribe Notes Sync

Private fork of the [Kindle Scribe Notes Sync plugin](https://github.com/k4rnaj1k/obsidian-kindle-scribe-sync) for Obsidian.

## Features

- **Download** Kindle Scribe notebooks as PDF files
- **OCR Processing** via LLM vision models to convert handwritten notes to Markdown
- **AI Summary** — after OCR, generates a structured `Summary - {Notebook Name}.md` (summary, key focus areas, actions, people)
- **On-Demand Diagram Detection** — per-notebook button to detect, crop, and convert diagrams to Mermaid
- **Folder Structure Sync** — mirrors your Kindle folder organisation in Obsidian
- **Delta Sync** — only re-syncs notebooks that have changed since the last run
- **Force Sync All** — full batch re-sync with progress modal and cancel support
- **Orphan Detection** — flags notebooks that have been deleted from your Kindle
- **Multiple LLM providers** — GitHub Copilot or Azure OpenAI

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Obsidian Plugin                         │
├─────────────────────────────────────────────────────────────┤
│  Settings UI          Main View          File View          │
│  (LLM config)         (Login/List)       (Download/Process) │
└──────────┬─────────────────┬─────────────────┬──────────────┘
           │                 │                 │
           ▼                 ▼                 ▼
┌──────────────────┐ ┌───────────────┐ ┌──────────────────────┐
│  data.json       │ │ Amazon API    │ │ GitHub Copilot  OR   │
│  (plugin data)   │ │ (notebooks)   │ │ Azure OpenAI (OCR)   │
└──────────────────┘ └───────────────┘ └──────────────────────┘
```

### Data Flow

1. **Authentication**: Plugin uses browser cookies to authenticate with Amazon's Kindle Notebook API
2. **Delta Check**: Compares local sync state against Amazon's `modificationTime` — skips unchanged notebooks
3. **Download**: Fetches notebook pages as images, bundles into PDF
4. **OCR**: Sends each page to the configured LLM — text transcription only
5. **Summary**: Calls the LLM a second time to generate a structured summary of the full transcript
6. **Output**: Saves `{notebook}.md` and `Summary - {notebook}.md` to your vault
7. **Diagrams** _(on-demand)_: Per-notebook button re-fetches pages, detects diagram regions, crops them, attempts Mermaid conversion, saves to a `diagrams/` subfolder

## Prerequisites

- **Obsidian** (Desktop only — requires Electron for Amazon cookie access)
- **Amazon Account** with Kindle Scribe notes
- **LLM Provider** — one of:
  - GitHub Copilot — recommended, no API key needed
  - Azure OpenAI deployment with a vision-capable model (e.g., GPT-4o)

## Installation

### 1. Clone and install

```bash
git clone <your-repo-url>
cd obsidian_kindle_scribe_plugin
npm install
```

### 2. Deploy

```bash
npm run deploy
```

This builds the plugin and opens a native macOS folder picker. Select your Obsidian vault root folder and the script will:
- Create `.obsidian/plugins/rm-kindle-scribe-notes-sync/` if it doesn't exist
- Copy `main.js`, `manifest.json`, and `styles.css` into it
- Show a confirmation dialog when done

Run `npm run deploy` again any time you pull updates.

### 3. Enable in Obsidian

Settings → Community Plugins → Enable "Kindle Scribe Notes Sync"

## Configuration

Go to **Settings → Kindle Scribe Notes Sync**.

### LLM Provider

Select your provider from the dropdown at the top of the settings page.

---

#### GitHub Copilot — Recommended

No API key required. Uses your existing GitHub Enterprise login via OAuth device flow.

1. Set **GitHub Base URL** — leave as `https://github.com` for GitHub Enterprise Cloud, or change to your Enterprise Server hostname
2. Click **Connect with GitHub**
3. A modal shows a one-time code — click **Open in Browser**, go to `github.com/login/device`, enter the code
4. GitHub handles SAML/SSO automatically
5. Choose your **Model**:

| Model | Notes |
|-------|-------|
| GPT-4.1 | Best for OCR accuracy |
| GPT-4o | Good balance |
| GPT-4o Mini | Faster, lower cost |
| o1-mini | Reasoning model |
| Claude 3.5 Sonnet | Anthropic alternative |
| Gemini 1.5 Pro | Google alternative |

---

#### Azure OpenAI

| Setting | Description | Example |
|---------|-------------|---------|
| **API Key** | Your Azure OpenAI API key | `abc123...` |
| **Base URL** | Azure OpenAI endpoint | `https://your-resource.openai.azure.com` |
| **Deployment Name** | Your model deployment name | `gpt-4o` |
| **API Version** | Azure API version | `2024-02-15-preview` |

---

## Usage

1. Click the **notebook icon** in the left ribbon
2. Login to Amazon when prompted (uses your browser's Amazon cookies)
3. Browse your notebooks organised by Kindle folder

### Per-Notebook Actions

Each notebook row has three action buttons:

| Button | Action |
|--------|--------|
| `↓` | Download PDF only |
| `↓ + 🤖` | Download PDF + run OCR and summary |
| `⎇` | Extract diagrams (on-demand, requires LLM) |

The diagram button scans all pages, detects diagram regions, crops them, attempts Mermaid conversion, and saves results to a `diagrams/` subfolder. If no diagrams are found, no folder is created.

### Sync Buttons

Two rows of batch sync controls appear at the top of the notebook list:

| Button | Action |
|--------|--------|
| **Sync Changed → PDF Only** | Delta sync — downloads only notebooks changed since last sync |
| **Sync Changed → PDF + OCR** | Delta sync with OCR — transcribes changed notebooks to Markdown + summary |
| **Force All → PDF Only** | Force re-downloads every notebook as PDF |
| **Force All → PDF + OCR** | Force re-downloads and re-OCRs every notebook |

- Checks local sync state first (no network call for clearly unchanged notebooks)
- Queries Amazon's `modificationTime` for notebooks that may have changed
- Rate-limited to avoid Amazon API throttling (1.5s between checks)
- Retries with exponential backoff if Amazon returns 400/429
- At end of batch: scans for notebooks deleted from your Kindle and places a `_removed_from_kindle.md` marker in their vault folder

### Progress Modal

During any batch sync:
- Shows per-notebook status (queued / running / completed / failed / skipped)
- Summary line: `X/Y synced • Z unchanged • N failed`
- **Cancel Sync** — stops queued jobs
- **Run in Background** — dismisses modal, jobs keep running

### Output Structure

```
Kindle Scribe Notes/
├── .sync-state.json              # Delta sync metadata (do not edit)
├── <Kindle Folder>/
│   └── <Notebook Name>/
│       ├── <notebook-name>.pdf
│       ├── <notebook-name>.md         # Full OCR transcript
│       ├── Summary - <notebook-name>.md  # AI-generated summary
│       └── diagrams/                  # Created only if diagram extraction is run
│           ├── diagram1.md            # Mermaid block + cropped image
│           ├── diagram1.png
│           ├── diagram2.md
│           └── diagram2.png
└── <Root Notebook>/
    ├── <notebook-name>.pdf
    └── ...
```

The summary file contains four sections:

| Section | Contents |
|---------|----------|
| **Summary** | One-paragraph overview of the notes |
| **Key Focus Areas** | Main topics and themes |
| **Actions** | Tasks, to-dos, and follow-ups (if any) |
| **People & Actors** | Names, teams, orgs mentioned (if any) |

To customise the summary format, edit `src/prompts/summaryPrompt.ts` and rebuild.
To customise diagram detection or Mermaid conversion, edit `src/prompts/diagramPrompt.ts` and rebuild.

Notebooks removed from the Kindle get a marker file:
```
Kindle Scribe Notes/
└── <Notebook Name>/
    └── _removed_from_kindle.md   # Flagged for review
```

## Project Structure

```
├── src/
│   ├── index.ts                    # Plugin entry point
│   ├── settings.ts                 # Settings UI (provider selector, Azure, Copilot)
│   ├── prompts/
│   │   ├── ocrPrompt.ts            # LLM prompt for OCR text transcription
│   │   ├── summaryPrompt.ts        # LLM prompt for summary generation
│   │   └── diagramPrompt.ts        # LLM prompt for Mermaid diagram conversion
│   ├── components/
│   │   ├── FileView.tsx            # Notebook list with per-notebook download actions
│   │   ├── LoadingComponent.tsx
│   │   ├── ReactWrapper.tsx        # Modal wrapper
│   │   └── SyncProgressModal.tsx   # Batch sync progress UI
│   ├── context/
│   │   └── SettingsContext.tsx     # LlmSettings React context
│   ├── hooks/
│   │   └── useNotebook.ts          # Download/process tasks, sync orchestration
│   ├── services/
│   │   ├── amazonService.ts        # Amazon Kindle API, auth, retry logic
│   │   ├── githubCopilotService.ts # GitHub OAuth device flow + session token (auth only)
│   │   ├── llmService.ts           # Unified callLlm() — routes to Copilot or Azure
│   │   ├── ocrService.ts           # OCR + summary (sync) and diagram extraction (on-demand)
│   │   └── syncStateService.ts     # Delta sync state (.sync-state.json)
│   ├── types/
│   │   └── index.ts                # Shared TypeScript types
│   ├── utils/
│   │   ├── fileUtils.ts            # File path sanitisation
│   │   ├── jobManager.ts           # Background job queue (concurrency, cancel, skip)
│   │   ├── pdfExport.ts            # PDF generation from tar pages
│   │   └── queryClient.ts          # React Query client
│   └── views/
│       ├── MainView.tsx            # Main plugin view
│       └── NoCookiesView.tsx       # Login prompt
├── scripts/
│   ├── deploy-gui.mjs              # GUI deployer (npm run deploy) — macOS folder picker
│   ├── deploy_plugin.sh            # Legacy shell deployer (prompts for path)
│   └── release.sh                  # Interactive release script (patch/minor/major)
├── manifest.json
├── package.json
└── tsconfig.json
```

## Development

```bash
# Build in watch mode
npm run dev

# Lint
npm run lint

# Production build
npm run build

# Build and deploy to a vault (opens folder picker)
npm run deploy
```

## License

[MIT](LICENSE)

---

**Original plugin by [k4rnaj1k](https://github.com/k4rnaj1k)**
