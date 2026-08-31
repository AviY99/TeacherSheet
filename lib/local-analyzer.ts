"use client";

import mammoth from "mammoth";
import { fallbackAnalyze } from "./fallback-analyzer";
import type {
  AnalysisMetrics,
  AnalyzeResponse,
  DocumentLayoutBlock,
  LocalAnalysisCheckpoint
} from "./types";

type ProgressCallback = (message: string, progress?: number) => void;
type OcrSource = File | HTMLCanvasElement;

const PDF_WORKER_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.3.289/build/pdf.worker.min.mjs";
let paddlePromise: Promise<any> | null = null;

function now() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function isDocx(file: File) {
  return file.name.toLowerCase().endsWith(".docx") || file.type.includes("wordprocessingml");
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function pointPair(value: unknown): [number, number] | null {
  if (Array.isArray(value) && value.length >= 2) {
    const x = Number(value[0]);
    const y = Number(value[1]);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const x = Number(record.x);
    const y = Number(record.y);
    return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
  }
  return null;
}

function polygonBounds(poly: unknown, imageWidth: number, imageHeight: number) {
  let points: [number, number][] = [];
  if (Array.isArray(poly)) {
    if (poly.every((value) => typeof value === "number") && poly.length >= 8) {
      for (let index = 0; index + 1 < poly.length; index += 2) {
        points.push([Number(poly[index]), Number(poly[index + 1])]);
      }
    } else {
      points = poly.map(pointPair).filter((value): value is [number, number] => Boolean(value));
    }
  }
  if (!points.length) return { x: 0, y: 0, width: 1, height: 0.02 };
  const xs = points.map((point) => point[0]);
  const ys = points.map((point) => point[1]);
  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);
  const width = Math.max(1, imageWidth);
  const height = Math.max(1, imageHeight);
  return {
    x: Math.max(0, Math.min(1, left / width)),
    y: Math.max(0, Math.min(1, top / height)),
    width: Math.max(0, Math.min(1, (right - left) / width)),
    height: Math.max(0, Math.min(1, (bottom - top) / height))
  };
}

async function getPaddleOcr(onProgress?: ProgressCallback) {
  if (!paddlePromise) {
    paddlePromise = (async () => {
      onProgress?.("טוען OCR מהיר ב-Worker — בפעם הראשונה יורדים מודלים קטנים למכשיר", 0.08);
      const { PaddleOCR } = await import("@paddleocr/paddleocr-js");
      return PaddleOCR.create({
        lang: "en",
        ocrVersion: "PP-OCRv6",
        worker: true,
        textDetectionBatchSize: 1,
        textRecognitionBatchSize: 8,
        ortOptions: {
          backend: "wasm",
          numThreads: 1,
          simd: true
        }
      });
    })().catch((error) => {
      paddlePromise = null;
      throw error;
    });
  }
  return paddlePromise;
}

async function recognizeSources(sources: OcrSource[], onProgress?: ProgressCallback) {
  const started = now();
  const ocr = await getPaddleOcr(onProgress);
  onProgress?.("מזהה את כל אזורי הטקסט והשורות ברקע", 0.28);
  const results: any[] = await ocr.predict(sources, {
    textDetLimitSideLen: 1600,
    textDetLimitType: "max",
    textRecScoreThresh: 0.25
  });

  const texts: string[] = [];
  const blocks: DocumentLayoutBlock[] = [];
  let detectionMs = 0;
  let recognitionMs = 0;
  let ocrTotalMs = 0;

  results.forEach((result, pageIndex) => {
    const imageWidth = Number(result?.image?.width) || 1;
    const imageHeight = Number(result?.image?.height) || 1;
    const items = Array.isArray(result?.items) ? result.items : [];
    const pageBlocks: DocumentLayoutBlock[] = items
      .map((item: any): DocumentLayoutBlock | null => {
        const text = String(item?.text || "").replace(/\s+/g, " ").trim();
        if (!text) return null;
        const bounds = polygonBounds(item?.poly, imageWidth, imageHeight);
        return { page: pageIndex + 1, text, ...bounds };
      })
      .filter((value: DocumentLayoutBlock | null): value is DocumentLayoutBlock => Boolean(value))
      .sort((a: DocumentLayoutBlock, b: DocumentLayoutBlock) => a.y - b.y || a.x - b.x);

    blocks.push(...pageBlocks);
    texts.push(pageBlocks.map((block: DocumentLayoutBlock) => block.text).join("\n"));
    detectionMs = Math.max(detectionMs, Number(result?.metrics?.detMs) || 0);
    recognitionMs = Math.max(recognitionMs, Number(result?.metrics?.recMs) || 0);
    ocrTotalMs = Math.max(ocrTotalMs, Number(result?.metrics?.totalMs) || 0);
  });

  const elapsed = now() - started;
  onProgress?.(`נקראו ${blocks.length} שורות/אזורים — בונה מבנה`, 0.78);
  return {
    text: texts.filter(Boolean).join("\n\n").trim(),
    blocks: blocks.slice(0, 320),
    metrics: {
      totalMs: elapsed,
      extractionMs: elapsed,
      ocrDetectionMs: detectionMs,
      ocrRecognitionMs: recognitionMs,
      ocrTotalMs: ocrTotalMs || elapsed
    } satisfies AnalysisMetrics
  };
}

