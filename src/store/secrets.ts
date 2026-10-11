// 비밀값(바깥 서비스 키 · AI 키 · 서비스 계정 · 쿠키). settings.db 의 secrets 표에 값마다 암호화해 둔다.
//
// - 암호: SECRETS_KEY(.env, base64 32바이트)에서 HKDF 로 용도별 키를 끌어내 AES-256-GCM. 줄마다 키 지문(key_id)을 적어 다른 키로 잠근 줄을 가려낸다.
// - 묶기: 키는 넣을 때의 제공자 · 주소(origin)에 묶인다. 인증 데이터(AAD)에 이름 · 제공자 · 주소 · 형식 버전을 넣고, 풀 때는 부르는 쪽이 기대하는 값으로 만든다.
//   그래서 DB 에 쓸 수 있는 사람이 암호문을 다른 줄로 옮기거나 묶인 주소 칸만 바꾸면 풀리지 않는다.
// - 값은 응답 · 로그 · 내보내기로 나가지 않는다(암호화된 설정 내보내기에는 암호문만). 화면에는 status() 의 저장 여부 · 바꾼 때 · 끝 네 글자만(풀지 않고 적어 둔 것).

import crypto from "crypto";
import logger from "../infra/log/logger.ts";
const log = logger.child({ category: "config" });
import config from "../config/index.ts";
import { codedError } from "../rules/error-kind.ts";
import { settingsDb } from "./settings-db.ts";

// 암호문 모양. 바꾸면 올리고 읽는 쪽이 옛 형식을 다시 넣으라고 한다
const FORMAT = 1;
// 값 하나의 상한. 쿠키 파일도 넉넉히 들어간다
const MAX_BYTES = 1024 * 1024;
// 이보다 짧은 값은 끝 네 글자를 적지 않는다(반 넘게 드러난다)
const LAST4_MIN_LENGTH = 12;

/** 키를 묶는 곳. 둘 다 없으면 묶지 않은 키(주소가 고정된 서비스) */
type Binding = { provider?: string | null; endpoint?: string | null };
/**
 * 꺼낸 결과. none: 없음, moved: 묶인 곳(제공자 · 주소)이 지금과 다르다(키를 붙이지 않는다),
 * other-key: 다른 SECRETS_KEY 로 잠갔다, old-format: 예전 형식으로 잠갔다, broken: 풀리지 않는다(칸을 바꿨거나 망가졌다). 모두 "다시 넣으세요"
 */
type Read = { state: "ok"; value: string } | { state: "none" | "moved" | "other-key" | "old-format" | "broken" };
/** 화면에 보이는 것. 값은 없다 */
type Status = { saved: boolean; updatedAt: number | null; last4: string | null; sameKey: boolean; provider: string | null; endpoint: string | null };

type Row = { name: string; format: number; key_id: string; provider: string; endpoint: string; iv: Buffer; tag: Buffer; ciphertext: Buffer; last4: string; updated_at: number };

// 키에서 끌어낸 것. 같은 키면 다시 계산하지 않는다
let derived: { raw: string; enc: Buffer; id: string } | null = null;
// 테스트 시임. 정하면 config 대신 이 키를 쓴다
let keyOverride: string | null = null;

function keys() {
  const raw = keyOverride ?? config.secrets.key;
  if (!raw) throw codedError("SECRETS_KEY_MISSING", "SECRETS_KEY 가 없어 비밀값을 다룰 수 없습니다");
  if (derived?.raw !== raw) {
    const ikm = Buffer.from(raw, "base64");
    const expand = (info: string, bytes: number) => Buffer.from(crypto.hkdfSync("sha256", ikm, Buffer.alloc(0), info, bytes));
    derived = { raw, enc: expand("musicbot secrets v1 encrypt", 32), id: expand("musicbot secrets v1 key-id", 8).toString("hex") };
  }
  return derived;
}

// 주소는 origin 으로 묶는다(같은 호스트 안의 경로는 같은 곳이다). 주소 모양이 아니면 다듬은 글자 그대로
function originOf(endpoint: string | null | undefined) {
  const text = (endpoint ?? "").trim();
  if (!text) return "";
  try {
    return new URL(text).origin.toLowerCase();
  } catch {
    return text.toLowerCase();
  }
}

