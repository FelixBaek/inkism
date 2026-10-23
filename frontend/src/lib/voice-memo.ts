// 모바일 "음성 메모": 새 노트를 만든 뒤 처음 뜨는 서식 편집기가 녹음 블록을 넣는다.
let requestedAt = 0;
export function requestVoiceMemo() {
  requestedAt = Date.now();
}
/** 5초 안에 요청이 있었으면 한 번만 true. */
export function takeVoiceMemo() {
  const fresh = Date.now() - requestedAt < 5000;
  requestedAt = 0;
  return fresh;
}
