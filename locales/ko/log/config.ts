// 로그 문구: 설정(config 분류). 기동 때의 설정 검사와 로그 언어 고르기, .env 준비, AI 모델 정보 받기

import { josa } from "../../../src/infra/josa.ts";

const config = {
  /** 적은 LOG_LANGUAGE를 쓸 수 없어 다른 언어로 찍는다. malformed: 언어 태그 형식이 아님(아니면 그 언어의 로그 문구가 없음) */
  logLanguageIgnored: ({ value, malformed, language }: { value: string; malformed: boolean; language: string }) => `LOG_LANGUAGE 무시(${value}): ${malformed ? "언어 태그 형식이 아님" : "그 언어의 로그 문구가 없음"}. 로그 언어: ${language}`,
  tunableInvalid: ({ problem }: { problem: string }) => `운영 설정값 ${problem}. 해당 값은 기본값으로 적용. 운영자 패널에서 수정하세요`,
  tunablesApplyFailed: ({ error }: { error: string }) => `운영 설정값을 저장했지만 적용하지 못한 곳이 있음: ${error}`,
  aiModelInfoLoadFailed: ({ error }: { error: string }) => `AI 모델 정보 불러오기 실패(PocketRisu 레지스트리): ${error}. 기존 정보를 씀`,
  aiPricesLoadFailed: ({ error }: { error: string }) => `AI 가격표 불러오기 실패(models.dev): ${error}. 기존 가격표로 비용 계산`,
  aiModelInfoReadFailed: ({ file, error }: { file: string; error: string }) => `AI 모델 정보 읽기 실패(${file}): ${error}`,
  aiPricesReadFailed: ({ file, error }: { file: string; error: string }) => `AI 가격표 읽기 실패(${file}): ${error}`,
  aiAssistSettings: ({ lines }: { lines: string }) => `AI 보조 설정: ${lines}`,
  /** AI 모델 정보가 우리가 정하는 칸(모델, 프롬프트)을 바꾸려 했다. items: 앞의 몇 개, more: 더 있다 */
  aiModelInfoTouchingOurs: ({ count, items, more }: { count: number; items: string; more: boolean }) => `AI 모델 정보가 모델, 프롬프트 칸을 바꾸려 해 그 값은 쓰지 않음(${count}곳): ${items}${more ? " 등" : ""}`,
  /** AI 모델 정보에서 형식이 맞지 않는 프로필을 뺐다. items: 앞의 몇 개, more: 더 있다 */
  aiModelInfoProfilesSkipped: ({ count, items, more }: { count: number; items: string; more: boolean }) => `AI 모델 정보에서 형식이 맞지 않는 프로필 ${count}개를 빼고 저장: ${items}${more ? " 등" : ""}`,
  /** 자동재생 장르 설정이 잘못됐다. kept: 이전 정상 설정으로 동작한다(아니면 장르가 없다) */
  genresInvalid: ({ error, kept }: { error: string; kept: boolean }) => `${error}\n   ${kept ? "고칠 때까지 이전 정상 설정으로 동작" : "고칠 때까지 자동재생 장르가 없음. 운영자 패널의 자동재생 탭에서 고치세요"}`,
  /** 활동 문구 설정이 잘못됐다. kept: 이전 정상 설정으로 동작한다(아니면 활동 문구를 걸지 않는다) */
  statusInvalid: ({ error, kept }: { error: string; kept: boolean }) => `${error}\n   ${kept ? "고칠 때까지 이전 정상 설정으로 동작" : "고칠 때까지 활동 문구를 걸지 않음. 운영자 패널의 상태 문구 탭에서 고치세요"}`,
  /** AI 모델 정보 레지스트리(PocketRisu)가 HTTP 오류로 답했다. at: 받은 주소 */
  registryHttpFailed: ({ status, at }: { status: number; at: string }) => `레지스트리 ${status}: ${at}`,
  registryNoHash: () => `레지스트리 인덱스에 해시가 없음`,
  /** version: 받은 카탈로그 형식, supported: 읽을 수 있는 형식 */
  registryFormatUnsupported: ({ version, supported }: { version: string; supported: number }) => `지원하지 않는 레지스트리 카탈로그 형식: ${version}(${supported}만 지원)`,
  registryHashMismatch: () => `레지스트리 인덱스와 카탈로그의 해시가 다름(원격에서 갱신 중, 다음에 다시 불러옴)`,
  /** 모델 필드가 통째로 빈 레지스트리. registries: 이름(쉼표로 이음) */
  registryFieldsLost: ({ registries }: { registries: string }) => `${registries}의 모델 필드가 통째로 비어 있음. 원격 형식이 바뀐 것으로 보여 쓰지 않음`,
  pricesHttpFailed: ({ status, source }: { status: number; source: string }) => `값표 ${status}: ${source}`,
  pricesNoneRead: () => `가격표에서 우리 프로바이더의 가격을 하나도 읽지 못함(저쪽 형식이 바뀐 것으로 보여 쓰지 않음)`,
  genreEmpty: ({ name }: { name: string }) => `자동재생 장르 ${name}에 소스와 키워드가 하나도 없음. 운영자 패널의 자동재생 탭에서 확인하세요`,
  /** ownerId: 형식이 틀린 값(쉼표로 여럿), all: 적힌 값이 모두 틀렸다 */
  ownerIdInvalid: ({ ownerId, all }: { ownerId: string; all: boolean }) => `OWNER_ID 값이 디스코드 사용자 ID 형식(17 ~ 20자리 숫자)이 아님(${ownerId}). ${all ? "대시보드 운영자 패널과 /system에 아무도 들어갈 수 없음" : "그 값은 아무와도 맞지 않음"}`,
  envValueInvalid: ({ key, value, reason }: { key: string; value: string; reason: string }) => `.env의 ${key} 값이 잘못됨(${value}): ${reason}. 고친 뒤 다시 실행하세요`,
  tabSettings: () => `일반`,
  tabAppearance: () => `디스플레이`,
  tabYoutube: () => `유튜브`,
  tabUpdate: () => `업데이트`,
  tabAge: () => `연령 제한(일반 탭에서 연령 제한 콘텐츠를 켜면 생긴다)`,
  tabAi: () => `AI 보조`,
  tabDev: () => `개발자 옵션`,
  envFileMissing: () => `.env 파일이 없음. 봇을 실행하면 .env.example로 만들고 비밀 키를 채움. 그 뒤 파일 안의 주석을 참고해 [필수] 값을 채우세요`,
  credentialsMissing: ({ names }: { names: string }) => `비어 있는 필수 값: ${names}. README의 "설정" 절과 .env.example의 주석을 참고해 .env에 채운 뒤 다시 실행하세요.`,
  secretsKeyRemake: ({ command }: { command: string }) => `만들기: ${command}의 출력을 .env의 SECRETS_KEY= 뒤에 넣고 다시 실행하세요. 새 키로는 대시보드에 저장해 둔 비밀값을 복호화하지 못해 다시 입력해야 함`,
  secretsKeyEmpty: ({ remake }: { remake: string }) => `SECRETS_KEY가 비어 있음(비밀값 암호화 키). ${remake}`,
  secretsKeyInvalid: ({ remake }: { remake: string }) => `.env의 SECRETS_KEY가 base64로 인코딩한 32바이트가 아님. ${remake}`,
  envFileMade: ({ names }: { names: string }) => `.env가 없어 .env.example로 만듦(SECRETS_KEY는 채움). ${names} 값을 채운 뒤 실행하세요`,
  genreSourcesDropped: ({ genres, missing }: { genres: string; missing: string }) => `자동재생 장르 ${genres}: ${missing} 키가 없어 그 소스를 빼고 나머지 소스만 사용`,
  genreSourcesNone: ({ genres, missing }: { genres: string; missing: string }) => `자동재생 장르 ${genres}: ${missing} 키가 없어 쓸 소스가 없음. 키를 입력하기 전까지 이 장르는 선택할 수 없음`,
  nodeUnsupported: ({ version, range }: { version: string; range: string }) => `지원 범위 밖의 Node(지금 ${version}, 지원 ${range}). 알려진 보안 취약점이 고쳐진 버전으로 업데이트 필요`,
  /** .env에 적은 운영 설정값 이름(이제 운영자 패널에서 입력). names: 이름(쉼표로 이음), last: 마지막 이름(조사를 고른다), tab: 입력할 탭 */
  envNamesMoved: ({ names, last, tab }: { names: string; last: string; tab: string }) => `.env의 ${names}${josa(last, "은")} 이제 쓰지 않음. 운영자 패널의 ${tab} 탭에서 입력하고 .env에서 삭제하세요`,
  /** .env에 적은, 봇이 읽지 않는 이름. last: 마지막 이름(조사를 고른다) */
  envNamesUnknown: ({ names, last }: { names: string; last: string }) => `.env의 ${names}${josa(last, "은")} 봇이 읽지 않는 이름. 오타이거나 예전 설정이면 .env에서 삭제하세요(쓰는 이름은 .env.example 참고)`,
  /** 우리가 정하는 칸을 바꾸려는 AI 모델 정보의 자리(기본값, 필드) */
  modelDefaultTouched: ({ id, key }: { id: string; key: string }) => `${id} 기본값 ${key}`,
  modelFieldTouched: ({ id, key }: { id: string; key: string }) => `${id} 필드 ${key}`,
  /** 자동재생 장르 설정을 읽지 못했다. problems: 문제(줄마다 들여쓴 글, 줄바꿈으로 이음) */
  genresReadFailed: ({ problems }: { problems: string }) => `자동재생 장르 설정 읽기 실패:\n${problems}`,
  /** 활동 문구 설정을 읽지 못했다. problems: 문제(줄마다 들여쓴 글, 줄바꿈으로 이음) */
  statusReadFailed: ({ problems }: { problems: string }) => `활동 문구 설정 읽기 실패:\n${problems}`,
  aiKeysFileIgnored: () => `config/ai-keys.yaml은 이제 읽지 않음. 운영자 패널의 AI 보조 탭에서 키를 다시 입력하고 이 파일은 삭제하세요`,
  secretsUnavailable: () => `SECRETS_KEY가 없어 비밀값을 다룰 수 없음`,
  secretValueInvalid: ({ name }: { name: string }) => `비밀값 ${name}: 비어 있으면 안 되고 1MB 이하여야 함`,
  secretDecryptFailed: ({ name }: { name: string }) => `비밀값 ${name} 복호화 실패(저장된 행이 변경되었거나 손상됨). 대시보드에서 다시 입력하세요`,
  serviceKeyDecryptFailed: ({ service }: { service: string }) => `${service} 키 복호화 실패(SECRETS_KEY가 변경되었거나 저장된 값이 손상됨). 운영자 패널의 API 키 탭에서 다시 입력하세요`,
  spotifyKeyMissing: () => `Spotify API 키 없음(곡, 앨범 링크는 열지 못하고 재생목록, 아티스트는 키 없이 열 수 있음). 운영자 패널의 API 키 탭에서 입력하세요`,
  serviceKeyFieldsInvalid: ({ service }: { service: string }) => `${service} 키의 필드가 맞지 않음`,
  settingsDocParseFailed: ({ name, error }: { name: string; error: string }) => `설정 문서 ${name}의 JSON 파싱 실패(없는 것으로 처리): ${error}`,
  settingsDocConflict: ({ name, readRevision, currentRevision }: { name: string; readRevision: number; currentRevision: number }) => `${name} 문서가 그사이 바뀜(읽은 번호 ${readRevision}, 지금 ${currentRevision})`,
  settingsDbReadFailed: ({ file, doc, error }: { file: string; doc: string; error: number | string }) => `설정 DB 읽기 실패: ${file}, 문서=${doc} | ${error}`,
  settingsDbQueryFailed: ({ file, doc, error }: { file: string; doc: string; error: number | string }) => `설정 DB 읽기 전용 조회 실패(기본값 사용): ${file}, 문서=${doc} | ${error}`,
  toolCardKeysUnknown: ({ names }: { names: string }) => `도구 카드의 값이 아님: ${names}`,
  toolCardConflict: ({ names }: { names: string }) => `그사이 바뀐 값: ${names}`,
  modelsDownloading: ({ force }: { force: boolean }) => `다운로드 중${force ? " (강제)" : ""}`,
  modelsRefreshed: ({ count }: { count: number }) => `모델 정보를 갱신했습니다. 모델 ${count}개`,
  modelsUnchanged: ({ count, fetchedAt }: { count: number; fetchedAt: string | null }) => `바뀐 것이 없습니다. 모델 ${count}개 (${fetchedAt ?? "없음"})`,
  modelsRefreshFailed: () => `실패:`,
  envSetupFailed: ({ error }: { error: string }) => `.env 준비 실패: ${error}`,
  /** 저장을 거절한 문제들. lines: 문제마다 로그 언어로 그린 줄을 줄바꿈으로 이은 것 */
  problemLines: ({ lines }: { lines: string }) => `${lines}`,
};

export { config };
