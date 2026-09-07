"use strict";

const { escapeMarkdown } = require("discord.js");

// 트랙 제목·파일명은 외부에서 오는데 그대로 메시지에 실린다. 멘션과 마스크드 링크를 막는다.

// 클라이언트 기본값. 멘션이 필요한 곳은 payload에서 users/roles를 명시해 덮어쓴다.
const ALLOWED_MENTIONS = { parse: [], repliedUser: false };

// 메시지 본문용. maskedLink 옵션이 `[클릭](url)`의 여는 대괄호를 막는다 — 없으면 제목이 클릭되는 링크로 렌더링된다.
// 마스크드 링크 라벨 안에는 쓰지 말 것. 거기서는 백슬래시가 이스케이프로 해석되지 않고 화면에 그대로 노출된다.
const escapeMd = (text) => escapeMarkdown(String(text ?? ""), { maskedLink: true });

module.exports = { ALLOWED_MENTIONS, escapeMd };
