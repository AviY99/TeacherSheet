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

const WORD_BANK_LABEL = /\bword\s*(?:bank|box|list)\b|\bwords?\s+(?:in|from)\s+(?:the\s+)?(?:box|list|bank)\b|\buse\s+(?:the\s+)?words?\b|\bwords?\s+below\b|\bfrom\s+the\s+list\s+provided\b|מחסן\s*מילים|אוצר\s*מילים|מאגר\s*מילים/i;
const FOOTER_LIKE = /https?:\/\/|www\.|\.com\b|\.co\.\w+\b|copyright|all rights|free english|worksheets? visit|name\s*:|date\s*:/i;
const BANK_STOP_WORDS = new Set([
  "word", "words", "bank", "box", "list", "use", "choose", "correct", "from", "provided",
  "complete", "sentence", "sentences", "answer", "example", "name", "date"
]);

interface PhysicalLine {
  page: number;
  y: number;
  x: number;
  right: number;
  height: number;
  text: string;
  gapCount: number;
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function median(values: number[]) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function reconstructPhysicalLines(layout: DocumentLayoutBlock[]): PhysicalLine[] {
  if (!layout.length) return [];
  const groups: Array<{ page: number; centerY: number; blocks: DocumentLayoutBlock[] }> = [];
  const typicalHeight = median(layout.map((block) => block.height).filter((value) => value > 0)) || 0.018;
  const tolerance = clamp(typicalHeight * 0.72, 0.006, 0.022);

  for (const block of [...layout].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x)) {
    const centerY = block.y + block.height / 2;
    let best: { page: number; centerY: number; blocks: DocumentLayoutBlock[] } | undefined;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const group of groups) {
      if (group.page !== block.page) continue;
      const distance = Math.abs(group.centerY - centerY);
      if (distance <= tolerance && distance < bestDistance) {
        best = group;
        bestDistance = distance;
      }
    }
    if (!best) {
      groups.push({ page: block.page, centerY, blocks: [block] });
    } else {
      best.blocks.push(block);
      best.centerY = best.blocks.reduce((sum, item) => sum + item.y + item.height / 2, 0) / best.blocks.length;
    }
  }

  return groups
    .map((group): PhysicalLine => {
      const blocks = [...group.blocks].sort((a, b) => a.x - b.x);
      const parts: string[] = [];
      let gapCount = 0;
      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        if (index > 0) {
          const previous = blocks[index - 1];
          const gap = block.x - (previous.x + previous.width);
          const charWidth = previous.text.length > 0 ? previous.width / previous.text.length : 0.008;
          const largeGap = gap > Math.max(0.026, charWidth * 4.5);
          if (largeGap) {
            parts.push("____");
            gapCount += 1;
          }
        }
        parts.push(block.text.trim());
      }
      const x = Math.min(...blocks.map((block) => block.x));
      const right = Math.max(...blocks.map((block) => block.x + block.width));
      const y = Math.min(...blocks.map((block) => block.y));
      const height = Math.max(...blocks.map((block) => block.height));
      return {
        page: group.page,
        y,
        x,
        right,
        height,
        text: parts.join(" ").replace(/\s+/g, " ").trim(),
        gapCount
      };
    })
    .filter((line) => line.text)
    .sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
}

function textLines(text: string): PhysicalLine[] {
  const raw = text.split(/\r?\n/);
  return raw.map((line) => line.trim()).filter(Boolean).map((line, index) => ({
    page: 1,
    y: index / Math.max(1, raw.length),
    x: 0,
    right: 1,
    height: 0.02,
    text: line,
    gapCount: 0
  }));
}

function blankCount(line: PhysicalLine) {
  return Math.max(line.gapCount, (line.text.match(/_{2,}|\.{4,}/g) || []).length);
}

function optionLabelCount(text: string) {
  return (text.match(/(?:^|\s)[A-H][.)]\s+/g) || []).length;
}

function numberedValue(text: string) {
  const match = text.match(/^\s*(\d{1,2})[.)]\s*/);
  return match ? Number(match[1]) : null;
}

