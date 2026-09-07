"use strict";

const { escapeMarkdown } = require("discord.js");

// 외부에서 받은 문자열(트랙 제목, 직접 링크 파일명 등)이 디스코드 메시지에 그대로 실린다.
// 제목에 @everyone을 넣어두면 봇 명의로 대규모 멘션을 대리 전송할 수 있었다.

/**
 * 클라이언트 기본값 — 모든 전송(명령 응답·채널 메시지·웹훅)에 적용된다.
 * 멘션이 꼭 필요한 곳은 payload에서 users/roles를 명시해 덮어쓴다.
 * (임베드 안의 <@id>는 원래 알림이 가지 않으므로 이 설정과 무관하게 그대로 표시된다.)
 */
const ALLOWED_MENTIONS = { parse: [], repliedUser: false };

/** 외부 문자열을 마크다운 문맥(**굵게** 등)에 넣을 때 — 서식이 깨지지 않게. */
const escapeMd = (text) => escapeMarkdown(String(text ?? ""));

/** 링크 라벨용 — 대괄호가 남으면 [라벨](url) 구조 자체가 깨진다. */
const escapeMdLink = (text) => escapeMd(text).replace(/([[\]])/g, "\\$1");

module.exports = { ALLOWED_MENTIONS, escapeMd, escapeMdLink };
