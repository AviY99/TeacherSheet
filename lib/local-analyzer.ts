"use client";

import mammoth from "mammoth";
import { fallbackAnalyze } from "./fallback-analyzer";
import { analyzeWithLocalVision, localVisionSupported } from "./local-vision-analyzer";
import type { AnalyzeResponse, DocumentLayoutBlock, ExerciseAnalysis } from "./types";

type ProgressCallback = (message: string, progress?: number) => void;
type OcrSource = File | HTMLCanvasElement;

const PDF_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs";

function isDocx(file: File) {
  return file.name.toLowerCase().endsWith(".docx") || file.type.includes("wordprocessingml");
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function parseTsvToLines(tsv: string): DocumentLayoutBlock[] {
  const rows = tsv.split(/\r?\n/).slice(1);
  const groups = new Map<string, { page: number; words: string[]; left: number; top: number; right: number; bottom: number }>();
  let maxRight = 1;
  let maxBottom = 1;

  for (const row of rows) {
    if (!row.trim()) continue;
    const cols = row.split("\t");
    if (cols.length < 12 || cols[0] !== "5") continue;
    const page = Number(cols[1] || 1);
    const block = cols[2] || "0";
    const paragraph = cols[3] || "0";
    const line = cols[4] || "0";
    const left = Number(cols[6] || 0);
    const top = Number(cols[7] || 0);
    const width = Number(cols[8] || 0);
    const height = Number(cols[9] || 0);
    const word = (cols[11] || "").trim();
    if (!word) continue;

    const right = left + width;
    const bottom = top + height;
    maxRight = Math.max(maxRight, right);
    maxBottom = Math.max(maxBottom, bottom);
    const key = `${page}:${block}:${paragraph}:${line}`;
    const current = groups.get(key);
    if (current) {
      current.words.push(word);
      current.left = Math.min(current.left, left);
      current.top = Math.min(current.top, top);
      current.right = Math.max(current.right, right);
      current.bottom = Math.max(current.bottom, bottom);
    } else {
      groups.set(key, { page, words: [word], left, top, right, bottom });
    }
  }

  return [...groups.values()]
    .sort((a, b) => a.page - b.page || a.top - b.top || a.left - b.left)
    .slice(0, 240)
    .map((line) => ({
      page: line.page,
      text: line.words.join(" "),
      x: line.left / maxRight,
      y: line.top / maxBottom,
      width: (line.right - line.left) / maxRight,
      height: (line.bottom - line.top) / maxBottom
    }));
}

async function recognizeSources(sources: OcrSource[], onProgress?: ProgressCallback) {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (message: { status?: string; progress?: number }) => {
      if (!message.status) return;
      onProgress?.(`OCR fallback: ${message.status}`, typeof message.progress === "number" ? message.progress * 0.7 : undefined);
    }
  });

  const texts: string[] = [];
  const blocks: DocumentLayoutBlock[] = [];
  try {
    for (let index = 0; index < sources.length; index += 1) {
      onProgress?.(`OCR fallback: עמוד ${index + 1} מתוך ${sources.length}`, 0.08 + index / Math.max(1, sources.length) * 0.5);
      const result: any = await worker.recognize(
        sources[index],
        { rotateAuto: true },
        { text: true, tsv: true }
      );
      const text = String(result?.data?.text || "").trim();
      if (text) texts.push(text);
      const pageBlocks = parseTsvToLines(String(result?.data?.tsv || ""));
      blocks.push(...pageBlocks.map((block) => ({ ...block, page: index + 1 })));
    }
  } finally {
    await worker.terminate();
  }

  return { text: texts.join("\n\n").trim(), blocks: blocks.slice(0, 240) };
}

