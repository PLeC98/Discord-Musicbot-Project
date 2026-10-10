// 설정 문서(장르 · 상태 문구 · AI 설정 · 프롬프트, config/documents)를 시험이 정한다.
// 저장소를 붙이지 않은 메모리 문서라 실제 settings.db 를 건드리지 않는다. 기본값은 새로 설치했을 때와 같다(config/defaults).
//
//   useDefaultDocuments();                      // 시험 파일 머리에서
//   useDocument("genres", "genres:\n  팝: …");  // YAML 글이나 값으로

import YAML from "yaml";
import * as documents from "../../src/config/documents.ts";
import * as genreConfig from "../../src/config/genres.ts";
import * as statusConfig from "../../src/config/status.ts";

// 읽은 설정을 기억해 둔 것(직전에 맞던 설정)을 버린다. 새 문서로 처음부터 읽게
function forget() {
  genreConfig._reset();
  statusConfig._reset();
}

/** 모든 문서를 기본값으로 */
function useDefaultDocuments() {
  documents._use();
  forget();
}

/** 문서 하나를 넣는다. 글이면 YAML 로 읽는다(옛 설정 파일 꼴로 적기 편하게) */
function useDocument(name: documents.DocName, value: unknown) {
  documents._use(name, typeof value === "string" ? YAML.parse(value) : value);
  forget();
}

export { useDefaultDocuments, useDocument };