function aadOf(name: string, provider: string, endpoint: string) {
  return Buffer.from(JSON.stringify([FORMAT, name, provider, endpoint]), "utf8");
}

const conn = () => settingsDb.get();

/** 넣기(덮어쓰기). 값은 1바이트 이상 1MB 이하 */
function put(name: string, value: string, binding: Binding = {}) {
  const bytes = Buffer.from(value, "utf8");
  if (!value.trim() || bytes.length > MAX_BYTES) throw codedError("SECRET_INVALID", `비밀값 ${name} 은 비어 있지 않고 1MB 이하여야 합니다`);
  const { enc, id } = keys();
  const provider = binding.provider ?? "";
  const endpoint = originOf(binding.endpoint);
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", enc, iv);
  cipher.setAAD(aadOf(name, provider, endpoint));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  const last4 = value.length >= LAST4_MIN_LENGTH ? value.slice(-4) : "";
  conn()
    .prepare(
      `INSERT INTO secrets (name, format, key_id, provider, endpoint, iv, tag, ciphertext, last4, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(name) DO UPDATE SET
           format = excluded.format, key_id = excluded.key_id, provider = excluded.provider, endpoint = excluded.endpoint,
           iv = excluded.iv, tag = excluded.tag, ciphertext = excluded.ciphertext, last4 = excluded.last4, updated_at = excluded.updated_at`,
    )
    .run(name, FORMAT, id, provider, endpoint, iv, cipher.getAuthTag(), ciphertext, last4, Date.now());
}

/** 꺼내기. binding 은 넣을 때와 같은 곳을 기대하는 값으로 준다(지금 설정의 제공자 · 주소) */
function read(name: string, binding: Binding = {}): Read {
  const row = conn().prepare("SELECT * FROM secrets WHERE name = ?").get(name) as Row | undefined;
  if (!row) return { state: "none" };
  const { enc, id } = keys();
  if (row.format !== FORMAT) return { state: "old-format" };
  if (row.key_id !== id) return { state: "other-key" };
  const provider = binding.provider ?? "";
  const endpoint = originOf(binding.endpoint);
  if (row.provider !== provider || row.endpoint !== endpoint) return { state: "moved" };
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", enc, row.iv);
    decipher.setAAD(aadOf(name, provider, endpoint));
    decipher.setAuthTag(row.tag);
    return { state: "ok", value: Buffer.concat([decipher.update(row.ciphertext), decipher.final()]).toString("utf8") };
  } catch {
    log.warn(`비밀값 ${name} 이 풀리지 않습니다(저장된 줄이 바뀌었거나 망가졌습니다). 대시보드에서 다시 넣으세요`);
    return { state: "broken" };
  }
}

/** 지우기. 지웠으면 true */
function remove(name: string) {
  return conn().prepare("DELETE FROM secrets WHERE name = ?").run(name).changes > 0;
}

/** 화면용. 풀지 않는다 */
function status(name: string): Status {
  const row = conn().prepare("SELECT key_id, provider, endpoint, last4, updated_at FROM secrets WHERE name = ?").get(name) as Pick<Row, "key_id" | "provider" | "endpoint" | "last4" | "updated_at"> | undefined;
  if (!row) return { saved: false, updatedAt: null, last4: null, sameKey: true, provider: null, endpoint: null };
  return { saved: true, updatedAt: row.updated_at, last4: row.last4 || null, sameKey: row.key_id === keys().id, provider: row.provider || null, endpoint: row.endpoint || null };
}

// ── 암호문 그대로 옮기기(암호화된 설정 내보내기 · 불러오기) ──

/** 내보내는 꼴. 암호문 그대로라 같은 SECRETS_KEY 에서만 풀린다. 끝 네 글자는 넣지 않는다(받는 쪽이 풀어서 다시 센다) */
type Sealed = { name: string; format: number; keyId: string; provider: string; endpoint: string; iv: string; tag: string; ciphertext: string; updatedAt: number };
/** 받은 암호문 하나를 본 결과. other-key: 다른 SECRETS_KEY 로 잠갔다, broken: 꼴이 틀렸거나 풀리지 않는다(칸을 바꿨다) */
type Opened = { ok: true; row: Row } | { ok: false; name: string; why: "other-key" | "old-format" | "broken" };

