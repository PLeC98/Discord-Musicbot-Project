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
const escapeMd = (text) => escapeMarkdown(String(text ?? ""), { maskedLink: true });

/**
 * 링크 라벨용 — 대괄호가 남으면 [라벨](url) 구조를 탈출해 임의 URL로 링크를 걸 수 있다.
 *
 * 백슬래시로는 못 막는다: escapeMarkdown이 백슬래시를 다시 이스케이프해 `\]`의 짝이 깨진다.
 * maskedLink 옵션도 완전한 `[x](y)` 패턴만 잡고 홑 `]`는 통과시킨다.
 * 그래서 전각으로 치환한다 — 라벨 안에 ASCII 대괄호가 아예 남지 않는다.
 */
const escapeMdLink = (text) =>
  escapeMd(
    String(text ?? "")
      .replace(/\[/g, "［")
      .replace(/\]/g, "］"),
  );

module.exports = { ALLOWED_MENTIONS, escapeMd, escapeMdLink };
