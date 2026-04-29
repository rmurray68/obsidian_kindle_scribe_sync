# Planning Log — Week 16 (Apr 18–20, 2026)

## Completed

### Release Pipeline
- Interactive release script (`scripts/release.sh`) — patch/minor/major bump, clobber update for existing releases
- GUI deployer (`scripts/deploy-gui.mjs`, `npm run deploy`) — native macOS folder picker, replaced BRAT/deploy_plugin.sh as primary method
- v0.4.2 published

### Diagram Detection — On-Demand Refactor
- **ocrPrompt.ts** — simplified to text-only transcription, no crop instructions
- **ocrService.ts** — split into:
  - `processNotebookPages()` — OCR + summary only (used by all sync paths)
  - `processNotebookDiagrams()` — on-demand diagram detection, crop, Mermaid conversion
- **useNotebook.ts** — added `extractDiagrams` to hook, `createDiagramTask` to job queue
- **FileView.tsx** — added GitBranch button per notebook for on-demand diagram extraction

### Diagram Output Structure
- `diagrams/` subfolder created only if at least one diagram is detected
- Files: `diagram1.md`, `diagram2.md` … each with Mermaid block + embedded PNG
- Images: `diagram1.png`, `diagram2.png` … stored alongside the .md files in `diagrams/`
- Sync (PDF + OCR) creates no extra folders — just `.md` and `Summary - .md`

## Next: Diagram Prompt Improvement
- Work on better bounding box detection by drawing explicit rectangles around diagrams on the Kindle Scribe
- Tune `diagramPrompt.ts` for specific diagram types (flowchart, sequence, ER)
- Evaluate GPT-4.1 vs Claude 3.5 Sonnet for Mermaid accuracy