function selectQuestionSequence(lines: PhysicalLine[]) {
  const numbered = lines.filter((line) => numberedValue(line.text) !== null);
  if (numbered.length < 2) return numbered;

  const runs: PhysicalLine[][] = [];
  let current: PhysicalLine[] = [];
  for (const line of numbered) {
    const value = numberedValue(line.text)!;
    const previous = current.length ? numberedValue(current[current.length - 1].text)! : null;
    const samePage = !current.length || current[current.length - 1].page === line.page;

    if (value === 1) {
      if (current.length) runs.push(current);
      current = [line];
    } else if (current.length && samePage && previous !== null && value === previous + 1) {
      current.push(line);
    } else if (!current.length) {
      current = [line];
    } else {
      runs.push(current);
      current = value === 1 ? [line] : [];
    }
  }
  if (current.length) runs.push(current);

  const sequential = runs.filter((run) => numberedValue(run[0].text) === 1);
  const candidates = sequential.length ? sequential : runs;
  return candidates.sort((a, b) => b.length - a.length || a[0].y - b[0].y)[0] || numbered;
}

function lexicalItems(text: string) {
  return text.split(/[\s,;|•·]+/).map((value) => value.trim()).filter(Boolean);
}

function looksLikeWordList(line: PhysicalLine) {
  const separators = (line.text.match(/[,;|•·]/g) || []).length;
  const words = lexicalItems(line.text);
  return separators >= 3 && words.length >= 5 && numberedValue(line.text) === null && !FOOTER_LIKE.test(line.text);
}

function cleanBankTerm(value: string) {
  const cleaned = value
    .replace(WORD_BANK_LABEL, "")
    .replace(/^[\s\-–—:;,.•·|()[\]{}]+|[\s\-–—:;,.•·|()[\]{}]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length > 42 || /\d/.test(cleaned) || FOOTER_LIKE.test(cleaned)) return "";
  if (!/^[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*){0,3}$/.test(cleaned)) return "";
  const low = cleaned.toLowerCase();
  if (BANK_STOP_WORDS.has(low)) return "";
  return cleaned;
}

function splitBankLine(text: string) {
  const withoutLabel = text.replace(WORD_BANK_LABEL, " ").replace(/\s+/g, " ").trim();
  const hasStrongSeparator = /[,;|•·]/.test(withoutLabel) || /_{3,}/.test(withoutLabel);
  if (!hasStrongSeparator) return [] as string[];
  return withoutLabel
    .split(/\s*(?:[,;|•·]|_{3,})\s*/)
    .map(cleanBankTerm)
    .filter(Boolean);
}

function detectWordBank(lines: PhysicalLine[], questionLines: PhysicalLine[]) {
  const labelLines = lines.filter((line) => WORD_BANK_LABEL.test(line.text));
  const lastQuestionByPage = new Map<number, number>();
  for (const line of questionLines) {
    lastQuestionByPage.set(line.page, Math.max(lastQuestionByPage.get(line.page) || 0, line.y));
  }

  const candidates = lines.filter((line) => {
    if (numberedValue(line.text) !== null || FOOTER_LIKE.test(line.text)) return false;
    if (WORD_BANK_LABEL.test(line.text) || looksLikeWordList(line)) return true;

    const afterQuestion = line.y > (lastQuestionByPage.get(line.page) || 1) && line.y - (lastQuestionByPage.get(line.page) || 1) < 0.28;
    const nearLabel = labelLines.some((label) => label.page === line.page && line.y >= label.y && line.y - label.y < 0.22);
    const separators = (line.text.match(/[,;|•·]/g) || []).length;
    return (afterQuestion || nearLabel) && separators >= 2 && lexicalItems(line.text).length >= 4;
  });

  const words: string[] = [];
  const seen = new Set<string>();
  for (const line of candidates) {
    for (const item of splitBankLine(line.text)) {
      const key = item.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      words.push(item);
      if (words.length >= 50) break;
    }
    if (words.length >= 50) break;
  }

  const explicit = labelLines.length > 0 || lines.some(looksLikeWordList);
  return {
    hasWordBank: explicit || words.length >= 4,
    words,
    explicit
  };
}

