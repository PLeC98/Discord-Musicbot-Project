// 바깥 서비스 키를 비밀 표에서 꺼내 설정 객체에 올린다. 기동 때 한 번(load), 대시보드에서 바꿀 때마다(save · remove).
// 값을 쓰는 곳(자동재생 소스 · 스포티파이)은 설정 객체를 그대로 읽는다. 값은 메모리에만 있고 응답 · 로그로 나가지 않는다.

import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "config" });
import config from "../config/index.ts";
import { codedError } from "../rules/error-kind.ts";
import { SERVICE_KEYS, SERVICE_IDS, secretName } from "../rules/service-keys.ts";
import type { ServiceId, SecretView, ServiceKeysView } from "../rules/service-keys.ts";
import * as secrets from "./secrets.ts";

// 칸 → 설정 객체의 자리
const SLOTS: { [S in ServiceId]: Record<(typeof SERVICE_KEYS)[S][number], (value: string | null) => void> } = {
  spotify: {
    clientId: (value) => (config.spotify.clientId = value),
    clientSecret: (value) => (config.spotify.clientSecret = value),
  },
  lastfm: { apiKey: (value) => (config.sources.lastfmKey = value) },
  listenbrainz: { token: (value) => (config.sources.listenbrainzToken = value) },
};

// 화면에 보이는 이름
const LABELS: Record<ServiceId, string> = { spotify: "Spotify", lastfm: "Last.fm", listenbrainz: "ListenBrainz" };

const fieldsOf = (service: ServiceId): readonly string[] => SERVICE_KEYS[service];
const slotOf = (service: ServiceId, field: string) => (SLOTS[service] as Record<string, (value: string | null) => void>)[field];

/** 그 서비스의 칸을 꺼내 설정 객체에 올린다. 칸마다 꺼낸 상태 */
function apply(service: ServiceId) {
  return fieldsOf(service).map((field) => {
    const read = secrets.read(secretName(service, field));
    slotOf(service, field)(read.state === "ok" ? read.value : null);
    return read.state;
  });
}

/** 기동 때. 모두 꺼내 올리고, 다시 넣어야 하는 키 · 없는 Spotify 키를 알린다 */
function load() {
  for (const service of SERVICE_IDS) {
    const states = apply(service);
    if (states.some((state) => state !== "ok" && state !== "none")) {
      log.warn(`${LABELS[service]} 키를 풀지 못했습니다(SECRETS_KEY 가 바뀌었거나 저장된 값이 망가졌습니다). 운영자 패널의 API 키 탭에서 다시 넣으세요`);
    } else if (service === "spotify" && states.includes("none")) {
      log.warn("Spotify API 키가 없습니다. 트랙 · 앨범 링크는 열지 못하고 재생목록 · 아티스트는 키 없이 엽니다. 운영자 패널의 API 키 탭에서 넣으세요");
    }
  }
}

/** 넣기. values 는 그 서비스의 칸 중 바꿀 것만(빈 칸은 그대로 둔다). 모르는 칸이 있거나 바꿀 것이 없으면 던진다 */
function save(service: ServiceId, values: Record<string, unknown>) {
  const entries = Object.entries(values).filter(([, value]) => typeof value === "string" && value.trim());
  if (!entries.length || Object.keys(values).some((field) => !fieldsOf(service).includes(field))) {
    throw codedError("SECRET_INVALID", `${LABELS[service]} 키의 칸이 맞지 않습니다`);
  }
  for (const [field, value] of entries) secrets.put(secretName(service, field), String(value).trim());
  apply(service);
}

/** 지우기. 그 서비스의 칸을 모두 */
function remove(service: ServiceId) {
  for (const field of fieldsOf(service)) secrets.remove(secretName(service, field));
  apply(service);
}

function viewOf(service: ServiceId, field: string): SecretView {
  const name = secretName(service, field);
  const status = secrets.status(name);
  if (!status.saved) return { state: "none", last4: null, updatedAt: null };
  return { state: secrets.read(name).state === "ok" ? "ok" : "again", last4: status.last4, updatedAt: status.updatedAt };
}

/** 화면용. 값은 없다 */
function view(): ServiceKeysView {
  return Object.fromEntries(SERVICE_IDS.map((service) => [service, Object.fromEntries(fieldsOf(service).map((field) => [field, viewOf(service, field)]))])) as ServiceKeysView;
}

export { load, save, remove, view, LABELS };
