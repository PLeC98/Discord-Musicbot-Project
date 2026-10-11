// 모델 프로필(config/ai-models)에서 대시보드로 나가는 모양. 화면도 부르므로 Node 를 부르지 않는 여기에 둔다

// showIf: 다른 칸(key)이 이 값(equals)일 때만 보인다
type ShowIf = { key?: string; equals?: unknown };

/** 모델이 받는 칸 하나. 대시보드가 그리고 본문에 넣는다 */
type ModelField = {
  key: string;
  path: string;
  type?: string;
  label?: string;
  enum?: Array<{ value: unknown; label: string }>;
  min?: number;
  max?: number;
  step?: number;
  default?: unknown;
  widget?: string;
  group?: string;
  visibility?: string;
  showIf?: ShowIf;
  order?: number;
};

/** 칸 묶음. 차례대로 그린다 */
type ModelGroup = { id: string; label: string; order: number };

/** 프로필이 아는 모델 하나. 목록에 이름표를 입힐 때 쓴다 */
type ModelSummary = { id: string; modelId: string; name: string; tokenizer: string | null; maxOutputTokens: number | null; contextWindowTokens: number | null; capabilities: string[] };

/** 프로필 갱신의 답. 해시가 같으면 받지 않는다(changed: false) */
type RefreshResult = { changed: boolean; count: number; fetchedAt?: string };

export type { ShowIf, ModelField, ModelGroup, ModelSummary, RefreshResult };
