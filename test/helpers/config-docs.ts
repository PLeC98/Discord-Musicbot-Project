// 설정 문서(장르 · 상태 문구 · AI 설정 · 프롬프트, config/documents)를 테스트가 정한다.
// 저장소를 붙이지 않은 메모리 문서라 실제 settings.db 를 건드리지 않는다. 기본값은 새로 설치했을 때와 같다(config/defaults).
//
//   useDefaultDocuments();                         // 테스트 파일 맨 위에서
//   useDocument("genres", { genres: { 팝: … } });  // 저장되는 모양(객체) 그대로

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

/** 문서 하나를 넣는다 */
function useDocument(name: documents.DocName, value: unknown) {
  documents._use(name, value);
  forget();
}

export { useDefaultDocuments, useDocument };
