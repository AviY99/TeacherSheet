import OpenAI from "openai";
import type { DocumentLayoutBlock, ExerciseAnalysis } from "./types";

type OpenAIConnectionStatus = {
  configured: boolean;
  connected: boolean;
  model: string;
  error?: string;
};

function selectedModel() {
  return process.env.OPENAI_MODEL || "gpt-5.6-sol";
}

function openAIClient() {
  return new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 45_000,
    maxRetries: 2
  });
}

function safeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "Unknown OpenAI error");
  return message.replace(/sk-[A-Za-z0-9_-]+/g, "[redacted]").slice(0, 500);
}

export function openAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

export async function verifyOpenAIConnection(): Promise<OpenAIConnectionStatus> {
  const model = selectedModel();

  if (!openAIConfigured()) {
    return {
      configured: false,
      connected: false,
      model,
      error: "Missing OPENAI_API_KEY."
    };
  }

  try {
    const client = openAIClient();
    await client.models.retrieve(model);
    return { configured: true, connected: true, model };
  } catch (error) {
    return {
      configured: true,
      connected: false,
      model,
      error: safeError(error)
    };
  }
}

function compactLayout(blocks: DocumentLayoutBlock[]) {
  return blocks.slice(0, 80).map((b) => ({
    p: b.page,
    t: b.text.slice(0, 180),
    x: +b.x.toFixed(3), y: +b.y.toFixed(3), w: +b.width.toFixed(3), h: +b.height.toFixed(3)
  }));
}

function normalizeAnalysis(value: any): ExerciseAnalysis {
  const allowedTypes = new Set(["fill_in_the_blanks","multiple_choice","matching","true_false","unscramble","translation","reading_comprehension","sentence_writing","custom"]);
  const allowedFormats = new Set(["blank","choice","matching","true_false","open"]);
  return {
    exerciseType: allowedTypes.has(value.exerciseType) ? value.exerciseType : "custom",
    title: String(value.title || "English practice").slice(0, 100),
    instructions: String(value.instructions || "Complete the exercise.").slice(0, 500),
    questionCount: Math.max(1, Math.min(30, Number(value.questionCount) || 8)),
    answerFormat: allowedFormats.has(value.answerFormat) ? value.answerFormat : "open",
    hasWordBank: Boolean(value.hasWordBank),
    confidence: Math.max(0, Math.min(1, Number(value.confidence) || 0.5)),
    layoutNotes: Array.isArray(value.layoutNotes) ? value.layoutNotes.slice(0, 8).map(String) : [],
    questions: Array.isArray(value.questions) ? value.questions.slice(0, 30).map((q: any, i: number) => ({
      number: Number(q.number) || i + 1,
      textPattern: String(q.textPattern || "").slice(0, 400),
      blankCount: Math.max(0, Math.min(10, Number(q.blankCount) || 0)),
      optionCount: Math.max(0, Math.min(8, Number(q.optionCount) || 0))
    })) : []
  } as ExerciseAnalysis;
}

export async function analyzeWithOpenAI(input: {
  ocrText: string;
  layout: DocumentLayoutBlock[];
  imageDataUrl?: string;
}): Promise<ExerciseAnalysis> {
  const client = openAIClient();
  const model = selectedModel();
  const prompt = `You analyze English-teaching worksheet structure. Return ONLY valid JSON, no markdown.\n\nImportant scope: identify the exercise STRUCTURE only. Do not create a vocabulary list, do not generate an answer key, do not create final exercise content. A word-bank may be detected only as a boolean structural feature.\n\nReturn this shape exactly:\n{\n  "exerciseType": "fill_in_the_blanks|multiple_choice|matching|true_false|unscramble|translation|reading_comprehension|sentence_writing|custom",\n  "title": "short title",\n  "instructions": "instructions as printed or concise reconstruction",\n  "questionCount": 1,\n  "answerFormat": "blank|choice|matching|true_false|open",\n  "hasWordBank": false,\n  "confidence": 0.0,\n  "layoutNotes": ["short structural observations"],\n  "questions": [{"number":1,"textPattern":"question text with content preserved only as structural reference","blankCount":0,"optionCount":0}]\n}\n\nOCR TEXT:\n${input.ocrText.slice(0, 24000)}\n\nLAYOUT BLOCKS:\n${JSON.stringify(compactLayout(input.layout))}`;

  const content: any[] = [{ type: "input_text", text: prompt }];
  if (input.imageDataUrl) content.push({ type: "input_image", image_url: input.imageDataUrl, detail: "high" });

  const response = await client.responses.create({
    model,
    store: false,
    max_output_tokens: 6000,
    input: [{ role: "user", content }],
    text: {
      format: {
        type: "json_schema",
        name: "exercise_structure",
        strict: true,
        schema: {
          type: "object",
          additionalProperties: false,
          required: ["exerciseType", "title", "instructions", "questionCount", "answerFormat", "hasWordBank", "confidence", "layoutNotes", "questions"],
          properties: {
            exerciseType: { type: "string", enum: ["fill_in_the_blanks", "multiple_choice", "matching", "true_false", "unscramble", "translation", "reading_comprehension", "sentence_writing", "custom"] },
            title: { type: "string" },
            instructions: { type: "string" },
            questionCount: { type: "integer", minimum: 1, maximum: 30 },
            answerFormat: { type: "string", enum: ["blank", "choice", "matching", "true_false", "open"] },
            hasWordBank: { type: "boolean" },
            confidence: { type: "number", minimum: 0, maximum: 1 },
            layoutNotes: { type: "array", items: { type: "string" } },
            questions: {
              type: "array",
              items: {
                type: "object",
                additionalProperties: false,
                required: ["number", "textPattern", "blankCount", "optionCount"],
                properties: {
                  number: { type: "integer", minimum: 1 },
                  textPattern: { type: "string" },
                  blankCount: { type: "integer", minimum: 0 },
                  optionCount: { type: "integer", minimum: 0 }
                }
              }
            }
          }
        }
      }
    }
  });

  if (!response.output_text) {
    throw new Error("OpenAI returned no structured analysis output.");
  }

  return normalizeAnalysis(JSON.parse(response.output_text));
}
