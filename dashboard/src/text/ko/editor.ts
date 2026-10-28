// 운영자 설정 편집기의 저장(저장 막대 · 저장 표시 · 설정 문서 읽고 쓰기)

const unsaved = "저장하지 않은 변경";
const unsavedLong = "저장하지 않은 변경이 있어요";
/** 검사에 걸린 값이 있어 저장을 막을 때 */
const fixFirst = "고칠 것이 남아 있어요";
/** tabs: 고칠 것이 남은 탭 이름(· 로 이음) */
const fixFirstIn = (tabs: string) => `고칠 것이 남아 있어요: ${tabs}`;
const revert = "되돌리기";
const save = "저장";
const saveRestart = "저장 후 다시 시작";
/** 휴대폰 막대(자리가 좁다) */
const saveRestartShort = "저장 · 다시 시작";
const saving = "저장하는 중";
const saved = "저장했어요";
const saveFailed = "저장하지 못했어요";
const saveFailedSentence = "저장하지 못했어요.";
const loadFailed = "설정을 읽지 못했어요.";
/** 기본값을 편집기에 불러왔다(아직 저장하지 않았다) */
const defaultLoaded = "기본값을 불러왔어요";
const defaultLoadedNote = "저장하면 반영돼요. 되돌리면 지금 설정으로 돌아가요.";
/** ⋯ 메뉴 버튼 */
const more = "더 보기";

export { unsaved, unsavedLong, fixFirst, fixFirstIn, revert, save, saveRestart, saveRestartShort, saving, saved, saveFailed, saveFailedSentence, loadFailed, defaultLoaded, defaultLoadedNote, more };
