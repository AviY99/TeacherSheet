import type { AnswerFormat, DocumentLayoutBlock, ExerciseAnalysis, ExerciseType } from "./types";

const defaults: Record<ExerciseType, { title: string; instructions: string; format: AnswerFormat }> = {
  fill_in_the_blanks: { title: "Fill in the blanks", instructions: "Complete the sentences.", format: "blank" },
  multiple_choice: { title: "Multiple choice", instructions: "Choose the correct answer.", format: "choice" },
  matching: { title: "Matching", instructions: "Match each item with the correct answer.", format: "matching" },
  true_false: { title: "True / False", instructions: "Mark each sentence True or False.", format: "true_false" },
  unscramble: { title: "Unscramble", instructions: "Unscramble the items.", format: "open" },
  translation: { title: "Translation", instructions: "Translate the following items.", format: "open" },
  reading_comprehension: { title: "Reading comprehension", instructions: "Read and answer the questions.", format: "open" },
  sentence_writing: { title: "Sentence writing", instructions: "Write a sentence for each item.", format: "open" },
  custom: { title: "English practice", instructions: "Complete the exercise.", format: "open" }
};

function chooseType(text: string): ExerciseType {
  const low = text.toLowerCase();
  const scores = new Map<ExerciseType, number>();
  const add = (type: ExerciseType, amount: number) => scores.set(type, (scores.get(type) || 0) + amount);

  if (/fill in|fill the gaps?|complete the sentences?|word bank|words in the box|use the words/.test(low)) add("fill_in_the_blanks", 4);
  if ((text.match(/_{2,}|\.{4,}/g) || []).length >= 2) add("fill_in_the_blanks", 3);
  if (/multiple choice|choose the correct|circle the correct|choose the best/.test(low)) add("multiple_choice", 5);
  if ((text.match(/(?:^|\s)[A-D][.)]\s+/gm) || []).length >= 4) add("multiple_choice", 3);
  if (/match the|matching|match each|match column/.test(low)) add("matching", 5);
  if (/true\s*\/\s*false|true or false|\bt\s*\/\s*f\b/.test(low)) add("true_false", 5);
  if (/unscramble|rearrange the letters|jumbled|put the letters/.test(low)) add("unscramble", 5);
  if (/translate|translation/.test(low)) add("translation", 5);
  if (/reading comprehension|read.+answer|answer the questions|read the text/.test(low)) add("reading_comprehension", 4);
  if (/write.+sentence|make a sentence|sentence writing|write sentences/.test(low)) add("sentence_writing", 4);

  let best: ExerciseType = "custom";
  let bestScore = 0;
  for (const [type, score] of scores) {
    if (score > bestScore) {
      best = type;
      bestScore = score;
    }
  }
  return best;
}

function detectLayoutNotes(layout: DocumentLayoutBlock[]) {
  if (!layout.length) return ["Text-only local analysis; no reliable page coordinates were available."];
  const notes: string[] = [];
  const shortLines = layout.filter((line) => line.text.length > 0 && line.text.length < 35);
  const left = shortLines.filter((line) => line.x < 0.42).length;
  const right = shortLines.filter((line) => line.x > 0.52).length;
  if (left >= 3 && right >= 3) notes.push("The page appears to contain more than one horizontal text region or column.");
  if (layout.some((line) => /word bank|words in the box/i.test(line.text))) notes.push("A word-bank region was detected in the OCR layout.");
  notes.push(`Local OCR supplied ${Math.min(layout.length, 160)} positioned text lines for structure hints.`);
  return notes.slice(0, 4);
}

export function fallbackAnalyze(text: string, layout: DocumentLayoutBlock[] = []): ExerciseAnalysis {
  const low = text.toLowerCase();
  const type = chooseType(text);
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const numbered = lines.filter((line) => /^\s*\d+[.)]\s*/.test(line));
  const blanks = (text.match(/_{2,}|\.{4,}/g) || []).length;
  const tfItems = lines.filter((line) => /\btrue\b.*\bfalse\b|\bt\s*\/\s*f\b/i.test(line)).length;
  const questionCount = Math.max(1, Math.min(30, numbered.length || blanks || tfItems || 8));
  const firstInstruction = lines.find((line) => !/^\s*\d+[.)]/.test(line) && line.length >= 10 && line.length < 180);
  const config = defaults[type];

  const questionLines = numbered.length
    ? numbered
    : lines.filter((line) => /_{2,}|\.{4,}|\?$/.test(line)).slice(0, questionCount);

  const confidenceBase = type === "custom" ? 0.38 : 0.58;
  const confidenceBoost = Math.min(0.22, (numbered.length > 0 ? 0.08 : 0) + (blanks > 0 ? 0.08 : 0) + (firstInstruction ? 0.06 : 0));

  return {
    exerciseType: type,
    title: config.title,
    instructions: firstInstruction || config.instructions,
    questionCount,
    answerFormat: config.format,
    hasWordBank: /word bank|words in the box|use the words|words below/.test(low),
    confidence: Math.min(0.82, confidenceBase + confidenceBoost),
    layoutNotes: detectLayoutNotes(layout),
    questions: questionLines.slice(0, 30).map((line, index) => ({
      number: index + 1,
      textPattern: line.replace(/^\s*\d+[.)]\s*/, ""),
      blankCount: (line.match(/_{2,}|\.{4,}/g) || []).length,
      optionCount: (line.match(/(?:^|\s)[A-D][.)]\s+/g) || []).length
    }))
  };
}
