import { expect, test, type Page } from "@playwright/test";

const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2lNwAAAAASUVORK5CYII=",
  "base64"
);

async function decodeText(page: Page, value: string) {
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

test("recognized word banks keep source terms and wrapped phrases", async ({ page }) => {
  await decodeText(page,
    "Fill in the blanks. Use the words from the word bank.\n1. Last winter was ____.\n2. You can see the ____ at night.\n3. My dad reads the ____ every day.\nWord bank: cold, moon, newspaper, glasses, gift, ice\ncream, turn on"
  );
  const bank = page.locator(".word-bank-structural").first();
  await expect(bank).toContainText("cold");
  await expect(bank).toContainText("moon");
  await expect(bank).toContainText("newspaper");
  await expect(bank).toContainText("ice cream");
  await expect(bank).toContainText("turn on");
  await expect(page.getByText(/זוהו במחסן:/)).toContainText("7");
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

test("pinch zoom follows the focal point and remains pannable", async ({ page }) => {
  await decodeText(page,
    "Fill in the blanks.\n1. I ____ home.\n2. She ____ English.\n3. They ____ football."
  );

  const viewport = page.locator(".comparison-source-pane .gesture-viewport");
  const content = page.locator(".comparison-source-pane .gesture-content");
  const box = await viewport.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const y = box.y + box.height * 0.24;
  const x1 = box.x + box.width * 0.12;
  const x2 = box.x + box.width * 0.28;
  await viewport.dispatchEvent("pointerdown", { pointerId: 11, pointerType: "touch", clientX: x1, clientY: y, button: 0 });
  await viewport.dispatchEvent("pointerdown", { pointerId: 12, pointerType: "touch", clientX: x2, clientY: y, button: 0 });
  await viewport.dispatchEvent("pointermove", { pointerId: 11, pointerType: "touch", clientX: box.x + box.width * 0.06, clientY: y, button: 0 });
  await viewport.dispatchEvent("pointermove", { pointerId: 12, pointerType: "touch", clientX: box.x + box.width * 0.38, clientY: y, button: 0 });

  const zoomedStyle = await content.getAttribute("style");
  expect(zoomedStyle).toMatch(/scale\((?:1\.[4-9]|[2-4])/);
  const translateMatch = zoomedStyle?.match(/translate3d\((-?[\d.]+)px,\s*(-?[\d.]+)px/);
  expect(translateMatch).not.toBeNull();
  if (translateMatch) {
    const x = Number(translateMatch[1]);
    // The pinch is near the left edge, so a focal zoom should translate much
    // less than a centre-based zoom at the same scale.
    expect(Math.abs(x)).toBeLessThan(box.width * 0.65);
  }

  await viewport.dispatchEvent("pointerup", { pointerId: 12, pointerType: "touch", clientX: box.x + box.width * 0.38, clientY: y, button: 0 });
  const beforePan = await content.getAttribute("style");
  await viewport.dispatchEvent("pointermove", { pointerId: 11, pointerType: "touch", clientX: box.x + box.width * 0.16, clientY: y + 35, button: 0 });
  const afterPan = await content.getAttribute("style");
  expect(afterPan).not.toBe(beforePan);
  await viewport.dispatchEvent("pointerup", { pointerId: 11, pointerType: "touch", clientX: box.x + box.width * 0.16, clientY: y + 35, button: 0 });
});

test("image-file intake reaches preview using standard File APIs", async ({ page }) => {
  await page.goto("/");
  const imageInput = page.locator('input[type="file"][accept*="image/jpeg"]');
  await imageInput.setInputFiles({ name: "worksheet.png", mimeType: "image/png", buffer: tinyPng });
  await expect(page.getByRole("heading", { name: "תמונה נקלט" })).toBeVisible();
  await expect(page.getByText("worksheet.png", { exact: true })).toBeVisible();
});
