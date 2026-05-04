/**
 * OCR Service — orchestrates page-by-page analysis, diagram extraction, and Markdown output.
 *
 * LLM provider routing is handled by llmService.ts.
 * The OCR prompt lives in src/prompts/ocrPrompt.ts.
 * The diagram prompt lives in src/prompts/diagramPrompt.ts.
 *
 * processNotebookPages  — OCR + summary only (called during sync)
 * processNotebookDiagrams — on-demand diagram detection + Mermaid conversion
 */
import { Notice, normalizePath, TFile, App } from 'obsidian';
import { Buffer } from 'buffer';
import { LlmSettings, NotebookAnalysis } from '../types';
import { callLlm } from './llmService';
import { OCR_SYSTEM_PROMPT } from '../prompts/ocrPrompt';
import { SUMMARY_SYSTEM_PROMPT } from '../prompts/summaryPrompt';
import { DIAGRAM_SYSTEM_PROMPT } from '../prompts/diagramPrompt';

async function analyzeNotebookPage(
    imgBase64: string,
    llmSettings: LlmSettings,
    maxRetries: number = 3
): Promise<NotebookAnalysis> {
    const messages = [
        {
            role: "system" as const,
            content: OCR_SYSTEM_PROMPT,
        },
        {
            role: "user" as const,
            content: [
                { type: "image_url", image_url: { url: `data:image/png;base64,${imgBase64}` } }
            ]
        }
    ];

    const responseFormat = { type: "json_object" };
    const providerLabel = llmSettings.provider === 'github-copilot'
        ? `GitHub Copilot (${llmSettings.githubCopilot.githubCopilotModel || 'gpt-4o'})`
        : `Azure OpenAI (${llmSettings.azure.azureDeploymentName})`;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            console.debug(`[OCR] Using ${providerLabel}`);
            const content = await callLlm(messages, llmSettings, responseFormat);
            const parsed = JSON.parse(content) as NotebookAnalysis;

            if (typeof parsed.text !== 'string') {
                throw new Error('Invalid LLM response: missing or invalid "text" field');
            }
            if (!Array.isArray(parsed.crops)) {
                parsed.crops = [];
            }
            for (const crop of parsed.crops) {
                if (typeof crop.id !== 'string' || !Array.isArray(crop.box_2d) || crop.box_2d.length !== 4) {
                    throw new Error('Invalid LLM response: malformed crop entry');
                }
            }

            return parsed;

        } catch (error) {
            console.error(`[OCR] Page analysis failed (attempt ${attempt + 1}):`, error);
            if (attempt === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }

    throw new Error("Max retries reached");
}

/** Diagram-specific page analysis — asks only for crop bounding boxes, no text transcription. */
const DIAGRAM_DETECTION_PROMPT = `You are analysing a handwritten notebook page to locate diagrams.
Identify bounding boxes for any distinct sketches, diagrams, charts, or drawings on the page.
Use coordinates scaled 0–1000 (ymin, xmin, ymax, xmax). Do NOT include bounding boxes for text-only areas.
Return a JSON object:
{
  "text": "",
  "crops": [{"id": "IMG_1", "box_2d": [ymin, xmin, ymax, xmax]}, ...]
}
If there are no diagrams, return an empty crops array.`;

async function analyzeNotebookPageForDiagrams(
    imgBase64: string,
    llmSettings: LlmSettings,
    maxRetries: number = 3
): Promise<NotebookAnalysis> {
    const messages = [
        { role: 'system' as const, content: DIAGRAM_DETECTION_PROMPT },
        {
            role: 'user' as const,
            content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${imgBase64}` } }]
        }
    ];
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const content = await callLlm(messages, llmSettings, { type: 'json_object' });
            const parsed = JSON.parse(content) as NotebookAnalysis;
            if (!Array.isArray(parsed.crops)) parsed.crops = [];
            return { text: '', crops: parsed.crops };
        } catch (error) {
            console.error(`[Diagram] Page detection failed (attempt ${attempt + 1}):`, error);
            if (attempt === maxRetries - 1) throw error;
            await new Promise(resolve => setTimeout(resolve, 5000));
        }
    }
    throw new Error('Max retries reached');
}

async function analyzeDiagram(
    cropBase64: string,
    llmSettings: LlmSettings
): Promise<string | null> {
    const messages = [
        { role: 'system' as const, content: DIAGRAM_SYSTEM_PROMPT },
        {
            role: 'user' as const,
            content: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${cropBase64}` } }]
        }
    ];
    try {
        const raw = await callLlm(messages, llmSettings, { type: 'json_object' });
        const parsed = JSON.parse(raw) as { mermaid?: string };
        return typeof parsed.mermaid === 'string' ? parsed.mermaid.trim() : null;
    } catch (e) {
        console.warn('[OCR] Mermaid conversion failed:', e);
        return null;
    }
}

