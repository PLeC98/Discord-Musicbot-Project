"use strict";

// 자동재생 소스가 같이 쓰는 요청 도우미.

const config = require("../../../config");

const userAgent = () => config.userAgents.bot;

const TIMEOUT_MS = 15000;

const rand = (n) => Math.floor(Math.random() * n);

const pick = (list) => (list.length ? list[rand(list.length)] : null);

async function getJson(url, headers = {}, timeoutMs = TIMEOUT_MS) {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": userAgent(), ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status} (${new URL(url).host})`);
  return res.json();
}

// 배열 옵션은 이름 뒤에 []를 붙여야 듣는다. 안 붙이면 400도 아니고 조용히 무시된다
// VocaDB 계열에서 가장 흔한 함정이라 여기 한 곳에서 책임진다.
function query(params) {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value == null || value === "") continue;
    if (Array.isArray(value)) {
      for (const one of value) q.append(`${key}[]`, one);
    } else q.append(key, value);
  }
  return q.toString();
}

module.exports = { getJson, pick, rand, query, TIMEOUT_MS, userAgent };
