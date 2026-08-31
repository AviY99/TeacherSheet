import mammoth from "mammoth";
import { processWithDocumentAI } from "./document-ai";
import { analyzeWithOpenAI, openAIConfigured } from "./openai-analyzer";
import { fallbackAnalyze } from "./fallback-analyzer";
import type { AnalyzeResponse, DocumentLayoutBlock } from "./types";

function isDocx(name: string, mime: string) {
  return name.toLowerCase().endsWith(".docx") || mime.includes("wordprocessingml");
}

function isImage(mime: string) {
  return mime.startsWith("image/");
}

export async function analyzeInput(input: { file?: File; text?: string }): Promise<AnalyzeResponse> {
  let ocrText = input.text?.trim() || "";
  let layout: DocumentLayoutBlock[] = [];
  let imageDataUrl: string | undefined;
  let usedGoogle = false;

  if (input.file) {
    const file = input.file;
    const buffer = Buffer.from(await file.arrayBuffer());
    const mime = file.type || "application/octet-stream";

    if (isDocx(file.name, mime)) {
      const result = await mammoth.extractRawText({ buffer });
      ocrText = result.value.trim();
    } else {
      const parsed = await processWithDocumentAI(buffer, mime);
      ocrText = parsed.text;
      layout = parsed.blocks;
      usedGoogle = true;
      if (isImage(mime)) imageDataUrl = `data:${mime};base64,${buffer.toString("base64")}`;
    }
  }

  if (!ocrText) throw new Error("No readable text was found in the exercise source.");

  if (openAIConfigured()) {
    const analysis = await analyzeWithOpenAI({ ocrText, layout, imageDataUrl });
    return { ocrText, analysis, engine: usedGoogle ? "google+openai" : "text+openai" };
  }

  return {
    ocrText,
    analysis: fallbackAnalyze(ocrText),
    engine: usedGoogle ? "google+fallback" : "text+fallback",
    warning: "OPENAI_API_KEY is not configured, so a local heuristic analyzer was used."
  };
}
