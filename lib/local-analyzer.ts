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
      onProgress?.(`OCR עזר: ${message.status}`, typeof message.progress === "number" ? message.progress * 0.58 : undefined);
    }
  });

  const texts: string[] = [];
  const blocks: DocumentLayoutBlock[] = [];
  try {
    for (let index = 0; index < sources.length; index += 1) {
      onProgress?.(`קורא טקסט עזר מעמוד ${index + 1} מתוך ${sources.length}`, 0.05 + index / Math.max(1, sources.length) * 0.45);
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
      input.onProgress?.("שלב 1/2: קורא טקסט עזר מהתמונה", 0.04);
      const result = await recognizeSources([file], input.onProgress);
      ocrText = result.text;
      layout = result.blocks;

      if (localVisionSupported()) {
        try {
          input.onProgress?.("שלב 2/2: הבינה החזותית קוראת את הדף עצמו", 0.65);
          visionAnalysis = await analyzeWithLocalVision({ image: file, ocrText, onProgress: input.onProgress });
          engine = "browser-ocr+vision-local";
        } catch (error) {
          visionFailure = error instanceof Error ? error.message : "Local vision failed";
          engine = "browser-ocr+local";
        }
      } else {
        visionFailure = "WebGPU is unavailable on this browser/device.";
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
    analysis = { ...analysis, confidence: Math.min(analysis.confidence, 0.68) };
  }

  return {
    ocrText,
    analysis,
    engine,
    warning: visionAnalysis
      ? "הפענוח בוצע באמצעות מודל Vision מקומי שרואה את התמונה עצמה; OCR משמש רק כמידע עזר."
      : visionFailure
        ? `מנוע ה-Vision המקומי לא היה זמין (${visionFailure}). השתמשנו בזיהוי המקומי הבסיסי ולכן מומלץ להעביר ל-ChatGPT אם המבנה אינו מדויק.`
        : "הפענוח מתבצע כולו במכשיר ללא API בתשלום. בתרגילים מורכבים מומלץ לבדוק ולתקן את הזיהוי במסך הבא."
  };
}
