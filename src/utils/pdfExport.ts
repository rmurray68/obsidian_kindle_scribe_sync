import untar from 'js-untar';
import jsPDF from 'jspdf';
import { TFile, Notice, normalizePath, App } from 'obsidian';

/**
 * Resize a raw PNG Uint8Array to the given pixel dimensions and return a
 * JPEG data URL.  Uses OffscreenCanvas when available (workers / modern
 * Chromium), falls back to a regular <canvas> element for Obsidian's
 * Electron renderer.  Returns null if neither API is accessible.
 */
async function resizePngToJpegDataUrl(
    pngData: Uint8Array,
    targetW: number,
    targetH: number,
    quality = 0.85
): Promise<string | null> {
    try {
        // Decode the original PNG into a Blob then an ImageBitmap
        const blob = new Blob([pngData.slice()], { type: 'image/png' });
        const bitmap = await createImageBitmap(blob);

        // Prefer OffscreenCanvas (no DOM required)
        let ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
        let canvas: OffscreenCanvas | HTMLCanvasElement;

        if (typeof OffscreenCanvas !== 'undefined') {
            canvas = new OffscreenCanvas(targetW, targetH);
            ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D;
        } else {
            canvas = document.createElement('canvas');
            canvas.width = targetW;
            canvas.height = targetH;
            ctx = canvas.getContext('2d');
        }

        if (!ctx) return null;

        ctx.drawImage(bitmap, 0, 0, targetW, targetH);
        bitmap.close();

        if (canvas instanceof OffscreenCanvas) {
            const outBlob = await canvas.convertToBlob({
                type: 'image/jpeg',
                quality,
            });
            return new Promise((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(reader.result as string);
                reader.onerror = reject;
                reader.readAsDataURL(outBlob);
            });
        } else {
            return canvas.toDataURL('image/jpeg', quality);
        }
    } catch (err) {
        console.error('resizePngToJpegDataUrl failed:', err);
        return null;
    }
}

export const exportImagesFromTar = async (allTarBuffers: ArrayBuffer[]) => { 
    const allImages: { name: string, data: Uint8Array }[] = [];

    // 1. Extract images from all TAR chunks
    for (const buffer of allTarBuffers) {
        const currentImages: { name: string, data: Uint8Array }[] = [];
        const files = await untar(buffer);

        for (const file of files) {
            if (file.name.toLowerCase().endsWith(".png") && !file.name.includes("PaxHeaders")) {
                const uint8View = new Uint8Array(file.buffer);

                // Find PNG signature offset
                let offset = -1;
                for (let i = 0; i < Math.min(uint8View.length, 1024); i++) {
                    if (uint8View[i] === 0x89 && uint8View[i + 1] === 0x50 &&
                        uint8View[i + 2] === 0x4E && uint8View[i + 3] === 0x47) {
                        offset = i;
                        break;
                    }
                }

                if (offset !== -1) {
                    currentImages.push({
                        name: file.name,
                        data: uint8View.slice(offset)
                    });
                }
            }
        }
        currentImages.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
        allImages.push(...currentImages);
    }

    // 2. Sort ALL images globally (important since chunks might arrive out of order)
    return allImages;
}

export const convertTarToPdf = async (app: App, allTarBuffers: ArrayBuffer[], folderPath: string, noteName: string) => {
    try {
        const pdf = new jsPDF({
            orientation: "p",
            unit: "mm",
            format: "a4"
        });

        const allImages = await exportImagesFromTar(allTarBuffers);
        if (allImages.length === 0) {
            console.error("No images found in any of the notebook chunks.");
            return;
        }

        // 3. Add all images to the single PDF (downscale first to avoid OOM / string-length error)
        // A4 at 150 dpi → 1240×1754 px; plenty for notes, keeps jsPDF buffer manageable.
        const PDF_W_PX = 1240;
        const PDF_H_PX = 1754;

        for (let i = 0; i < allImages.length; i++) {
            const image = allImages[i];
            if (!image) continue;
            if (i > 0) pdf.addPage();

            const dataUrl = await resizePngToJpegDataUrl(image.data, PDF_W_PX, PDF_H_PX);
            if (!dataUrl) {
                console.warn(`Skipping page ${i + 1}: could not resize image`);
                continue;
            }
            pdf.addImage(dataUrl, 'JPEG', 0, 0, 210, 297);
        }

        // 4. Save the final result - use the provided folderPath
        void savePdfToVault(app, pdf, folderPath, noteName);

    } catch (error) {
        console.error("Master PDF conversion failed:", error);
    }
};


export async function savePdfToVault(app: App, pdf: jsPDF, folderPath: string, fileName: string) {
    // 1. Get ArrayBuffer directly from jsPDF
    const pdfBuffer: ArrayBuffer = pdf.output("arraybuffer");
    
    // 2. Normalize paths to handle cross-platform slashes
    const dirPath = normalizePath(folderPath);
    const filePath = normalizePath(`${dirPath}/${fileName}.pdf`);

    // 3. Ensure the folder exists
    if (!(await app.vault.adapter.exists(dirPath))) {
        await app.vault.createFolder(dirPath);
    }

    const existingFile = app.vault.getAbstractFileByPath(filePath);

    if (existingFile instanceof TFile) {
        // Update existing binary file
        await app.vault.modifyBinary(existingFile, pdfBuffer);
        new Notice(`Updated PDF: ${existingFile.name}`);
    } else {
        // Create new binary file
        await app.vault.createBinary(filePath, pdfBuffer);
        new Notice(`Saved PDF to: ${filePath}`);
    }
}