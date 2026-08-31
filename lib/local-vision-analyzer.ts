"use client";

import { streamText } from "ai";
import { transformersJS } from "@browser-ai/transformers-js";
import type { AnswerFormat, ExerciseAnalysis, ExerciseType } from "./types";

const MODEL_ID = "HuggingFaceTB/SmolVLM-256M-Instruct";

const allowedTypes = new Set<ExerciseType>([
  "fill_in_the_blanks",
  "multiple_choice",
  "matching",
  "true_false",
  "unscramble",
  "translation",
  "reading_comprehension",
  "sentence_writing",
  "custom"
]);

const allowedFormats = new Set<AnswerFormat>(["blank", "choice", "matching", "true_false", "open"]);

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Local vision model returned invalid JSON.");
  return value as Record<string, unknown>;
}

function parseJson(raw: string) {
  let candidate = raw.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first < 0 || last <= first) throw new Error("Local vision model did not return JSON.");
  candidate = candidate.slice(first, last + 1);
  return asRecord(JSON.parse(candidate));
}

function normalize(value: Record<string, unknown>): ExerciseAnalysis {
  const exerciseType = String(value.exerciseType || "custom") as ExerciseType;
  const answerFormat = String(value.answerFormat || "open") as AnswerFormat;
  const rawQuestions = Array.isArray(value.questions) ? value.questions : [];
  const rawNotes = Array.isArray(value.layoutNotes) ? value.layoutNotes : [];

  const questions = rawQuestions.slice(0, 30).map((item, index) => {
    const row = asRecord(item);
    return {
      number: clamp(Math.round(Number(row.number) || index + 1), 1, 99),
      textPattern: String(row.textPattern || "").trim().slice(0, 700),
      blankCount: clamp(Math.round(Number(row.blankCount) || 0), 0, 20),
      optionCount: clamp(Math.round(Number(row.optionCount) || 0), 0, 10)
    };
  });

  return {
    exerciseType: allowedTypes.has(exerciseType) ? exerciseType : "custom",
    title: String(value.title || "English practice").trim().slice(0, 120),
    instructions: String(value.instructions || "Complete the exercise.").trim().slice(0, 700),
    questionCount: clamp(Math.round(Number(value.questionCount) || questions.length || 1), 1, 30),
    answerFormat: allowedFormats.has(answerFormat) ? answerFormat : "open",
    hasWordBank: Boolean(value.hasWordBank),
    confidence: clamp(Number(value.confidence) || 0.72, 0, 0.9),
    layoutNotes: rawNotes.slice(0, 8).map((item) => String(item).slice(0, 300)),
    questions
  };
}

export function localVisionSupported() {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && "gpu" in navigator;
}

export async function analyzeWithLocalVision(input: {
  image: File | Blob;
  ocrText: string;
  onProgress?: (message: string, progress?: number) => void;
}): Promise<ExerciseAnalysis> {
  if (!localVisionSupported()) throw new Error("WebGPU is not available on this device/browser.");

  input.onProgress?.("טוען מנוע בינה חזותית מקומי — בפעם הראשונה המודל יורד למכשיר", 0.72);

  const model = transformersJS(MODEL_ID, {
    isVisionModel: true,
    device: "webgpu"
  });

  const prompt = `You are the visual intelligence engine inside TeacherSheet.
Inspect the ATTACHED WORKSHEET IMAGE ITSELF. Do not rely only on OCR.
Your job is to recover the exercise STRUCTURE accurately enough to reproduce a structural draft.

Critical rules:
- Count every visible exercise item. Do not silently omit lines.
- Preserve the order of exercise items from top to bottom.
- Use the visual page layout to distinguish title, instructions, word bank, questions and answer choices.
- If OCR text below is incomplete or conflicts with the image, trust the image.
- Do not invent vocabulary, answers, answer keys or new worksheet content.
- textPattern should contain the visible wording/pattern of each exercise line as faithfully as possible.
- questionCount must match the number of visible exercise items you include in questions.
- confidence should reflect how clearly you can read and understand the page.

LOCAL OCR (supporting evidence only):
${input.ocrText.slice(0, 12000)}

Return ONLY valid JSON in exactly this shape:
{
  "exerciseType": "fill_in_the_blanks|multiple_choice|matching|true_false|unscramble|translation|reading_comprehension|sentence_writing|custom",
  "title": "string",
  "instructions": "string",
  "questionCount": 1,
  "answerFormat": "blank|choice|matching|true_false|open",
  "hasWordBank": false,
  "confidence": 0.0,
  "layoutNotes": ["string"],
  "questions": [
    {"number": 1, "textPattern": "visible exercise line", "blankCount": 0, "optionCount": 0}
  ]
}`;

  const result = streamText({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: input.image }
        ]
      }
    ],
    maxOutputTokens: 1800,
    temperature: 0
  });

  let raw = "";
  for await (const chunk of result.textStream) raw += chunk;

  input.onProgress?.("הבינה המקומית מסדרת את מבנה התרגיל", 0.96);
  return normalize(parseJson(raw));
}
