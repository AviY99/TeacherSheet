# TeacherSheet V1 — Validation Matrix

This matrix validates only the current V1 scope:
1. source intake,
2. exercise-structure recognition,
3. first structural worksheet draft.

It intentionally does not validate vocabulary generation, answer keys, final export, or other later product stages.

## Automated structure families

Every build should cover at least these families:

| Family | Required recognition | Key structural checks |
| --- | --- | --- |
| Fill in the blanks | `fill_in_the_blanks` | question sequence, blanks, optional word bank |
| Multiple choice | `multiple_choice` | real option evidence, option count |
| Matching | `matching` | pair/column evidence |
| True / False | `true_false` | T/F structure |
| Unscramble | `unscramble` | item sequence |
| Translation | `translation` | open-answer structure |
| Reading comprehension | `reading_comprehension` | passage + questions |
| Sentence writing | `sentence_writing` | open-answer item structure |
| Mixed / custom | `custom` or low-confidence review | do not force a wrong known type |

## Real worksheet battery

Use real teacher/worksheet images for these cases. Do not tune the analyzer to individual examples; failures should be grouped by capability.

1. Clean scan, single exercise, no word bank.
2. Clean scan with word bank.
3. Multiple choice with A/B/C/D options.
4. Matching / two-column layout.
5. True/False.
6. Reading passage followed by questions.
7. Two exercises on one page.
8. Worksheet with decorative header/logo/footer.
9. Camera photo with perspective/skew.
10. Low-light or mildly blurred phone photo.
11. Screenshot containing surrounding phone/browser UI.
12. Long exercise (15–30 items).

## Per-sample scorecard

For every real sample record:

- Input route: camera / image / PDF / DOCX.
- Engine used.
- Total processing time and OCR time.
- Exercise type: correct / wrong / uncertain.
- Question count: expected vs detected.
- Question coverage: complete / partial / missing lines.
- Word bank/options: detected and contents preserved when present.
- Extraneous content: footer, neighboring worksheet, browser chrome, thumbnails, etc.
- Draft fidelity: order, blanks/options, line grouping, layout.
- Confidence behavior: high only when structure is internally consistent; otherwise ChatGPT review should be offered.

## Release gate for V1 recognition

A candidate recognition build should not be considered stable until:

- no systematic type-confusion is seen across the main exercise families;
- question count is correct or within one item on at least 90% of clean samples;
- detected word banks/options are not replaced with placeholders;
- unrelated footer/thumbnail/neighboring-page content is not appended to the main exercise;
- low-quality or ambiguous samples reduce confidence instead of producing a confident wrong draft;
- the mobile comparison UI remains usable in both directions with zoom/pan;
- processing time is recorded for every image/PDF OCR run.

## Failure classification

When a sample fails, classify it before changing code:

- **OCR extraction** — text was not read correctly.
- **Line reconstruction** — OCR fragments were read but grouped incorrectly.
- **Region segmentation** — word bank/options/footer/second exercise boundaries were wrong.
- **Exercise classification** — reconstructed structure was good but exercise type was wrong.
- **Confidence calibration** — output was wrong yet confidence remained high.
- **Draft rendering** — analysis was correct but the structural preview was wrong.
- **Gesture/UI** — source-vs-structure comparison interaction failed.

Fix the capability class, not the individual worksheet.
