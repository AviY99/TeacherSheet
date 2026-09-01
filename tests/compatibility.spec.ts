import { expect, test } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2lNwAAAAASUVORK5CYII=",
  "base64"
);

async function decodeText(page: any, value: string) {
  await page.goto("/");
  await page.getByPlaceholder("הדבק כאן טקסט של תרגיל...").fill(value);
  await page.getByRole("button", { name: "פענח טקסט מקומית" }).click();
  await expect(page.getByRole("heading", { name: "זה המבנה שמצאנו" })).toBeVisible();
}

test("core UI loads and baseline WebAssembly is available", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "איך תרצה להציג את דף התרגול?" })).toBeVisible();
  await expect(page.getByRole("button", { name: /צלם דף/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /תמונה/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /PDF/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Word/ })).toBeVisible();

  const wasm = await page.evaluate(() => {
    if (typeof WebAssembly === "undefined") return false;
    return WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0]));
  });
  expect(wasm).toBe(true);
});

test("typed-text decoding works without any browser-specific API", async ({ page }) => {
  await decodeText(page,
    "Fill in the blanks.\n1. I ____ to school every day.\n2. She ____ English.\n3. They ____ football."
  );
});

test("word-list instructions do not turn a blank exercise into multiple choice", async ({ page }) => {
  await decodeText(page,
    "Fill in the blanks. Choose the correct word from the list provided.\n1. We ____ home early.\n2. She ____ the door.\n3. They ____ the game.\nword list: leave, close, win"
  );
  await expect(page.getByLabel("סוג התרגיל")).toHaveValue("fill_in_the_blanks");
});

test("recognized word banks keep source terms instead of placeholder words", async ({ page }) => {
  await decodeText(page,
    "Fill in the blanks. Use the words from the word bank.\n1. Last winter was ____.\n2. You can see the ____ at night.\n3. My dad reads the ____ every day.\nWord bank: cold, moon, newspaper, glasses, gift, turn on"
  );
  const bank = page.locator(".word-bank-structural").first();
  await expect(bank).toContainText("cold");
  await expect(bank).toContainText("moon");
  await expect(bank).toContainText("newspaper");
  await expect(page.getByText(/זוהו במחסן:/)).toContainText("6");
});

test("question numbering restart is treated as a separate sequence", async ({ page }) => {
  await decodeText(page,
    "Fill in the blanks.\n1. First ____.\n2. Second ____.\n3. Third ____.\n1. Unrelated preview item ____"
  );
  await expect(page.getByLabel("מספר שאלות")).toHaveValue("3");
});

test("multiple choice requires real option evidence", async ({ page }) => {
  await decodeText(page,
    "Multiple choice. Choose the correct answer.\n1. Which word fits?\nA. run\nB. runs\nC. running\n2. Pick the best form.\nA. go\nB. goes\nC. going"
  );
  await expect(page.getByLabel("סוג התרגיל")).toHaveValue("multiple_choice");
});

test("matching is recognized from matching instructions", async ({ page }) => {
  await decodeText(page,
    "Matching. Match each word with the correct definition.\n1. enormous\n2. tiny\n3. ancient\nA. very old\nB. very large\nC. very small"
  );
  await expect(page.getByLabel("סוג התרגיל")).toHaveValue("matching");
});

test("true false is recognized", async ({ page }) => {
  await decodeText(page,
    "True / False. Mark each sentence True or False.\n1. The sun is a star.\n2. Water freezes at 0C.\n3. Cats are plants."
  );
  await expect(page.getByLabel("סוג התרגיל")).toHaveValue("true_false");
});

test("unscramble is recognized", async ({ page }) => {
  await decodeText(page,
    "Unscramble the words.\n1. loohcs\n2. rehcaet\n3. koob"
  );
  await expect(page.getByLabel("סוג התרגיל")).toHaveValue("unscramble");
});

test("translation is recognized", async ({ page }) => {
  await decodeText(page,
    "Translation. Translate the following sentences into English.\n1. שלום עולם\n2. אני תלמיד\n3. זה ספר"
  );
  await expect(page.getByLabel("סוג התרגיל")).toHaveValue("translation");
});

test("reading comprehension is recognized", async ({ page }) => {
  await decodeText(page,
    "Reading comprehension. Read the text and answer the questions.\nTom lives near the sea. He walks to school every morning.\n1. Where does Tom live?\n2. How does he go to school?\n3. When does he walk to school?"
  );
  await expect(page.getByLabel("סוג התרגיל")).toHaveValue("reading_comprehension");
});

test("sentence writing is recognized", async ({ page }) => {
  await decodeText(page,
    "Sentence writing. Write a sentence for each word.\n1. beautiful\n2. quickly\n3. because"
  );
  await expect(page.getByLabel("סוג התרגיל")).toHaveValue("sentence_writing");
});

test("comparison gesture switches in both directions", async ({ page }) => {
  await decodeText(page,
    "Fill in the blanks.\n1. I ____ home.\n2. She ____ English.\n3. They ____ football."
  );

  const sourcePane = page.locator(".comparison-source-pane");
  const structurePane = page.locator(".comparison-structure-pane");
  const sourceGesture = sourcePane.locator(".gesture-viewport");
  const structureGesture = structurePane.locator(".gesture-viewport");

  await expect(sourcePane).toHaveClass(/is-mobile-active/);
  await expect(structurePane).not.toHaveClass(/is-mobile-active/);

  const sourceBox = await sourceGesture.boundingBox();
  expect(sourceBox).not.toBeNull();
  if (sourceBox) {
    const y = sourceBox.y + Math.min(120, sourceBox.height / 2);
    await sourceGesture.dispatchEvent("pointerdown", { pointerId: 1, pointerType: "touch", clientX: sourceBox.x + sourceBox.width * 0.78, clientY: y, button: 0 });
    await sourceGesture.dispatchEvent("pointermove", { pointerId: 1, pointerType: "touch", clientX: sourceBox.x + sourceBox.width * 0.20, clientY: y, button: 0 });
    await sourceGesture.dispatchEvent("pointerup", { pointerId: 1, pointerType: "touch", clientX: sourceBox.x + sourceBox.width * 0.20, clientY: y, button: 0 });
  }
  await expect(structurePane).toHaveClass(/is-mobile-active/);

  const structureBox = await structureGesture.boundingBox();
  expect(structureBox).not.toBeNull();
  if (structureBox) {
    const y = structureBox.y + Math.min(120, structureBox.height / 2);
    await structureGesture.dispatchEvent("pointerdown", { pointerId: 2, pointerType: "touch", clientX: structureBox.x + structureBox.width * 0.22, clientY: y, button: 0 });
    await structureGesture.dispatchEvent("pointermove", { pointerId: 2, pointerType: "touch", clientX: structureBox.x + structureBox.width * 0.80, clientY: y, button: 0 });
    await structureGesture.dispatchEvent("pointerup", { pointerId: 2, pointerType: "touch", clientX: structureBox.x + structureBox.width * 0.80, clientY: y, button: 0 });
  }
  await expect(sourcePane).toHaveClass(/is-mobile-active/);
});

test("image-file intake reaches preview using standard File APIs", async ({ page }) => {
  await page.goto("/");
  const imageInput = page.locator('input[type="file"][accept*="image/jpeg"]');
  await imageInput.setInputFiles({ name: "worksheet.png", mimeType: "image/png", buffer: tinyPng });
  await expect(page.getByRole("heading", { name: "תמונה נקלט" })).toBeVisible();
  await expect(page.getByText("worksheet.png", { exact: true })).toBeVisible();
});
