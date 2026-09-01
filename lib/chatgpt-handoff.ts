import type { AnswerFormat, ExerciseAnalysis, ExerciseType } from "./types";

export const CHATGPT_REVIEW_THRESHOLD = 0.78;

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
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("ChatGPT returned an invalid structure.");
  return value as Record<string, unknown>;
}

function normalizeAnalysis(value: unknown): ExerciseAnalysis {
  const row = asRecord(value);
  const exerciseType = String(row.exerciseType || "custom") as ExerciseType;
  const answerFormat = String(row.answerFormat || "open") as AnswerFormat;
  const rawQuestions = Array.isArray(row.questions) ? row.questions : [];
  const rawNotes = Array.isArray(row.layoutNotes) ? row.layoutNotes : [];

  return {
    exerciseType: allowedTypes.has(exerciseType) ? exerciseType : "custom",
    title: String(row.title || "English practice").slice(0, 100),
    instructions: String(row.instructions || "Complete the exercise.").slice(0, 500),
    questionCount: clamp(Math.round(Number(row.questionCount) || rawQuestions.length || 8), 1, 30),
    answerFormat: allowedFormats.has(answerFormat) ? answerFormat : "open",
    hasWordBank: Boolean(row.hasWordBank),
    confidence: clamp(Number(row.confidence) || 0.9, 0, 1),
    layoutNotes: rawNotes.slice(0, 8).map((item) => String(item).slice(0, 250)),
    questions: rawQuestions.slice(0, 30).map((item, index) => {
      const question = asRecord(item);
      return {
        number: clamp(Math.round(Number(question.number) || index + 1), 1, 99),
        textPattern: String(question.textPattern || "").slice(0, 500),
        blankCount: clamp(Math.round(Number(question.blankCount) || 0), 0, 10),
        optionCount: clamp(Math.round(Number(question.optionCount) || 0), 0, 8)
      };
    })
  };
}

function structureLooksConsistent(analysis: ExerciseAnalysis) {
  if (analysis.questionCount >= 3 && analysis.questions.length / analysis.questionCount < 0.75) return false;

  if (analysis.exerciseType === "multiple_choice") {
    const questionsWithOptions = analysis.questions.filter((question) => question.optionCount >= 2).length;
    if (questionsWithOptions < Math.max(1, Math.ceil(analysis.questions.length * 0.5))) return false;
  }

  if (analysis.exerciseType === "fill_in_the_blanks") {
    const questionsWithBlanks = analysis.questions.filter((question) => question.blankCount > 0).length;
    if (analysis.questions.length >= 3 && questionsWithBlanks < Math.ceil(analysis.questions.length * 0.5)) return false;
  }

  return true;
}

export function needsChatGPTReview(analysis: ExerciseAnalysis, ocrText: string) {
  return (
    analysis.confidence < CHATGPT_REVIEW_THRESHOLD ||
    analysis.exerciseType === "custom" ||
    ocrText.trim().length < 80 ||
    (analysis.questions.length === 0 && analysis.questionCount === 8) ||
    !structureLooksConsistent(analysis)
  );
}

export function confidenceLabel(confidence: number) {
  if (confidence < 0.55) return "נמוך";
  if (confidence < CHATGPT_REVIEW_THRESHOLD) return "בינוני";
  return "טוב";
}

export function createChatGPTHandoff(input: {
  analysis: ExerciseAnalysis;
  ocrText: string;
  sourceKind: string | null;
}) {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `ts-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  const prompt = `You are helping TeacherSheet identify the STRUCTURE of an English-teaching worksheet.

The attached file/image is the source worksheet when an attachment is present. Inspect the visual layout carefully. I am also providing local OCR and a preliminary local guess below. Prefer the actual worksheet over OCR when they disagree.

IMPORTANT SCOPE:
- Identify structure only.
- Do NOT create new vocabulary.
- Do NOT generate an answer key.
- Do NOT generate the final worksheet.
- Preserve question wording only as a structural reference.
- Detect whether a word bank exists only as a structural boolean.

TeacherSheet handoff ID: ${id}
Input type: ${input.sourceKind || "unknown"}

PRELIMINARY LOCAL GUESS:
${JSON.stringify(input.analysis, null, 2)}

LOCAL OCR TEXT:
${input.ocrText.slice(0, 14000)}

Return ONLY the following block. Do not add commentary before or after it.
TEACHERSHEET_RETURN_V1
{
  "handoffId": "${id}",
  "exerciseType": "fill_in_the_blanks|multiple_choice|matching|true_false|unscramble|translation|reading_comprehension|sentence_writing|custom",
  "title": "short worksheet/exercise title",
  "instructions": "instructions as printed or concise reconstruction",
  "questionCount": 1,
  "answerFormat": "blank|choice|matching|true_false|open",
  "hasWordBank": false,
  "confidence": 0.95,
  "layoutNotes": ["short structural observations"],
  "questions": [
    {"number": 1, "textPattern": "structural reference to the question", "blankCount": 0, "optionCount": 0}
  ]
}
END_TEACHERSHEET_RETURN`;

  return { id, prompt };
}

export function parseChatGPTReturn(raw: string, expectedId?: string) {
  const marker = raw.match(/TEACHERSHEET_RETURN_V1\s*([\s\S]*?)\s*END_TEACHERSHEET_RETURN/i);
  let candidate = (marker?.[1] || raw).replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();
  const firstBrace = candidate.indexOf("{");
  const lastBrace = candidate.lastIndexOf("}");
  if (firstBrace < 0 || lastBrace <= firstBrace) throw new Error("לא נמצא JSON תקין בתשובת ChatGPT.");
  candidate = candidate.slice(firstBrace, lastBrace + 1);

  const parsed = asRecord(JSON.parse(candidate));
  const handoffId = String(parsed.handoffId || "");
  if (expectedId && handoffId !== expectedId) {
    throw new Error("התשובה שהודבקה שייכת לבקשה אחרת. חזור לשיחה שנפתחה עבור הדף הזה.");
  }

  return {
    handoffId,
    analysis: normalizeAnalysis(parsed)
  };
}
