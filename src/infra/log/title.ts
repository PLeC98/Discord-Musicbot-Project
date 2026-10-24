// 로그에 적는 곡 제목. 출처가 제목을 주지 않았으면(null) 그렇다고 적는다(화면은 ui/text 의 songTitle 이 "알 수 없는 곡"으로)

const logTitle = (title: string | null | undefined) => title ?? "(제목 없음)";

export { logTitle };