async function analyzePdf(file: File, onProgress?: ProgressCallback) {
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const textPages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(`קורא טקסט מ-PDF: עמוד ${pageNumber}/${pdf.numPages}`, pageNumber / pdf.numPages * 0.7);
    const page = await pdf.getPage(pageNumber);
    const content = await page.getTextContent();
    const parts: string[] = [];
    for (const item of content.items || []) {
      if (typeof item?.str !== "string") continue;
      parts.push(item.str);
      if (item.hasEOL) parts.push("\n");
    }
    textPages.push(parts.join(" ").replace(/\s*\n\s*/g, "\n").replace(/[ \t]+/g, " ").trim());
  }

  const extracted = textPages.filter(Boolean).join("\n\n").trim();
  if (extracted.length >= 40) {
    return { text: extracted, blocks: [] as DocumentLayoutBlock[], engine: "pdf-text+local" as const };
  }

  onProgress?.("ה-PDF נראה סרוק — מפעיל OCR מקומי", 0.12);
  const canvases: HTMLCanvasElement[] = [];
  const pageLimit = Math.min(pdf.numPages, 3);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.4 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Cannot render PDF page for local OCR.");
    await page.render({ canvasContext: context, viewport }).promise;
    canvases.push(canvas);
  }

  const ocr = await recognizeSources(canvases, onProgress);
  return { ...ocr, engine: "pdf-ocr+local" as const };
}

export async function analyzeLocally(input: {
  file?: File | null;
  text?: string;
  onProgress?: ProgressCallback;
}): Promise<AnalyzeResponse> {
  const typedText = input.text?.trim() || "";
  if (!input.file && !typedText) throw new Error("לא התקבל מקור לפענוח.");

  let ocrText = typedText;
  let layout: DocumentLayoutBlock[] = [];
  let engine: AnalyzeResponse["engine"] = "text+local";
  let visionAnalysis: ExerciseAnalysis | null = null;
  let visionFailure = "";
  let visionBackend: "webgpu" | "wasm" | "" = "";

  if (input.file) {
    const file = input.file;
    if (isDocx(file)) {
      input.onProgress?.("מחלץ טקסט מקובץ Word מקומית", 0.35);
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      ocrText = result.value.trim();
      engine = "docx+local";
    } else if (isPdf(file)) {
      const result = await analyzePdf(file, input.onProgress);
      ocrText = result.text;
      layout = result.blocks;
      engine = result.engine;
    } else if (file.type.startsWith("image/")) {
      if (localVisionSupported()) {
        try {
          input.onProgress?.("מפעיל בינה חזותית ייעודית למסמכים", 0.04);
          const vision = await analyzeWithLocalVision({ image: file, onProgress: input.onProgress });
          visionAnalysis = vision.analysis;
          ocrText = vision.documentText;
          layout = vision.layout;
          visionBackend = vision.backend;
          engine = vision.backend === "webgpu"
            ? "browser-docling-webgpu+local"
            : "browser-docling-wasm+local";
        } catch (error) {
          visionFailure = error instanceof Error ? error.message : "Document vision failed";
        }
      } else {
        visionFailure = "Local document vision is unavailable in this browser context.";
      }

      if (!visionAnalysis) {
        input.onProgress?.("מנוע המסמכים לא הצליח — עובר ל-OCR בסיסי כגיבוי", 0.08);
        const result = await recognizeSources([file], input.onProgress);
        ocrText = result.text;
        layout = result.blocks;
        engine = "browser-ocr+local";
      }
    } else {
      throw new Error("פורמט הקובץ אינו נתמך בפענוח המקומי.");
    }
  }

  if (!ocrText && !visionAnalysis) throw new Error("לא נמצא טקסט קריא במקור שהועלה.");
  input.onProgress?.("בונה מודל מבני של התרגיל", 1);

  let analysis = visionAnalysis || fallbackAnalyze(ocrText, layout);
  if (!visionAnalysis && input.file?.type.startsWith("image/")) {
    analysis = { ...analysis, confidence: Math.min(analysis.confidence, 0.62) };
  }

  return {
    ocrText,
    analysis,
    engine,
    warning: visionAnalysis
      ? `התמונה שוחזרה באמצעות Granite-Docling על ${visionBackend === "webgpu" ? "WebGPU" : "CPU/WASM"}. זהו מודל Vision ייעודי למסמכים; OCR רגיל אינו המנוע הראשי.`
      : visionFailure
        ? `מנוע המסמכים החכם לא הצליח (${visionFailure}). עברנו ל-OCR בסיסי רק כגיבוי, ולכן מומלץ להשתמש ב-ChatGPT אם המבנה אינו מדויק.`
        : "הפענוח מתבצע כולו במכשיר ללא API בתשלום. בתרגילים מורכבים מומלץ לבדוק ולתקן את הזיהוי במסך הבא."
  };
}
