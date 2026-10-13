// 라이브러리 도구(캔버스·전체 검색·작성 도구 등)는 노트 메뉴 → "라이브러리 도구" 패널 안에 있다.
import type { Page } from 'playwright-core';

/** 상단 경로 바(좁은 화면은 머리줄)의 노트 메뉴 항목: 분할 편집 열기, 명령창 열기, 라이브러리 도구 등. */
export async function noteMenu(page: Page, item: string) {
  await page.locator('button[aria-label="노트 메뉴"]:visible').first().click();
  await page.getByRole('menuitem', { name: item, exact: true }).click();
}

export async function openLibraryTools(page: Page) {
  const panel = page.locator('.library-tools');
  if (await panel.evaluate(el => el.classList.contains('is-open'))) return panel;
  await noteMenu(page, '라이브러리 도구');
  await panel.and(page.locator('.is-open')).waitFor();
  return panel;
}

export async function libraryTool(page: Page, name: string) {
  const panel = await openLibraryTools(page);
  await panel.getByRole('button', { name, exact: true }).click();
}
