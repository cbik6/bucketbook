import { type Page, expect, test } from "@playwright/test";

/**
 * People: the admin invites a viewer, who joins through the link, sees the
 * book read-only, and has no admin pages.
 */

async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByLabel("Email").fill("pat@example.test");
  await page.getByLabel("Password").fill("a long test password");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();
}

test("people: invite a viewer who joins with the link", async ({ page, browser }) => {
  await signIn(page);
  await page.getByRole("link", { name: "People" }).filter({ visible: true }).first().click();
  await expect(page.getByRole("heading", { name: "People", exact: true })).toBeVisible();

  await page.getByLabel("Name", { exact: true }).fill("Jo Viewer");
  await page.getByLabel("Email", { exact: true }).fill("jo@example.test");
  await page.getByLabel("Example Family", { exact: true }).first().selectOption("viewer");
  await page.getByRole("button", { name: "Make invite link" }).click();
  const linkBox = page.getByLabel("Send this link to Jo Viewer");
  await expect(linkBox).toBeVisible();
  const link = new URL(await linkBox.inputValue());
  await expect(page.getByRole("heading", { name: "Waiting to join" })).toBeVisible();

  // Jo opens the link in their own browser.
  const jo = await (await browser.newContext()).newPage();
  await jo.goto(link.pathname);
  await expect(jo.getByRole("heading", { name: "Join Bucketbook" })).toBeVisible();
  await expect(jo.getByLabel("Email")).toHaveValue("jo@example.test");
  await jo.getByLabel("Choose a password").fill("another long password");
  await jo.getByRole("button", { name: "Join and open the books" }).click();
  await expect(jo.getByRole("heading", { name: "Chart of accounts" })).toBeVisible();

  // A viewer has no admin links, and admin pages don't exist for them.
  await expect(jo.getByRole("link", { name: "People" })).toHaveCount(0);
  await expect(jo.getByRole("link", { name: "Bank connections" })).toHaveCount(0);
  await jo.goto("/people");
  await expect(jo.getByRole("heading", { name: "People", exact: true })).toHaveCount(0);

  // The link only works once.
  await jo.goto(link.pathname);
  await expect(jo.getByRole("heading", { name: "This link doesn't work" })).toBeVisible();

  // The admin now sees Jo with a login.
  await page.reload();
  await expect(page.getByText("jo@example.test")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Waiting to join" })).toHaveCount(0);
});
