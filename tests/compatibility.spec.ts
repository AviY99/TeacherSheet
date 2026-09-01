import { expect, test } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2lNwAAAAASUVORK5CYII=",
  "base64"
);

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
  await page.goto("/");
  await page.getByPlaceholder("הדבק כאן טקסט של תרגיל...").fill(
    "Fill in the blanks.\n1. I ____ to school every day.\n2. She ____ English.\n3. They ____ football."
  );
  await page.getByRole("button", { name: "פענח טקסט מקומית" }).click();
  await expect(page.getByRole("heading", { name: "זה המבנה שמצאנו" })).toBeVisible();
});

test("word-list instructions do not turn a blank exercise into multiple choice", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("הדבק כאן טקסט של תרגיל...").fill(
    "Fill in the blanks. Choose the correct word from the list provided.\n1. We ____ home early.\n2. She ____ the door.\n3. They ____ the game.\nword list: leave, close, win"
  );
  await page.getByRole("button", { name: "פענח טקסט מקומית" }).click();
  await expect(page.getByLabel("סוג התרגיל")).toHaveValue("fill_in_the_blanks");
});

test("multiple choice requires real option evidence", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("הדבק כאן טקסט של תרגיל...").fill(
    "Multiple choice. Choose the correct answer.\n1. Which word fits?\nA. run\nB. runs\nC. running\n2. Pick the best form.\nA. go\nB. goes\nC. going"
  );
  await page.getByRole("button", { name: "פענח טקסט מקומית" }).click();
  await expect(page.getByLabel("סוג התרגיל")).toHaveValue("multiple_choice");
});

test("image-file intake reaches preview using standard File APIs", async ({ page }) => {
  await page.goto("/");
  const imageInput = page.locator('input[type="file"][accept*="image/jpeg"]');
  await imageInput.setInputFiles({ name: "worksheet.png", mimeType: "image/png", buffer: tinyPng });
  await expect(page.getByRole("heading", { name: "תמונה נקלט" })).toBeVisible();
  await expect(page.getByText("worksheet.png", { exact: true })).toBeVisible();
});