// 비밀 이름의 꼴(이 봇이 쓰는 것: service.spotify.clientId · ai.openai · youtube.cookies)
const SECRET_NAME = /^[a-z0-9._-]{1,100}$/i;

/** 모든 비밀의 암호문 */
function sealedAll(): Sealed[] {
  const rows = conn().prepare("SELECT * FROM secrets ORDER BY name").all() as Row[];
  return rows.map((row) => ({ name: row.name, format: row.format, keyId: row.key_id, provider: row.provider, endpoint: row.endpoint, iv: row.iv.toString("base64"), tag: row.tag.toString("base64"), ciphertext: row.ciphertext.toString("base64"), updatedAt: row.updated_at }));
}

const isText = (value: unknown, max = 4096): value is string => typeof value === "string" && value.length <= max;

// 받은 암호문의 칸을 본다. 꼴이 틀리면 null
function shapeOf(input: unknown) {
  const one = (input && typeof input === "object" ? input : {}) as Partial<Record<keyof Sealed, unknown>>;
  const { name, keyId, provider, endpoint, iv, tag, ciphertext, format, updatedAt } = one;
  if (!isText(name, 100) || !SECRET_NAME.test(name) || !isText(keyId, 64) || !isText(provider, 100) || !isText(endpoint, 2048)) return null;
  if (!isText(iv) || !isText(tag) || !isText(ciphertext, MAX_BYTES * 2)) return null;
  return { name, keyId, provider, endpoint, format, iv: Buffer.from(iv, "base64"), tag: Buffer.from(tag, "base64"), ciphertext: Buffer.from(ciphertext, "base64"), updatedAt: typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : Date.now() };
}

// 푼 값. 풀리지 않으면 null
function decrypt(enc: Buffer, { iv, tag, ciphertext }: { iv: Buffer; tag: Buffer; ciphertext: Buffer }, aad: Buffer): string | null {
  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", enc, iv);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** 받은 암호문이 지금 키로 풀리는지 본다(이름 · 묶인 곳은 파일 그대로 인증 데이터로). 풀리면 넣을 줄(끝 네 글자는 푼 값에서) */
function openSealed(input: unknown): Opened {
  const one = shapeOf(input);
  if (!one) return { ok: false, name: "", why: "broken" };
  const { name } = one;
  if (one.format !== FORMAT) return { ok: false, name, why: "old-format" };
  const { enc, id } = keys();
  if (one.keyId !== id) return { ok: false, name, why: "other-key" };
  const value = decrypt(enc, one, aadOf(name, one.provider, one.endpoint));
  if (value === null) return { ok: false, name, why: "broken" };
  return { ok: true, row: { name, format: FORMAT, key_id: id, provider: one.provider, endpoint: one.endpoint, iv: one.iv, tag: one.tag, ciphertext: one.ciphertext, last4: value.length >= LAST4_MIN_LENGTH ? value.slice(-4) : "", updated_at: one.updatedAt } };
}

/** 열어 본 줄들을 넣는다(같은 이름은 덮어쓴다). 부르는 쪽의 트랜잭션 안에서 */
function adoptOpened(rows: Row[]) {
  const insert = conn().prepare(
    `INSERT INTO secrets (name, format, key_id, provider, endpoint, iv, tag, ciphertext, last4, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(name) DO UPDATE SET
         format = excluded.format, key_id = excluded.key_id, provider = excluded.provider, endpoint = excluded.endpoint,
         iv = excluded.iv, tag = excluded.tag, ciphertext = excluded.ciphertext, last4 = excluded.last4, updated_at = excluded.updated_at`,
  );
  for (const row of rows) insert.run(row.name, row.format, row.key_id, row.provider, row.endpoint, row.iv, row.tag, row.ciphertext, row.last4, row.updated_at);
}

// 테스트 시임. 인자 없이 부르면 config 의 키로
function _useKey(raw: string | null = null) {
  keyOverride = raw;
}

export { put, read, remove, status, originOf, sealedAll, openSealed, adoptOpened, _useKey };
export type { Binding, Read, Status, Sealed, Opened, Row as SecretRow };
