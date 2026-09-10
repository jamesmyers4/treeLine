import { Page, Locator } from '@playwright/test'

export class HomePage {
  readonly page: Page
  readonly readMoreLinkArticle1: Locator
  readonly readMoreLinkArticle2: Locator

  constructor(page: Page) {
    this.page = page
    this.readMoreLinkArticle1 = page.getByRole("link", { name: "Read more" }).nth(0)
    this.readMoreLinkArticle2 = page.getByRole("link", { name: "Read more" }).nth(1)
  }

  async goto(): Promise<void> {
    await this.page.goto("http://127.0.0.1:17723/")
  }
}
