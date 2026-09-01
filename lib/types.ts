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
  /** Terms copied from a word bank that was actually recognized in the source. */
  wordBankWords?: string[];
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

export interface AnalysisMetrics {
  totalMs: number;
  extractionMs?: number;
  ocrDetectionMs?: number;
  ocrRecognitionMs?: number;
  ocrTotalMs?: number;
  structureMs?: number;
  resumed?: boolean;
}

export interface LocalAnalysisCheckpoint {
  ocrText: string;
  layout: DocumentLayoutBlock[];
  engine: LocalAnalysisEngine;
  metrics?: AnalysisMetrics;
}

export type LocalAnalysisEngine =
  | "browser-paddleocr+local"
  | "browser-docling-webgpu+local"
  | "browser-docling-wasm+local"
  | "browser-docling+local"
  | "browser-ocr+vision-local"
  | "browser-ocr+local"
  | "pdf-text+local"
  | "pdf-ocr+local"
  | "docx+local"
  | "text+local";

export interface AnalyzeResponse {
  ocrText: string;
  analysis: ExerciseAnalysis;
  engine: LocalAnalysisEngine;
  warning?: string;
  metrics?: AnalysisMetrics;
}
