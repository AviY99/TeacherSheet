export type ExerciseType =
  | "fill_in_the_blanks"
  | "multiple_choice"
  | "matching"
  | "true_false"
  | "unscramble"
  | "translation"
  | "reading_comprehension"
  | "sentence_writing"
  | "custom";

export type AnswerFormat = "blank" | "choice" | "matching" | "true_false" | "open";

export interface QuestionPattern {
  number: number;
  textPattern: string;
  blankCount: number;
  optionCount: number;
}

export interface ExerciseAnalysis {
  exerciseType: ExerciseType;
  title: string;
  instructions: string;
  questionCount: number;
  answerFormat: AnswerFormat;
  hasWordBank: boolean;
  confidence: number;
  layoutNotes: string[];
  questions: QuestionPattern[];
}

export interface DocumentLayoutBlock {
  page: number;
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AnalyzeResponse {
  ocrText: string;
  analysis: ExerciseAnalysis;
  engine: "google+openai" | "google+fallback" | "text+openai" | "text+fallback";
  warning?: string;
}
