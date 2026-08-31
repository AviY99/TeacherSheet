"use client";

import { streamText } from "ai";
import { transformersJS } from "@browser-ai/transformers-js";
import { fallbackAnalyze } from "./fallback-analyzer";
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

function normalizeType(value: string, fallback: ExerciseType): ExerciseType {
  const clean = value.trim().toLowerCase().replace(/[ -]+/g, "_");
  if (allowedTypes.has(clean as ExerciseType)) return clean as ExerciseType;
  if (/fill|blank|gap/.test(clean)) return "fill_in_the_blanks";
  if (/multiple|choice|choose/.test(clean)) return "multiple_choice";
  if (/match/.test(clean)) return "matching";
  if (/true|false/.test(clean)) return "true_false";
  if (/unscram|rearrange|jumbl/.test(clean)) return "unscramble";
  if (/translat/.test(clean)) return "translation";
  if (/reading|comprehension/.test(clean)) return "reading_comprehension";
  if (/sentence|writing/.test(clean)) return "sentence_writing";
  return fallback;
}

function normalizeFormat(value: string, fallback: AnswerFormat): AnswerFormat {
  const clean = value.trim().toLowerCase().replace(/[ -]+/g, "_");
  if (allowedFormats.has(clean as AnswerFormat)) return clean as AnswerFormat;
  if (/blank|gap/.test(clean)) return "blank";
  if (/choice|select/.test(clean)) return "choice";
  if (/match/.test(clean)) return "matching";
  if (/true|false/.test(clean)) return "true_false";
  return fallback;
}

function cleanModelText(raw: string) {
  return raw
    .replace(/```[a-z]*\s*/gi, "")
    .replace(/```/g, "")
    .replace(/^\s*[-*•]\s*/gm, "")
    .trim();
}

function field(lines: string[], names: string[]) {
  const wanted = names.map((name) => name.toUpperCase());
  for (const line of lines) {
    const normalized = line.trim();
    const separator = normalized.includes("|") ? "|" : ":";
    const index = normalized.indexOf(separator);
    if (index < 0) continue;
    const key = normalized.slice(0, index).trim().toUpperCase().replace(/\s+/g, "_");
    if (wanted.includes(key)) return normalized.slice(index + 1).trim();
  }
  return "";
}

function parseQuestionLine(line: string, fallbackNumber: number) {
  const tagged = line.match(/^\s*Q\s*\|\s*(\d+)\s*\|\s*(.*?)\s*\|\s*(?:BLANKS?\s*=\s*)?(\d+)\s*\|\s*(?:OPTIONS?\s*=\s*)?(\d+)\s*$/i);
  if (tagged) {
    return {
      number: clamp(Number(tagged[1]) || fallbackNumber, 1, 99),
      textPattern: tagged[2].trim().slice(0, 700),
      blankCount: clamp(Number(tagged[3]) || 0, 0, 20),
      optionCount: clamp(Number(tagged[4]) || 0, 0, 10)
    };
  }

  const taggedLoose = line.match(/^\s*Q\s*\|\s*(\d+)\s*\|\s*(.+)$/i);
  const numbered = line.match(/^\s*(?:Q\s*)?(\d+)\s*[.)|:-]\s*(.+)$/i);
  const match = taggedLoose || numbered;
  if (!match) return null;

  const text = match[2].trim().replace(/\s*\|\s*(?:BLANKS?|OPTIONS?)\s*=\s*\d+.*$/i, "").slice(0, 700);
  if (!text) return null;
  return {
    number: clamp(Number(match[1]) || fallbackNumber, 1, 99),
    textPattern: text,
    blankCount: clamp((text.match(/\[BLANK\]|_{2,}|\.{4,}/gi) || []).length, 0, 20),
    optionCount: clamp((text.match(/(?:^|\s)[A-F][.)]\s+/g) || []).length, 0, 10)
  };
}

