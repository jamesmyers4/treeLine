import { test, expect } from '@playwright/test'
import { Article1Page } from './article-1.page'

test('Article1Page loads', async ({ page }) => {
  const article1Page = new Article1Page(page)
  await article1Page.goto()
  await expect(page).toHaveURL("http://127.0.0.1:45568/article-1")
})
