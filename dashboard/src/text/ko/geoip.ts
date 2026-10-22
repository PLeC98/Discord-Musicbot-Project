// 운영자 패널: 일반 탭 "IP 위치 정보" 카드의 판 · 확인 · 업데이트

const version = (v: string, mb: number | null) => `지금 판: ${v}${mb === null ? "" : ` · ${mb}MB`}`;
const noVersion = "받은 판이 없어요";
const check = "업데이트 확인";
const checking = "확인 중…";
const update = (v: string, mb: number | null) => `업데이트 (${v}${mb === null ? "" : ` · 약 ${mb}MB`})`;
const latest = "이미 최신이에요";
const notFound = "받을 수 있는 판을 찾지 못했어요";
const downloading = (got: number, total: number | null) => `받는 중… ${got}MB${total === null ? "" : ` / ${total}MB`}`;
const failed = (why: string) => `마지막으로 받지 못한 까닭: ${why}`;
const off = "위치 표시를 꺼 두었어요";
const loadFailed = "IP 위치 정보 상태를 읽지 못했어요.";
const checkFailed = "업데이트를 확인하지 못했어요.";
const updateFailed = "업데이트를 시작하지 못했어요.";
const updated = "IP 위치 정보를 업데이트했어요";

export { version, noVersion, check, checking, update, latest, notFound, downloading, failed, off, loadFailed, checkFailed, updateFailed, updated };