function chooseType(input: {
  text: string;
  lines: PhysicalLine[];
  numberedLines: PhysicalLine[];
  hasWordBank: boolean;
}) {
  const low = input.text.toLowerCase();
  const scores = new Map<ExerciseType, number>();
  const add = (type: ExerciseType, amount: number) => scores.set(type, (scores.get(type) || 0) + amount);
  const explicitBlanks = (input.text.match(/_{2,}|\.{4,}/g) || []).length;
  const blankQuestionLines = input.numberedLines.filter((line) => blankCount(line) > 0).length;
  const optionLabels = input.lines.reduce((sum, line) => sum + optionLabelCount(line.text), 0);
  const twoColumnEvidence = input.lines.filter((line) => line.x < 0.42 && line.right < 0.58).length >= 3
    && input.lines.filter((line) => line.x > 0.48).length >= 3;

  if (/fill in(?: the)? blanks?|fill in(?: the)? gaps?/.test(low)) add("fill_in_the_blanks", 8);
  if (/complete (?:the )?(?:sentences?|questions?)/.test(low)) add("fill_in_the_blanks", 2);
  if (/from (?:the )?(?:list|box)|use the words|word bank|word list/.test(low)) add("fill_in_the_blanks", 3);
  if (explicitBlanks >= 2) add("fill_in_the_blanks", 5);
  if (blankQuestionLines >= 2) add("fill_in_the_blanks", 6);
  if (input.hasWordBank) add("fill_in_the_blanks", 2);

  if (/multiple choice/.test(low)) add("multiple_choice", 9);
  if (optionLabels >= 4) add("multiple_choice", 7);
  if (optionLabels >= 2 && /choose|circle|select/.test(low)) add("multiple_choice", 3);

  if (/match the|matching|match each|match column/.test(low)) add("matching", 8);
  if (twoColumnEvidence && /match|connect|pair/.test(low)) add("matching", 4);

  if (/true\s*\/\s*false|true or false|\bt\s*\/\s*f\b/.test(low)) add("true_false", 9);
  if (/unscramble|rearrange the letters|jumbled|put the letters/.test(low)) add("unscramble", 8);
  if (/translate|translation/.test(low)) add("translation", 8);
  if (/reading comprehension|read.+answer|answer the questions|read the text/.test(low)) add("reading_comprehension", 6);
  if (/write.+sentence|make a sentence|sentence writing|write sentences/.test(low)) add("sentence_writing", 6);

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const [bestType, bestScore] = ranked[0] || ["custom", 0] as [ExerciseType, number];
  const secondScore = ranked[1]?.[1] || 0;

  let type = bestType;
  if (type === "multiple_choice" && optionLabels < 2 && !/multiple choice/.test(low)) type = "custom";

  return {
    type,
    bestScore: type === bestType ? bestScore : 0,
    secondScore,
    blankQuestionLines,
    explicitBlanks,
    optionLabels,
    twoColumnEvidence
  };
}

function detectLayoutNotes(lines: PhysicalLine[], originalBlockCount: number, hasWordBank: boolean, wordCount: number) {
  if (!lines.length) return ["Text-only local analysis; no reliable page coordinates were available."];
  const notes: string[] = [];
  const left = lines.filter((line) => line.x < 0.42 && line.right < 0.62).length;
  const right = lines.filter((line) => line.x > 0.48).length;
  if (left >= 3 && right >= 3) notes.push("The page contains multiple horizontal regions or columns.");
  if (hasWordBank) notes.push(wordCount ? `A word-bank region with ${wordCount} readable terms was detected.` : "A word-bank region was detected, but its terms were not read reliably.");
  notes.push(`OCR regions were reconstructed into ${lines.length} physical lines from ${originalBlockCount || lines.length} detected regions.`);
  return notes.slice(0, 4);
}

function extractTitle(lines: PhysicalLine[], type: ExerciseType) {
  const taskWords = /fill|blank|choice|match|true|false|unscramble|translation|reading|sentence|conditional|exercise|practice/i;
  const candidate = lines.find((line) => line.y < 0.38 && numberedValue(line.text) === null && line.text.length >= 4 && line.text.length <= 110 && taskWords.test(line.text));
  return candidate?.text || defaults[type].title;
}

