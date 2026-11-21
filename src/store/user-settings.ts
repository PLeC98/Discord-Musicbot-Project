// 사람별 설정(users.db의 user_settings). 사람마다 JSON 문서 하나, 디스코드의 모든 서버, DM, 대시보드가 같이 쓴다.
// 필드마다 따로 검증하고 틀린 필드만 버린다. 쓰기는 update 한 곳에서 한 트랜잭션으로 하고, 읽은 값은 메모리에 담아 두고, 바뀌면 리스너에 알린다(store/guild-settings와 같은 모양)

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "user" });
import { z } from "zod";
import { usersDb } from "./users-db.ts";
import { codeOf } from "../rules/error-kind.ts";
import { KNOWN_TAGS, type Language } from "../rules/languages.ts";

const conn = () => usersDb.get();

/** 개인 언어: 언어 태그, 직접 고른 자동("auto"). 정한 적 없으면 필드가 없다 */
type UserLanguage = Language | "auto";

// 사람별 설정 문서. 틀린 필드는 정하지 않은 것으로 읽는다(언어를 뺀 뒤 남은 값 등)
const FIELDS = {
  language: z.enum(["auto", ...KNOWN_TAGS]),
};
type UserDoc = { language?: UserLanguage };
type UserField = keyof UserDoc;
const USER_FIELDS = Object.keys(FIELDS) as UserField[];

// 이미 알린 틀린 문서(사람, 내용)
const warned = new Set<string>();

// 문서를 읽어 필드마다 맞춘다. 틀린 필드는 버리고 한 줄 남긴다
function shapeOf(userId: string, raw: string): UserDoc {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    if (!warned.has(`${userId}|${raw}`)) log.warn(`사용자 ${userId} 설정 읽기 실패(정하지 않은 것으로 읽음): 올바른 JSON 형식이 아님`);
    warned.add(`${userId}|${raw}`);
    return {};
  }
  const source = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  const doc: Record<string, unknown> = {};
  const wrong: string[] = [];
  for (const [key, schema] of Object.entries(FIELDS)) {
    if (source[key] === undefined) continue;
    const checked = schema.safeParse(source[key]);
    if (checked.success) doc[key] = checked.data;
    else wrong.push(key);
  }
  const key = `${userId}|${raw}`;
  if (wrong.length && !warned.has(key)) {
    warned.add(key);
    log.warn(`사용자 ${userId} 설정의 ${wrong.join(", ")} 값 검증 실패(정하지 않은 것으로 읽음)`);
  }
  return doc as UserDoc;
}

function readDoc(userId: string): UserDoc {
  const row = conn().prepare("SELECT data_json FROM user_settings WHERE user_id = ?").get(userId) as { data_json: string } | undefined;
  return row ? shapeOf(userId, row.data_json) : {};
}

// 필드가 모두 비면 행을 지운다(빈 문서를 남기지 않는다)
function writeDoc(userId: string, doc: UserDoc) {
  if (!Object.keys(doc).length) {
    conn().prepare("DELETE FROM user_settings WHERE user_id = ?").run(userId);
    return;
  }
  conn()
    .prepare(
      `INSERT INTO user_settings (user_id, data_json) VALUES (?, ?)
       ON CONFLICT(user_id) DO UPDATE SET data_json = excluded.data_json`,
    )
    .run(userId, JSON.stringify(doc));
}

/** update에 넘기는 패치. 빠진 필드는 그대로, null이면 그 필드를 지운다(정한 적 없음으로) */
type UserPatch = { language?: UserLanguage | null };

// 사람마다 읽어 둔 문서
const cache = new Map<string, UserDoc>();

/** 읽어 둔 것을 버린다. 표를 통째로 바꾼 뒤(초기화, 테스트가 임시 DB에 바로 쓴 뒤) */
function forgetCache() {
  cache.clear();
}

type ChangeListener = (userId: string, fields: UserField[]) => void;
const listeners = new Set<ChangeListener>();

/** 사람별 설정이 바뀌어 커밋된 뒤 부를 리스너를 붙인다. 리스너의 오류는 저장에 번지지 않는다. 떼는 함수를 돌려준다 */
function onChanged(fn: ChangeListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function announce(userId: string, fields: UserField[]) {
  if (!fields.length) return;
  for (const fn of listeners) {
    try {
      fn(userId, fields);
    } catch (error) {
      log.error("사용자 설정 변경 알림 처리 실패:", error);
    }
  }
}

/** 받은 필드를 한 트랜잭션으로 쓴다. 바뀐 필드를 돌려준다. 실패하면 예외를 던지고 캐시는 건드리지 않는다 */
function update(userId: string, patch: UserPatch): UserField[] {
  const { changed, doc } = conn().transaction(() => {
    const before = readDoc(userId);
    const next: Record<string, unknown> = { ...before };
    for (const field of USER_FIELDS) {
      if (patch[field] === undefined) continue;
      if (patch[field] === null) delete next[field];
      else next[field] = patch[field];
    }
    const changedFields = USER_FIELDS.filter((field) => before[field] !== next[field]);
    if (changedFields.length) writeDoc(userId, next as UserDoc);
    return { changed: changedFields, doc: next as UserDoc };
  })();
  cache.set(userId, doc);
  announce(userId, changed);
  return changed;
}

/**
 * 그 사람의 문서. 재생 패널과 응답을 그릴 때마다 부르므로 메모리에 담는다. DB가 열리지 않았으면 빈 문서(테스트, 스크립트).
 * 못 읽으면 빈 문서로 기억하고 오류 로그를 남긴다(다음에 바꾸면 다시 읽는다). 열기 전에 부른 것이 아니라 조립 순서가 틀렸으면 예외를 던진다
 */
function docOf(userId: string): UserDoc {
  const hit = cache.get(userId);
  if (hit) return hit;
  if (!usersDb.isOpen()) return {};
  let doc: UserDoc = {};
  try {
    doc = readDoc(userId);
  } catch (error) {
    if (codeOf(error) === "DB_NOT_OPEN") throw error;
    log.error("사용자 설정 읽기 실패(정하지 않은 것으로 적용):", error);
  }
  cache.set(userId, doc);
  return doc;
}

/** 개인 언어. 정한 적 없으면 null, 직접 고른 자동이면 "auto" */
function languageOf(userId: string): UserLanguage | null {
  return docOf(userId).language ?? null;
}

/** 개인 언어를 정한다. null이면 정한 적 없음으로 되돌린다. 바뀐 필드를 돌려준다 */
function setLanguage(userId: string, language: UserLanguage | null): UserField[] {
  return update(userId, { language });
}

/** 설정이 있는 사람 수(초기화 카드) */
function userCount(): number {
  return conn().prepare("SELECT COUNT(*) FROM user_settings").pluck().get() as number;
}

/** 모든 사람의 설정을 지운다(사람별 데이터 초기화). 캐시도 비우고, 커밋 뒤 설정이 있던 사람마다 지운 필드를 알린다. 실패하면 예외를 던진다 */
function removeAll() {
  const removed = conn().transaction(() => {
    const rows = conn().prepare("SELECT user_id, data_json FROM user_settings").all() as Array<{ user_id: string; data_json: string }>;
    conn().prepare("DELETE FROM user_settings").run();
    return rows;
  })();
  forgetCache();
  for (const row of removed) announce(row.user_id, Object.keys(shapeOf(row.user_id, row.data_json)) as UserField[]);
}

export { languageOf, setLanguage, update, onChanged, forgetCache, userCount, removeAll };
export type { UserLanguage, UserDoc, UserField, UserPatch };
