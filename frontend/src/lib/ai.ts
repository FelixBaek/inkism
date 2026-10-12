import {completeAI} from "./ai-provider";
/** 편집기 AI 요청의 단일 진입점. 설정한 모델에 요청하고 결과는 미리보기에서 확인한다. */
import { t } from "../i18n";
export type AiAction =
  | "prompt"
  | "polish"
  | "spelling"
  | "shorter"
  | "longer"
  | "tone"
  | "translate"
  | "continue"
  | "summarize"
  | "todos"
  | "block";

export interface AiInput {
  /** 대상 글(고른 글, 없으면 노트 전체 글자) */
  selection?: string;
  /** 직접 적은 요청, 말투·언어 같은 세부 선택 */
  prompt?: string;
}

/** AI 결과 미리보기(바꾸기 · 아래에 넣기 · 다시 · 버리기)가 받는 값. */
export interface AiResult {
  action: AiAction;
  title: string;
  text: string;
  input: AiInput;
}

export const AI_LABELS: Record<AiAction, string> = {
  prompt: t("AI 요청"),
  polish: t("문장 다듬기"),
  spelling: t("맞춤법·띄어쓰기 고치기"),
  shorter: t("더 짧게"),
  longer: t("더 길게"),
  tone: t("말투 바꾸기"),
  translate: t("번역하기"),
  continue: t("이어 쓰기"),
  summarize: t("요약하기"),
  todos: t("할 일 뽑기"),
  block: t("AI 블록"),
};

type Notice = (title: string, message: string) => Promise<void>;

/** 안내를 띄울 곳(앱 대화상자). 편집기 툴바가 마운트될 때 등록한다 — AI 블록처럼 store 밖에서 부를 때 쓴다. */
let registeredNotice: Notice | null = null;
export function registerAiNotice(notice: Notice | null) {
  registeredNotice = notice;
}

/** Existing preview UI remains the acceptance boundary; no automatic replacement. */
export async function requestAi(action: AiAction, input: AiInput, notice?: Notice): Promise<AiResult | null> {
  try {const text=await completeAI(AI_LABELS[action]+(input.prompt?'\n'+input.prompt:''),input.selection??'');return {action,title:AI_LABELS[action],text,input};}
  catch(error){await (notice??registeredNotice)?.(AI_LABELS[action],error instanceof Error?error.message:String(error));return null;}
}