async function generateSummary(
    notebookText: string,
    fileName: string,
    llmSettings: LlmSettings
): Promise<string> {
    const messages = [
        { role: 'system' as const, content: SUMMARY_SYSTEM_PROMPT },
        { role: 'user' as const, content: `Notebook: ${fileName}\n\n${notebookText}` }
    ];
    return (await callLlm(messages, llmSettings)).trim();
}

/**
 * OCR pass: transcribes each page to Markdown and generates a summary.
 * No diagram detection — kept fast and reliable for sync.
 */
export async function processNotebookPages(
    app: App,
    imageB64List: string[],
    folderPath: string,
    fileName: string,
    llmSettings: LlmSettings
) {
    const dirPath = normalizePath(folderPath);
    if (!(await app.vault.adapter.exists(dirPath))) await app.vault.createFolder(dirPath);

    let fullMarkdown = "";
    const notice = new Notice(`Analyzing pages`, 0);

    for (let i = 0; i < imageB64List.length; i++) {
        const imgBase64 = imageB64List[i];
        if (!imgBase64) continue;
        try {
            const analysis: NotebookAnalysis = await analyzeNotebookPage(imgBase64, llmSettings);
            notice.setMessage(`Analyzing ${i + 1} out of ${imageB64List.length}`);

            // Strip any stray placeholders (safety net)
            const pageText = analysis.text.replace(/\{\{IMG_\d+\}\}/g, '').trim();
            if (pageText) {
                fullMarkdown += pageText + '\n\n---\n\n';
            }
        } catch (e) {
            new Notice(`Failed to process page ${i + 1}`);
            console.error(e);
        }
    }
    notice.hide();

    const mdFilePath = normalizePath(`${dirPath}/${fileName}.md`);
    const finalMarkdown = fullMarkdown.replace(/\n\n---\n\n$/, '').trim();
    await saveTextToVault(app, mdFilePath, finalMarkdown);

    if (finalMarkdown) {
        const summaryNotice = new Notice('Generating summary…', 0);
        try {
            const summary = await generateSummary(finalMarkdown, fileName, llmSettings);
            const summaryPath = normalizePath(`${dirPath}/Summary - ${fileName}.md`);
            await saveTextToVault(app, summaryPath, summary);
        } catch (e) {
            console.error('[OCR] Summary generation failed:', e);
            new Notice(`Summary failed for "${fileName}" — OCR notes were still saved.`);
        }
        summaryNotice.hide();
    }

    new Notice(`Finished! Notes saved to ${mdFilePath}`);
}

/**
 * Diagram pass: detects diagrams on each page, crops them, converts to Mermaid,
 * and saves numbered diagram files in a diagrams/ subfolder.
 * Only creates the diagrams/ folder if at least one diagram is found.
 * Run on-demand, independent of OCR sync.
 */
