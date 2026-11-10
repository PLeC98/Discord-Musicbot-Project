// 테스트: routes/uploads 로 파일을 청크로 올려 업로드 id 를 받는다. 앱에 express.json 과 /api/admin/uploads 가 있어야 한다

import type { UploadPurpose } from "../../src/dashboard/contract/uploads.ts";

/** origin 의 /api/admin/uploads 로 file 을 chunk 바이트씩 올린다. 다 올린 업로드 id */
async function uploadVia(origin: string, purpose: UploadPurpose, file: Buffer, chunk = Math.max(1, file.length)): Promise<string> {
  const start = await fetch(`${origin}/api/admin/uploads`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ purpose, size: file.length }) });
  if (start.status !== 200) throw new Error(`업로드 시작 ${start.status}: ${await start.text()}`);
  const { id } = (await start.json()) as { id: string };
  for (let at = 0; at < file.length; at += chunk) {
    const res = await fetch(`${origin}/api/admin/uploads/${id}?offset=${at}`, { method: "PUT", headers: { "content-type": "application/octet-stream" }, body: file.subarray(at, at + chunk) });
    if (res.status !== 200) throw new Error(`청크 ${at} ${res.status}: ${await res.text()}`);
  }
  return id;
}

export { uploadVia };