function extractInstructions(lines: PhysicalLine[], type: ExerciseType, title: string) {
  const startsLikeInstruction = /^\s*(fill|complete|choose|circle|select|match|mark|write|read|translate|use|unscramble|rearrange)\b/i;
  const titleNorm = title.replace(/\s+/g, " ").trim().toLowerCase();
  const candidates = lines.filter((line) => {
    const normalized = line.text.replace(/\s+/g, " ").trim();
    return numberedValue(normalized) === null
      && normalized.length >= 10
      && normalized.length <= 220
      && normalized.toLowerCase() !== titleNorm
      && startsLikeInstruction.test(normalized);
  });
  const firstLine = candidates[0];
  if (!firstLine) return defaults[type].instructions;

  const index = lines.indexOf(firstLine);
  const next = lines[index + 1];
  if (next) {
    const nextNorm = next.text.replace(/\s+/g, " ").trim();
    if (numberedValue(nextNorm) === null
      && nextNorm.length < 100
      && next.y - firstLine.y < 0.055
      && nextNorm.toLowerCase() !== titleNorm
      && !startsLikeInstruction.test(nextNorm)) {
      return `${firstLine.text} ${nextNorm}`.replace(/\s+/g, " ").trim();
    }
  }
  return firstLine.text;
}

function countQuestions(numberedLines: PhysicalLine[], candidateLines: PhysicalLine[]) {
  if (numberedLines.length) return clamp(numberedLines.length, 1, 30);
  return clamp(candidateLines.length || 8, 1, 30);
}

export function fallbackAnalyze(text: string, layout: DocumentLayoutBlock[] = []): ExerciseAnalysis {
  const physicalLines = layout.length ? reconstructPhysicalLines(layout) : textLines(text);
  const reconstructedText = physicalLines.map((line) => line.text).join("\n");
  const semanticText = `${text}\n${reconstructedText}`;
  const low = semanticText.toLowerCase();
  const numberedLines = selectQuestionSequence(physicalLines);
  const bank = detectWordBank(physicalLines, numberedLines);
  const typeDecision = chooseType({ text: semanticText, lines: physicalLines, numberedLines, hasWordBank: bank.hasWordBank });
  const type = typeDecision.type;

  const candidateLines = numberedLines.length
    ? numberedLines
    : physicalLines.filter((line) => blankCount(line) > 0 || /\?$/.test(line.text));
  const questionCount = countQuestions(numberedLines, candidateLines);

  const questions = candidateLines.slice(0, 30).map((line, index) => {
    const number = numberedValue(line.text) || index + 1;
    const withoutNumber = line.text.replace(/^\s*\d{1,2}[.)]\s*/, "").trim();
    return {
      number,
      textPattern: withoutNumber,
      blankCount: blankCount(line),
      optionCount: optionLabelCount(line.text)
    };
  });

  const winnerStrength = clamp(typeDecision.bestScore / 14, 0, 1);
  const marginStrength = clamp((typeDecision.bestScore - typeDecision.secondScore) / 8, 0, 1);
  const coverage = questionCount > 0 ? clamp(questions.length / questionCount, 0, 1) : 0;
  const sequenceEvidence = numberedLines.length >= 3 ? 1 : 0;
  let confidence = 0.34 + winnerStrength * 0.28 + marginStrength * 0.14 + coverage * 0.14 + sequenceEvidence * 0.08;

  if (type === "custom" || typeDecision.bestScore < 4) confidence = Math.min(confidence, 0.55);
  if (type === "multiple_choice" && typeDecision.optionLabels < 2) confidence = Math.min(confidence, 0.52);
  if (type === "fill_in_the_blanks" && typeDecision.blankQuestionLines === 0 && typeDecision.explicitBlanks < 2 && !/fill in(?: the)? (?:blanks?|gaps?)/.test(low)) {
    confidence = Math.min(confidence, 0.58);
  }
  if (questionCount >= 3 && coverage < 0.65) confidence = Math.min(confidence, 0.64);
  if (bank.hasWordBank && bank.words.length < 3) confidence = Math.min(confidence, 0.72);

  const config = defaults[type];
  const title = extractTitle(physicalLines, type);
  return {
    exerciseType: type,
    title,
    instructions: extractInstructions(physicalLines, type, title),
    questionCount,
    answerFormat: config.format,
    hasWordBank: bank.hasWordBank,
    wordBankWords: bank.words,
    confidence: clamp(confidence, 0.2, 0.92),
    layoutNotes: detectLayoutNotes(physicalLines, layout.length, bank.hasWordBank, bank.words.length),
    questions
  };
}
