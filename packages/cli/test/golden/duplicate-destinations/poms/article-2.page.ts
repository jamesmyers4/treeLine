import { Page, Locator } from '@playwright/test'

export class Article2Page {
  readonly page: Page
  readonly backToBlogLink: Locator

  constructor(page: Page) {
    this.page = page
    this.backToBlogLink = page.getByRole("link", { name: "Back to Blog" })
  }

  async goto(): Promise<void> {
    await this.page.goto("http://127.0.0.1:45568/article-2")
  }
}