function parseTaggedAnalysis(raw: string, ocrText: string): ExerciseAnalysis {
  const baseline = fallbackAnalyze(ocrText);
  const clean = cleanModelText(raw);
  const lines = clean.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);

  const questions = lines
    .map((line, index) => parseQuestionLine(line, index + 1))
    .filter((value): value is NonNullable<ReturnType<typeof parseQuestionLine>> => Boolean(value))
    .slice(0, 30);

  const typeValue = field(lines, ["TYPE", "EXERCISE_TYPE"]);
  const titleValue = field(lines, ["TITLE"]);
  const instructionValue = field(lines, ["INSTRUCTION", "INSTRUCTIONS"]);
  const formatValue = field(lines, ["FORMAT", "ANSWER_FORMAT"]);
  const wordBankValue = field(lines, ["WORD_BANK", "WORDBANK"]);
  const confidenceValue = field(lines, ["CONFIDENCE"]);
  const countValue = field(lines, ["COUNT", "QUESTION_COUNT"]);

  const useful = questions.length > 0 || Boolean(typeValue || titleValue || instructionValue || formatValue);
  if (!useful) throw new Error("Local vision model returned no parseable worksheet structure.");

  const exerciseType = normalizeType(typeValue, baseline.exerciseType);
  const answerFormat = normalizeFormat(formatValue, baseline.answerFormat);
  const explicitCount = clamp(Math.round(Number(countValue) || 0), 0, 30);
  const questionCount = questions.length || explicitCount || baseline.questionCount;
  const explicitConfidence = Number.parseFloat(confidenceValue.replace(/[^0-9.]/g, ""));
  const inferredConfidence = questions.length >= 3 ? 0.76 : 0.67;

  return {
    exerciseType,
    title: (titleValue || baseline.title).slice(0, 120),
    instructions: (instructionValue || baseline.instructions).slice(0, 700),
    questionCount: clamp(questionCount, 1, 30),
    answerFormat,
    hasWordBank: wordBankValue
      ? /^(yes|true|1|כן)$/i.test(wordBankValue.trim())
      : baseline.hasWordBank,
    confidence: clamp(Number.isFinite(explicitConfidence) ? explicitConfidence : inferredConfidence, 0, 0.9),
    layoutNotes: [
      "Local vision inspected the worksheet image directly.",
      questions.length ? `Vision recovered ${questions.length} visible exercise rows.` : "Vision returned worksheet-level structure only."
    ],
    questions: questions.length ? questions : baseline.questions
  };
}

export function localVisionSupported() {
  return typeof window !== "undefined" && typeof navigator !== "undefined" && "gpu" in navigator;
}

async function runVisionModel(model: ReturnType<typeof transformersJS>, prompt: string, imageBytes: Uint8Array, mediaType: string) {
  const result = streamText({
    model,
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: prompt },
          { type: "image", image: imageBytes, mediaType }
        ]
      }
    ],
    maxOutputTokens: 1500,
    temperature: 0
  });

  let raw = "";
  for await (const chunk of result.textStream) raw += chunk;
  return raw.trim();
}

function primaryPrompt(ocrText: string) {
  return `Look at the worksheet IMAGE. Recover its exercise structure.
OCR below is only a hint and can be wrong. Trust the image when they disagree.

Do NOT write JSON. Do NOT use markdown. Output simple lines exactly like this:
TYPE|fill_in_the_blanks
TITLE|title visible on page
INSTRUCTION|instruction visible on page
FORMAT|blank
WORD_BANK|YES
CONFIDENCE|0.82
Q|1|first visible exercise item|BLANKS=1|OPTIONS=0
Q|2|second visible exercise item|BLANKS=1|OPTIONS=0
END

Rules:
- One Q line for EVERY visible exercise item, top to bottom. Never omit a row.
- TYPE must be one of: fill_in_the_blanks, multiple_choice, matching, true_false, unscramble, translation, reading_comprehension, sentence_writing, custom.
- FORMAT must be one of: blank, choice, matching, true_false, open.
- Copy visible exercise wording as faithfully as possible.
- Do not invent answers, vocabulary, answer keys, or new content.

OCR HINT:
${ocrText.slice(0, 9000)}`;
}

function retryPrompt(ocrText: string) {
  return `Inspect the worksheet image and list its structure. Plain text only. No JSON. No markdown.
First line: TYPE|exercise_type
Then output ONE line for EACH visible exercise row:
Q|1|visible row text|0|0
Q|2|visible row text|0|0
Continue until every row is included. Finish with END.
Use the image as truth. OCR is only a weak hint:
${ocrText.slice(0, 6000)}`;
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
  const imageBytes = new Uint8Array(await input.image.arrayBuffer());
  const mediaType = input.image.type || "image/jpeg";

  input.onProgress?.("הבינה החזותית קוראת את מבנה הדף", 0.82);
  const firstRaw = await runVisionModel(model, primaryPrompt(input.ocrText), imageBytes, mediaType);
  try {
    const parsed = parseTaggedAnalysis(firstRaw, input.ocrText);
    input.onProgress?.("הבינה המקומית סידרה את כל שורות התרגיל", 0.97);
    return parsed;
  } catch {
    input.onProgress?.("מבצע ניסיון Vision שני בפורמט פשוט יותר", 0.9);
  }

  const retryRaw = await runVisionModel(model, retryPrompt(input.ocrText), imageBytes, mediaType);
  const parsed = parseTaggedAnalysis(retryRaw, input.ocrText);
  input.onProgress?.("הבינה המקומית סידרה את כל שורות התרגיל", 0.97);
  return { ...parsed, confidence: Math.min(parsed.confidence, 0.82) };
}
