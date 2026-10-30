// 테스트가 만들거나 고친 아카이브를 메모리로 묶는다. 봇이 실제로 쓰는 writeZip을 거친다
//
//   const file = await zipped([{ name: "settings.json", data: Buffer.from("{}") }]);

import { writeZip, type ZipInput } from "../../src/infra/zip.ts";

async function zipped(inputs: ZipInput[], options?: Parameters<typeof writeZip>[2]): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await writeZip(inputs, async (chunk) => void chunks.push(chunk), options);
  return Buffer.concat(chunks);
}

export { zipped };
