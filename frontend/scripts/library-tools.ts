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

// 사이드바·편집기 머리줄에 이미 있는 도구는 라이브러리 도구 패널에 따로 두지 않는다.
const elsewhere: Record<string, (page: Page) => Promise<void>> = {
  '일일 노트': page => page.locator('nav.sidebar').getByRole('button', { name: '오늘의 노트', exact: true }).click(),
  '템플릿': page => page.locator('nav.sidebar').getByRole('button', { name: '템플릿', exact: true }).click(),
  '관계 그래프': page => page.locator('nav.sidebar').getByRole('button', { name: '관계 그래프', exact: true }).click(),
  '목차': page => page.locator('.editor-doc-actions').getByRole('button', { name: '목차', exact: true }).click(),
  // 노트 정보 패널의 [연결 목록과 언급 보기]가 보내는 요청과 같다.
  '속성과 노트 연결': async page => {
    // 앱이 다 뜨기 전에 보내면 받을 곳이 없다.
    await page.locator('button[aria-label="노트 메뉴"]:visible').first().waitFor();
    await page.evaluate(() => { window.dispatchEvent(new CustomEvent('inkism-open-knowledge', { detail: 'note' })); });
    await page.getByRole('dialog', { name: '지식 도구', exact: true }).waitFor();
  },
};

export async function libraryTool(page: Page, name: string) {
  if (elsewhere[name]) return elsewhere[name](page);
  const panel = await openLibraryTools(page);
  await panel.getByRole('button', { name, exact: true }).click();
}