export async function processNotebookDiagrams(
    app: App,
    imageB64List: string[],
    folderPath: string,
    fileName: string,
    llmSettings: LlmSettings
) {
    const dirPath = normalizePath(folderPath);
    if (!(await app.vault.adapter.exists(dirPath))) await app.vault.createFolder(dirPath);

    // Collect all crops across all pages before writing anything
    const allCrops: Array<{ imgBase64: string; box: [number, number, number, number] }> = [];

    const notice = new Notice('Detecting diagrams…', 0);
    for (let i = 0; i < imageB64List.length; i++) {
        const imgBase64 = imageB64List[i];
        if (!imgBase64) continue;
        notice.setMessage(`Detecting diagrams — page ${i + 1} of ${imageB64List.length}`);
        try {
            const analysis: NotebookAnalysis = await analyzeNotebookPageForDiagrams(imgBase64, llmSettings);
            for (const crop of analysis.crops) {
                allCrops.push({ imgBase64, box: crop.box_2d });
            }
        } catch (e) {
            console.error(`[Diagram] Page ${i + 1} failed:`, e);
        }
    }

    if (allCrops.length === 0) {
        notice.hide();
        new Notice(`No diagrams detected in "${fileName}".`);
        return;
    }

    // Create diagrams/ folder only now that we have results
    const diagramsPath = normalizePath(`${dirPath}/diagrams`);
    if (!(await app.vault.adapter.exists(diagramsPath))) await app.vault.createFolder(diagramsPath);

    notice.setMessage(`Converting ${allCrops.length} diagram(s)…`);

    for (let idx = 0; idx < allCrops.length; idx++) {
        const crop = allCrops[idx];
        if (!crop) continue;
        const { imgBase64, box } = crop;
        const diagramNum = idx + 1;
        const imageFileName = `diagram${diagramNum}.png`;
        const imagePath = normalizePath(`${diagramsPath}/${imageFileName}`);

        const croppedBlob = await cropImage(imgBase64, box);
        const cropArrayBuffer = await croppedBlob.arrayBuffer();
        await saveBinaryToVault(app, imagePath, cropArrayBuffer);

        const cropBase64 = Buffer.from(cropArrayBuffer).toString('base64');
        const mermaid = await analyzeDiagram(cropBase64, llmSettings);

        let diagramContent = `# Diagram ${diagramNum}\n\n`;
        if (mermaid) {
            diagramContent += `\`\`\`mermaid\n${mermaid}\n\`\`\`\n\n`;
        }
        diagramContent += `![[diagrams/${imageFileName}]]`;

        await saveTextToVault(app, normalizePath(`${diagramsPath}/diagram${diagramNum}.md`), diagramContent);
    }

    notice.hide();
    new Notice(`Diagrams done — ${allCrops.length} diagram(s) saved in "${fileName}/diagrams".`);
}

async function cropImage(base64: string, box: [number, number, number, number]): Promise<Blob> {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');

            if (!ctx) return reject(new Error('Could not get canvas context'));

            // Convert 0-1000 scale to actual pixel dimensions, with 5% padding
            const padX = img.width * 0.05;
            const padY = img.height * 0.05;
            const ymin = Math.max(0, (box[0] / 1000) * img.height - padY);
            const xmin = Math.max(0, (box[1] / 1000) * img.width - padX);
            const ymax = Math.min(img.height, (box[2] / 1000) * img.height + padY);
            const xmax = Math.min(img.width, (box[3] / 1000) * img.width + padX);

            const width = xmax - xmin;
            const height = ymax - ymin;

            canvas.width = width;
            canvas.height = height;

            ctx.drawImage(img, xmin, ymin, width, height, 0, 0, width, height);

            canvas.toBlob((blob) => {
                if (blob) resolve(blob);
                else reject(new Error("Canvas to Blob failed"));
            }, 'image/png');
        };
        img.src = `data:image/png;base64,${base64}`;
    });
}

async function saveBinaryToVault(app: App, path: string, data: ArrayBuffer) {
    const existingFile = app.vault.getAbstractFileByPath(path);
    if (existingFile instanceof TFile) {
        await app.vault.modifyBinary(existingFile, data);
    } else {
        await app.vault.createBinary(path, data);
    }
}

async function saveTextToVault(app: App, path: string, content: string) {
    const existingFile = app.vault.getAbstractFileByPath(path);
    if (existingFile instanceof TFile) {
        await app.vault.process(existingFile, () => content);
    } else {
        await app.vault.create(path, content);
    }
}
