import type { AnswerFormat, ExerciseAnalysis, ExerciseType } from "./types";

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

export function fallbackAnalyze(text: string): ExerciseAnalysis {
  const low = text.toLowerCase();
  const rules: Array<[ExerciseType, RegExp]> = [
    ["fill_in_the_blanks", /fill in|complete the sentence|word bank|words in the box|_{3,}|\.{4,}/],
    ["multiple_choice", /multiple choice|choose the correct|circle the correct|choose the best/],
    ["matching", /match the|matching|match each/],
    ["true_false", /true\s*\/\s*false|true or false|\bt\s*\/\s*f\b/],
    ["unscramble", /unscramble|rearrange the letters|jumbled/],
    ["translation", /translate|translation/],
    ["reading_comprehension", /reading comprehension|read.+answer|answer the questions/],
    ["sentence_writing", /write.+sentence|make a sentence|sentence writing/]
  ];
  let type: ExerciseType = "custom";
  for (const [candidate, regex] of rules) if (regex.test(low)) type = candidate;

  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const numbered = lines.filter((line) => /^\d+[.)]\s*/.test(line));
  const blanks = (text.match(/_{3,}|\.{4,}/g) || []).length;
  const questionCount = Math.max(1, Math.min(30, numbered.length || blanks || 8));
  const firstInstruction = lines.find((line) => !/^\d+[.)]/.test(line) && line.length >= 10 && line.length < 180);
  const config = defaults[type];

  return {
    exerciseType: type,
    title: config.title,
    instructions: firstInstruction || config.instructions,
    questionCount,
    answerFormat: config.format,
    hasWordBank: /word bank|words in the box|use the words|words below/.test(low),
    confidence: 0.45,
    layoutNotes: ["Local fallback analysis — connect OpenAI for semantic structure recognition."],
    questions: numbered.slice(0, 30).map((line, index) => ({
      number: index + 1,
      textPattern: line.replace(/^\d+[.)]\s*/, ""),
      blankCount: (line.match(/_{3,}|\.{4,}/g) || []).length,
      optionCount: 0
    }))
  };
}
