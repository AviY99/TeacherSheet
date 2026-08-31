"use client";

import { fallbackAnalyze } from "./fallback-analyzer";
import { detectRuntimeCapabilities, visionBackendPlan } from "./runtime-capabilities";
import type { VisionBackend } from "./runtime-capabilities";
import type { DocumentLayoutBlock, ExerciseAnalysis } from "./types";

const MODEL_ID = "onnx-community/granite-docling-258M-ONNX";
const LOC_SCALE = 500;

type ProgressCallback = (message: string, progress?: number) => void;
type DoclingEngine = { processor: any; model: any; RawImage: any; backend: VisionBackend };

let processorPromise: Promise<{ processor: any; RawImage: any }> | null = null;
const modelPromises: Partial<Record<VisionBackend, Promise<any>>> = {};

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

async function loadProcessor(onProgress?: ProgressCallback) {
  if (!processorPromise) {
    processorPromise = (async () => {
      onProgress?.("טוען מעבד מסמכים מקומי", 0.08);
      const hf: any = await import("@huggingface/transformers");
      const processor = await hf.AutoProcessor.from_pretrained(MODEL_ID);
      return { processor, RawImage: hf.RawImage };
    })().catch((error) => {
      processorPromise = null;
      throw error;
    });
  }
  return processorPromise;
}

async function loadModel(backend: VisionBackend, onProgress?: ProgressCallback) {
  if (!modelPromises[backend]) {
    modelPromises[backend] = (async () => {
      const hf: any = await import("@huggingface/transformers");
      onProgress?.(
        backend === "webgpu"
          ? "טוען Granite-Docling עם האצת GPU"
          : "טוען Granite-Docling על WebAssembly/CPU",
        backend === "webgpu" ? 0.16 : 0.14
      );
      return hf.AutoModelForVision2Seq.from_pretrained(MODEL_ID, {
        device: backend,
        dtype: "q4"
      });
    })().catch((error) => {
      delete modelPromises[backend];
      throw error;
    });
  }
  return modelPromises[backend]!;
}

async function loadEngine(backend: VisionBackend, onProgress?: ProgressCallback): Promise<DoclingEngine> {
  const [{ processor, RawImage }, model] = await Promise.all([
    loadProcessor(onProgress),
    loadModel(backend, onProgress)
  ]);
  return { processor, model, RawImage, backend };
}

export function localVisionSupported() {
  return typeof window !== "undefined" && typeof WebAssembly !== "undefined";
}

async function runDocling(input: {
  image: File | Blob;
  backend: VisionBackend;
  onProgress?: ProgressCallback;
}) {
  const { processor, model, RawImage, backend } = await loadEngine(input.backend, input.onProgress);
  input.onProgress?.(
    backend === "webgpu"
      ? "Granite-Docling קורא את התמונה עם GPU"
      : "Granite-Docling קורא את התמונה עם WebAssembly/CPU — זה עשוי לקחת יותר זמן",
    0.34
  );

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
    do_image_splitting: backend === "webgpu"
  });

  input.onProgress?.("הבינה המקומית משחזרת את רכיבי הדף", 0.55);
  const generatedIds = await model.generate({
    ...inputs,
    max_new_tokens: backend === "webgpu" ? 4096 : 3072,
    do_sample: false
  });

  const decoded = processor.batch_decode(generatedIds, {
    skip_special_tokens: false
  })?.[0] || "";

  const docStart = decoded.indexOf("<doctag>");
  const rawDocTags = docStart >= 0 ? decoded.slice(docStart) : decoded;
  const parsed = parseDocTags(rawDocTags);
  if (parsed.text.length < 20) throw new Error("Granite-Docling returned too little readable document text.");
  return { parsed, backend };
}

export async function analyzeWithLocalVision(input: {
  image: File | Blob;
  ocrText?: string;
  onProgress?: ProgressCallback;
}): Promise<{ analysis: ExerciseAnalysis; documentText: string; layout: DocumentLayoutBlock[]; backend: VisionBackend }> {
  if (!localVisionSupported()) throw new Error("Local document vision requires WebAssembly in a browser context.");

  input.onProgress?.("בודק יכולות עיבוד זמינות במכשיר", 0.04);
  const capabilities = await detectRuntimeCapabilities();
  const plan = visionBackendPlan(capabilities);
  if (!plan.length) throw new Error("No supported local AI runtime is available on this device.");

  let result: Awaited<ReturnType<typeof runDocling>> | null = null;
  let lastError = "";

  for (const backend of plan) {
    try {
      result = await runDocling({ image: input.image, backend, onProgress: input.onProgress });
      break;
    } catch (error) {
      lastError = error instanceof Error ? error.message : `${backend} failed`;
      const next = plan[plan.indexOf(backend) + 1];
      if (next) {
        input.onProgress?.(`${backend.toUpperCase()} לא הצליח — עובר אוטומטית ל-${next.toUpperCase()}`, 0.12);
      }
    }
  }

  if (!result) throw new Error(lastError || "All local document-vision backends failed.");

  const { parsed, backend } = result;
  input.onProgress?.("מזהה את סוג התרגיל מתוך המסמך ששוחזר", 0.9);
  const baseline = fallbackAnalyze(parsed.text, parsed.blocks);
  const recoveredRows = Math.max(
    baseline.questions.length,
    parsed.blocks.filter((block) => /\d+[.)]|_{2,}|\.{4,}|\?$/.test(block.text)).length
  );
  const analysis: ExerciseAnalysis = {
    ...baseline,
    confidence: clamp(Math.max(baseline.confidence, recoveredRows >= 3 ? 0.76 : 0.68), 0, 0.88),
    layoutNotes: [
      `Granite-Docling reconstructed the worksheet locally using ${backend.toUpperCase()}.`,
      `Document vision recovered ${parsed.blocks.length || parsed.text.split(/\n/).length} ordered page elements.`,
      ...baseline.layoutNotes
    ].slice(0, 8)
  };

  input.onProgress?.("מבנה הדף שוחזר", 1);
  return { analysis, documentText: parsed.text, layout: parsed.blocks, backend };
}