async function analyzePdf(file: File, onProgress?: ProgressCallback) {
  const started = now();
  const pdfjs: any = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = PDF_WORKER_URL;
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data }).promise;
  const textPages: string[] = [];

  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    onProgress?.(`קורא טקסט מ-PDF: עמוד ${pageNumber}/${pdf.numPages}`, pageNumber / pdf.numPages * 0.62);
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
    const elapsed = now() - started;
    return {
      text: extracted,
      blocks: [] as DocumentLayoutBlock[],
      engine: "pdf-text+local" as const,
      metrics: { totalMs: elapsed, extractionMs: elapsed } satisfies AnalysisMetrics
    };
  }

  onProgress?.("ה-PDF סרוק — מעביר את העמודים ל-OCR Worker", 0.1);
  const canvases: HTMLCanvasElement[] = [];
  const pageLimit = Math.min(pdf.numPages, 3);
  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const viewport = page.getViewport({ scale: 2.1 });
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
  resume?: LocalAnalysisCheckpoint | null;
  onProgress?: ProgressCallback;
  onCheckpoint?: (checkpoint: LocalAnalysisCheckpoint) => void | Promise<void>;
}): Promise<AnalyzeResponse> {
  const totalStarted = now();
  const typedText = input.text?.trim() || "";
  if (!input.file && !typedText && !input.resume) throw new Error("לא התקבל מקור לפענוח.");

  let ocrText = typedText;
  let layout: DocumentLayoutBlock[] = [];
  let engine: AnalyzeResponse["engine"] = "text+local";
  let metrics: AnalysisMetrics = { totalMs: 0 };

  if (input.resume?.ocrText) {
    input.onProgress?.("ממשיך מהשלב האחרון שנשמר — לא קורא שוב את הדף", 0.76);
    ocrText = input.resume.ocrText;
    layout = input.resume.layout || [];
    engine = input.resume.engine;
    metrics = { ...(input.resume.metrics || { totalMs: 0 }), resumed: true };
  } else if (input.file) {
    const file = input.file;
    if (isDocx(file)) {
      const started = now();
      input.onProgress?.("מחלץ טקסט מקובץ Word מקומית", 0.35);
      const arrayBuffer = await file.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer });
      ocrText = result.value.trim();
      engine = "docx+local";
      const elapsed = now() - started;
      metrics.totalMs = elapsed;
      metrics.extractionMs = elapsed;
    } else if (isPdf(file)) {
      const result = await analyzePdf(file, input.onProgress);
      ocrText = result.text;
      layout = result.blocks;
      engine = result.engine;
      metrics = { ...metrics, ...result.metrics };
    } else if (file.type.startsWith("image/")) {
      input.onProgress?.("Fast path: מפעיל PP-OCRv6 ב-Worker נפרד", 0.04);
      const result = await recognizeSources([file], input.onProgress);
      ocrText = result.text;
      layout = result.blocks;
      engine = "browser-paddleocr+local";
      metrics = { ...metrics, ...result.metrics };
    } else {
      throw new Error("פורמט הקובץ אינו נתמך בפענוח המקומי.");
    }

    if (ocrText) await input.onCheckpoint?.({ ocrText, layout, engine, metrics });
  }

  if (!ocrText) throw new Error("לא נמצא טקסט קריא במקור שהועלה.");

  input.onProgress?.("מזהה את סוג התרגיל ומסדר את השורות", 0.88);
  const structureStarted = now();
  let analysis = fallbackAnalyze(ocrText, layout);
  metrics.structureMs = now() - structureStarted;

  if (input.file?.type.startsWith("image/")) {
    const lineCount = layout.length || ocrText.split(/\n/).filter(Boolean).length;
    const completeness = lineCount >= Math.max(3, analysis.questionCount) ? 0.78 : 0.68;
    analysis = { ...analysis, confidence: Math.min(Math.max(analysis.confidence, lineCount >= 5 ? 0.72 : 0.62), completeness) };
  }

  metrics.totalMs = now() - totalStarted;
  input.onProgress?.("הפענוח המהיר הושלם", 1);

  return {
    ocrText,
    analysis,
    engine,
    metrics,
    warning: engine === "browser-paddleocr+local"
      ? "הדף נקרא במסלול מהיר: PP-OCRv6 רץ ב-Worker נפרד ושומר את השורות והמיקומים. אם המבנה עדיין לא מספיק בטוח, TeacherSheet יעביר את אותה תמונה ל-ChatGPT של המורה במקום להחזיק את הטלפון דקות על מודל Vision כבד."
      : "הפענוח מתבצע מקומית וללא API בתשלום. בתרגילים מורכבים מומלץ להשתמש ב-ChatGPT fallback כאשר הביטחון נמוך."
  };
}
