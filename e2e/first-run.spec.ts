import { expect, test } from "@playwright/test";

/**
 * The Phase 1 happy path on a brand-new install: setup wizard, first book from
 * a template, then working with the chart of accounts.
 */
test("first run: create the owner and a book, then manage the chart of accounts", async ({
  page,
}) => {
  // A new install sends everyone to the setup wizard.
  await page.goto("/");
  await expect(page).toHaveURL(/\/setup$/);
  await expect(page.getByRole("heading", { name: /welcome to/i })).toBeVisible();

  // Step 1: owner login.
  await page.getByLabel("Your name").fill("Pat Example");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Password", { exact: true }).fill("a long test password");
  await page.getByRole("button", { name: "Create login and continue" }).click();

  // Step 2: first book from the Household template.
  await expect(page.getByRole("heading", { name: "Start your first book" })).toBeVisible();
  await page.getByLabel("Book name").fill("Example Family");
  await page.getByText("Household", { exact: true }).click();
  await page.getByLabel("Start date").fill("2026-01-01");
  await page.getByRole("button", { name: "Create book and continue" }).click();

  // Step 3: bank connection is "connect later" in Phase 1.
  await expect(page.getByRole("heading", { name: "Connect your bank" })).toBeVisible();
  await page.getByRole("button", { name: /connect later/i }).click();

  // The chart of accounts shows the template, nested.
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
  await expect(page.getByText("Your book is ready.")).toBeVisible();
  const expenses = page.getByRole("region", { name: /^Expenses/ });
  await expect(expenses.getByRole("link", { name: "Groceries", exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Opening Balance Equity", exact: true }),
  ).toBeVisible();

  // Add a nested account with the keyboard shortcut.
  await page.keyboard.press("n");
  const panel = page.getByRole("complementary", { name: "New account" });
  await expect(panel.getByRole("heading", { name: "New account" })).toBeVisible();
  await panel.getByLabel("Name").fill("Pet Food");
  const parent = panel.getByLabel("Sub-account of");
  const foodOption = await parent.locator("option", { hasText: /^\s*Food$/ }).getAttribute("value");
  await parent.selectOption(foodOption!);
  await panel.getByRole("button", { name: "Create account" }).click();

  const petFood = expenses.getByRole("link", { name: "Pet Food", exact: true });
  await expect(petFood).toBeVisible();
  await expect(panel).toHaveCount(0);

  // Archive it with press-and-hold, then find it under "Show archived".
  await petFood.click();
  const editPanel = page.getByRole("complementary", { name: "Edit Pet Food" });
  const archive = editPanel.getByRole("button", { name: /Archive account/ });
  await archive.hover();
  await page.mouse.down();
  await page.waitForTimeout(1600);
  await page.mouse.up();
  await expect(page.getByText("Pet Food archived")).toBeVisible();
  await expect(expenses.getByRole("link", { name: "Pet Food", exact: true })).toHaveCount(0);

  await page.getByRole("link", { name: "Show archived" }).click();
  await expect(expenses.getByRole("link", { name: "Pet Food", exact: true })).toBeVisible();
  await expect(expenses.getByText("Archived", { exact: true })).toBeVisible();

  // Sign out, then sign back in.
  await page.getByRole("button", { name: "Sign out" }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Password").fill("a long test password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();

  // The wizard is closed for good once setup is complete.
  await page.goto("/setup");
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
});
