"use client";

import { fallbackAnalyze } from "./fallback-analyzer";
import type { DocumentLayoutBlock, ExerciseAnalysis } from "./types";

const MODEL_ID = "onnx-community/granite-docling-258M-ONNX";
const LOC_SCALE = 500;

type ProgressCallback = (message: string, progress?: number) => void;
type DoclingEngine = { processor: any; model: any; RawImage: any };

let enginePromise: Promise<DoclingEngine> | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function cleanElementText(value: string) {
  return value
    .replace(/<loc_\d+>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseDocTags(doctags: string) {
  const blocks: DocumentLayoutBlock[] = [];
  const lines: string[] = [];
  const elementPattern = /<([a-z0-9_]+)>\s*<loc_(\d+)>\s*<loc_(\d+)>\s*<loc_(\d+)>\s*<loc_(\d+)>([\s\S]*?)<\/\1>/gi;

  let match: RegExpExecArray | null;
  while ((match = elementPattern.exec(doctags))) {
    const tag = match[1].toLowerCase();
    const text = cleanElementText(match[6]);
    if (!text) continue;

    // Purely graphical regions do not help worksheet structure unless they contain readable text.
    if (["picture", "figure"].includes(tag)) continue;

    const left = Number(match[2]);
    const top = Number(match[3]);
    const right = Number(match[4]);
    const bottom = Number(match[5]);

    lines.push(text);
    blocks.push({
      page: 1,
      text,
      x: clamp(left / LOC_SCALE, 0, 1),
      y: clamp(top / LOC_SCALE, 0, 1),
      width: clamp((right - left) / LOC_SCALE, 0, 1),
      height: clamp((bottom - top) / LOC_SCALE, 0, 1)
    });
  }

  if (!lines.length) {
    const plain = doctags
      .replace(/<loc_\d+>/gi, "")
      .replace(/<\/(?:text|page_header|page_footer|section_header[^>]*|list_item|caption|formula|code)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    lines.push(...plain);
  }

  return {
    text: lines.join("\n").trim(),
    blocks: blocks.slice(0, 300)
  };
}

async function loadEngine(onProgress?: ProgressCallback): Promise<DoclingEngine> {
  if (!enginePromise) {
    enginePromise = (async () => {
      onProgress?.("טוען מנוע מסמכים חכם למכשיר — ההפעלה הראשונה עשויה לקחת זמן", 0.08);
      const hf: any = await import("@huggingface/transformers");
      const processor = await hf.AutoProcessor.from_pretrained(MODEL_ID);
      onProgress?.("טוען את מודל Granite-Docling המקומי", 0.18);
      const model = await hf.AutoModelForVision2Seq.from_pretrained(MODEL_ID, {
        device: "webgpu",
        dtype: "q4"
      });
      return { processor, model, RawImage: hf.RawImage };
    })().catch((error) => {
      enginePromise = null;
      throw error;
    });
  }
  return enginePromise;
}

export function localVisionSupported() {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function analyzeWithLocalVision(input: {
  image: File | Blob;
  ocrText?: string;
  onProgress?: ProgressCallback;
}): Promise<{ analysis: ExerciseAnalysis; documentText: string; layout: DocumentLayoutBlock[] }> {
  if (!localVisionSupported()) throw new Error("WebGPU is not available on this device/browser.");

  const { processor, model, RawImage } = await loadEngine(input.onProgress);
  input.onProgress?.("Granite-Docling קורא את התמונה ואת מבנה העמוד", 0.35);

  const image = await RawImage.fromBlob(input.image);
  const messages = [
    {
      role: "user",
      content: [
        { type: "image" },
        { type: "text", text: "Convert this page to docling." }
      ]
    }
  ];

  const prompt = processor.apply_chat_template(messages, { add_generation_prompt: true });
  const inputs = await processor(prompt, [image], {
    do_image_splitting: true
  });

  input.onProgress?.("הבינה המקומית משחזרת את כל רכיבי הדף", 0.55);
  const generatedIds = await model.generate({
    ...inputs,
    max_new_tokens: 4096,
    do_sample: false
  });

  const decoded = processor.batch_decode(generatedIds, {
    skip_special_tokens: false
  })?.[0] || "";

  const docStart = decoded.indexOf("<doctag>");
  const rawDocTags = docStart >= 0 ? decoded.slice(docStart) : decoded;
  const parsed = parseDocTags(rawDocTags);
  if (parsed.text.length < 20) throw new Error("Granite-Docling returned too little readable document text.");

  input.onProgress?.("מזהה את סוג התרגיל מתוך המסמך ששוחזר", 0.9);
  const baseline = fallbackAnalyze(parsed.text, parsed.blocks);
  const recoveredRows = Math.max(baseline.questions.length, parsed.blocks.filter((block) => /\d+[.)]|_{2,}|\.{4,}|\?$/.test(block.text)).length);
  const analysis: ExerciseAnalysis = {
    ...baseline,
    confidence: clamp(Math.max(baseline.confidence, recoveredRows >= 3 ? 0.76 : 0.68), 0, 0.88),
    layoutNotes: [
      "Granite-Docling reconstructed the worksheet directly from the uploaded image.",
      `Document vision recovered ${parsed.blocks.length || parsed.text.split(/\n/).length} ordered page elements.`,
      ...baseline.layoutNotes
    ].slice(0, 8)
  };

  input.onProgress?.("מבנה הדף שוחזר", 1);
  return { analysis, documentText: parsed.text, layout: parsed.blocks };
}
