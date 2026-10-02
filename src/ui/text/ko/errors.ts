// 오류 · 거절 안내. 코드(rules/problems)마다 문장 하나. 부르는 자리는 코드와 값만 넘긴다.
// 안내는 무엇에 관한 것인지(topic) · 심각한 정도(severity) · 머리 줄 · 본문이고, 머리 줄의 이모지와 색은 그리는 쪽(ui/frame)이 붙인다

import { formatMs } from "../../format.ts";
import { noticeOf, type Notice, type Topic } from "../notice.ts";
import { josa } from "../../../rules/josa.ts";
import type { Code, Params } from "../../../rules/problems.ts";

// 봇 쪽 문제 · 외부 실패로 못 했다
const error = (topic: Topic, title: string, body?: string) => noticeOf("error", topic, title, body);
// 사용자가 고칠 수 있거나 지금 상태라 못 했다
const warning = (topic: Topic, title: string, body?: string) => noticeOf("warning", topic, title, body);

/** 그리는 쪽마다 다른 값의 꼴. 디스코드는 채널을 멘션으로 적는다(ui/mentions 의 DISCORD_LOOK) */
type Look = { channel: (id: string) => string };
/** 꾸밈 없는 꼴(대시보드) */
const PLAIN: Look = { channel: (id) => `#${id}` };

const TEXT: { [C in Code]: (p: Params, look: Look) => Notice } = {
  // 요청한 사람이 갖추지 못함
  // 봇을 부를 때 부른 사람이 음성 채널에 없다
  "must-be-in-voice": () => warning("voice", "먼저 음성 채널에 접속해 주세요!", "그래야 제가 어느 채널에서 곡을 틀지 알 수 있어요."),
  // 봇이 음성 채널에 있는데 그 채널 밖에서 조작했다
  "must-be-in-same-voice": () => warning("voice", "봇과 같은 음성 채널에 있어야 해요!", "곡을 듣고 있는 사람들만 재생을 제어할 수 있어요."),
  "must-dj": () => warning("permission", "이 조작을 할 권한이 없어요.", "이 조작을 하려면 DJ 역할을 갖고 있어야 해요."),
  // 설정 화면은 서버 관리 권한이 있어야 만진다
  "must-moderator": () => warning("permission", "이 조작을 할 권한이 없어요.", "이 조작에는 서버 관리 권한이 필요해요!"),
  // 봇 운영자(OWNER_ID)만 쓰는 화면을 다른 사람이 열었다
  "must-owner": () => warning("permission", "이 조작을 할 권한이 없어요.", "이 조작은 봇 운영자 전용이에요."),
  // 검색 결과 버튼은 검색한 사람만 누른다
  "search-owner-only": () => warning("permission", "다른 사람의 패널이에요!", "검색한 사람만 고를 수 있어요."),
  // 전용 채널이 있으면 /dashboard 는 그 채널에서만. channelId 는 전용 채널
  "only-in-bot-channel": ({ channelId = "" }, look) => warning("permission", "전용 채널이 아니에요!", `이 명령어는 ${look.channel(channelId)} 채널에서만 사용할 수 있어요.`),
  // DM 에서 서버 명령을 불렀다
  "guild-only": () => warning("permission", "마음만 받을게요.", "아쉽게도 서버에서만 사용할 수 있는 명령어예요. 서버에서 사용해 주세요!"),
  // 봇에게 디스코드 권한이 없음
  // 봇이 그 음성 채널에 들어가거나 말할 권한이 없다. 디스코드가 음성 채널 상태를 권한 없음으로 거절해도 이것이다
  "permission-voice": () => error("permission", "제게 권한이 없어요.", "봇이 그 음성 채널에 접속하거나 말할 권한이 없어요."),
  // 디스코드가 권한 없음으로 거절했다. 글(메시지 · 고정 · 웹훅) · 그 밖(rules/errorKind 가 거절된 요청의 주소로 가른다)
  "permission-text": () => error("permission", "제게 권한이 없어요.", "봇이 그 텍스트 채널에 메시지를 올릴 권한이 없어요. 서버 관리자에게 봇의 권한을 확인해 달라고 해 주세요."),
  "permission-other": () => error("permission", "제게 권한이 없어요.", "봇이 그 행동을 하는 데에 필요한 권한이 없어요. 서버 관리자에게 봇의 권한 설정을 확인해달라고 해 주세요."),
  // 지금 상태로는 못 함
  // 지금 곡이 없다(플레이어가 없거나 곡이 비었다)
  "no-song": () => warning("state", "재생 중인 곡이 없어요!", "이 조작을 하려면 재생 중인 곡이 있어야 해요."),
  "queue-empty": () => warning("state", "대기열에 곡이 없어요!", "이 조작을 하려면 대기열에 곡이 있어야 해요."),
  "queue-full": ({ max }) => warning("state", "곡을 추가하지 못했어요!", `대기열이 가득 찼어요... (최대 ${max}곡)`),
  "no-previous": () => warning("state", "이전 곡이 없어요!", "이 곡이 처음으로 튼 곡이거나, 기록이 초기화되어 이전 곡을 재생할 수 없어요."),
  "no-highlight": () => warning("state", "하이라이트가 없어요!", "이 곡에는 SponsorBlock 하이라이트 지점이 없어요."),
  "too-few-to-shuffle": () => warning("state", "섞을 곡이 없어요!", "셔플하려면 대기열에 곡이 2곡 이상 있어야 해요."),
  "too-few-to-move": () => warning("state", "순서를 바꿀 곡이 없어요!", "순서를 바꾸려면 대기열에 곡이 2곡 이상 있어야 해요."),
  // 건너뛰기 · 이전 곡 · 곡으로 건너뛰기가 곡을 바꾸지 못했다(지금 곡이 없을 때 난다)
  "switch-failed": () => warning("state", "작업에 실패했어요!", "곡을 전환하지 못했어요. 잠시 후 재시도해 보고, 계속되면 봇 운영자에게 알려주세요."),
  // 사람이 풀 수 없는 멈춤(Player.pauseReasons)이 일시정지 풀기를 막았다
  "held-mute": () => warning("muted", "음소거되었어요!", "봇이 서버에서 음소거되어서 곡을 멈춰뒀어요. 음소거가 풀리면 이어서 틀게요."),
  "held-alone": () => warning("waiting", "기다리고 있어요.", "음성 채널에 저 혼자 있어서 곡을 멈춰뒀어요. 누가 들어오면 이어서 틀게요!"),
  // 곡을 담는 사이에 플레이어가 사라졌다(더 넣기 포함)
  "ended-while-adding": () => warning("state", "그 사이에 재생이 끝나버렸어요!", "플레이어가 만료됐어요. 링크를 다시 넣어서 재생해주세요."),
  "live-no-seek": () => warning("live", "라이브 방송은 이동을 할 수 없어요!", "라이브 방송은 실시간으로만 재생이 가능해요."),
  "live-no-loop": () => warning("live", "라이브 방송은 반복 모드를 지원하지 않아요!", "라이브 방송이 재생중이거나 대기열에 있을 때는 반복 모드를 설정할 수 없어요. 해당 곡을 빼고 시도해 주세요."),
  "live-upcoming": () => warning("live", "아직 시작되지 않은 라이브예요!", "예정된 라이브는 재생할 수 없어요. 라이브가 시작된 뒤에 다시 요청해 주세요!"),
  // 그 사이 사라짐
  // 지난 재생의 패널 버튼 · 메뉴(정지 뒤 다시 틀었거나 봇이 다시 켜졌다)
  "stale-session": () => warning("stale", "만료된 버튼이에요!", '새 패널의 버튼을 눌러 주세요.\n새 패널이 없다면, "현재 재생 중" 패널을 새로 불러와서 사용해 주세요!'),
  // 곡으로 건너뛰기 메뉴에서 고른 곡이 대기열에 없다(메뉴를 연 뒤 대기열이 바뀌었다)
  "jump-target-gone": () => warning("stale", "선택한 곡이 대기열에 없어요!", "메뉴를 연 뒤에 대기열이 바뀌었어요. 다시 선택해 주세요."),
  "more-expired": () => warning("stale", "시간이 지나 닫힌 메뉴예요. 링크를 다시 넣어 주세요."),
  // 입력이 틀림
  // 시간 입력(/seek)을 읽지 못했다
  "bad-time": () => warning("input", "알 수 없는 시간 형식이에요!", "제가 읽어 들일 수 없는 형식이에요. `1:30`, `3m20s`, `90` 처럼 적어 주세요!"),
  "bad-volume": () => warning("input", "정해진 범위의 숫자로 입력해 주세요!", "볼륨은 0에서 100 까지의 숫자로 적어야 해요."),
  // 대시보드에서만 난다(명령과 버튼은 고를 수 있는 모드만 보낸다)
  "bad-loop-mode": () => warning("input", "반복 모드가 올바르지 않습니다."),
  "bad-position": ({ size }) => warning("input", "그 번호의 곡은 존재하지 않아요!", `대기열에는 ${size}곡만 있어요. 1~${size} 사이로 적어 주세요.`),
  "same-position": () => warning("input", "제자리로 옮길 수는 없어요!", "옮길 곡의 번호와 옮겨질 위치가 같아요. 번호를 다시 확인해주세요."),
  "beyond-end": ({ durationMs }) => warning("input", "곡이 그만큼 길지 않아요!", `곡 길이(${durationMs === undefined ? "?" : formatMs(durationMs)})보다 뒤로 이동할 수는 없어요.`),
  "unknown-genre": ({ genre = "" }) => warning("stale", "알 수 없는 장르예요!", `그 사이 장르 목록이 변경되어 \`${genre}\`${josa(genre, "은")} 없어졌어요. 장르를 다시 선택해 주세요.`),
  // 재생목록 한 번에 넣는 곡 수가 범위 밖이다. queueCap 은 범위의 끝이 대기열 상한이라 그렇다면 그 상한
  "playlist-limit-out-of-range": ({ min, max, queueCap }) => warning("input", "범위를 벗어난 수치예요!", `한 번에 넣을 곡 수는 ${queueCap ? `대기열 상한치인 ${queueCap}곡을 넘을 수 없고, ` : ""}${min}에서 ${max}곡 사이여야 해요.`),
  "more-bad-count": () => warning("input", "넣을 곡 수를 1 이상의 숫자로 적어 주세요."),
  "more-not-requester": () => warning("permission", "목록을 넣은 사람만 더 넣을 수 있어요."),
  "more-not-requester-close": () => warning("permission", "목록을 넣은 사람만 닫을 수 있어요."),
  // 대상이나 처리기가 없음
  // 실행 목록에 없는 명령(꺼진 기능이 디스코드에 아직 남아 있다)
  "unknown-command": () => warning("stale", "사용할 수 없는 명령어예요!", "비활성화되었거나 변경 혹은 삭제된 명령어예요. 디스코드를 재시작해 보고, 여전히 해당 명령어가 보인다면 봇 운영자에게 알려주세요."),
  // 버튼 · 메뉴를 받을 처리기가 없다. 봇을 고치기 전에 올린 메시지의 것이 대개 이렇다(custom_id 모양이 바뀌었다). 꺼진 기능의 버튼 · 메뉴도 이렇다
  "unknown-interaction": () => warning("stale", "만료되었거나 알 수 없는 버튼이에요.", "새 패널의 버튼을 눌러 주세요.\n새 패널이 없다면, 명령을 다시 실행하거나 패널을 새로 불러와서 사용해 주세요!"),
  "more-unknown-menu": () => warning("stale", "알 수 없는 메뉴예요."),
  // 곡 찾기가 찾은 것이 없다
  "no-song-result": () => warning("notFound", "곡을 찾지 못했어요.", "다른 검색어나 링크로 시도해 주세요."),
  "no-search-results": () => warning("notFound", "검색 결과가 없어요.", "다른 검색어로 시도해 주세요."),
  "sp-no-youtube-match": () => warning("notFound", "일치하는 음원을 찾지 못했어요!", "재생하려는 스포티파이 곡과 일치하는 곡을 유튜브에서 찾지 못했어요. 곡 이름으로 검색하거나 유튜브 링크를 넣어 보세요."),
  "more-nothing-found": () => warning("notFound", "더 넣을 곡을 찾지 못했어요!", "재생목록이 변경되었을 수 있어요. 해당 플랫폼에 접속하여 재생목록을 확인해주세요."),
  // 받을 수 없는 내용
  "unsupported-link": () => warning("link", "알 수 없는 링크예요!", "재생을 지원하지 않는 플랫폼이에요."),
  "yt-unplayable": () => warning("link", "지원하지 않는 유튜브 링크예요!", "영상이나 재생목록의 주소를 넣어주세요."),
  "sc-unsupported": () => warning("link", "지원하지 않는 사운드클라우드 링크예요!", "곡이나 플레이리스트의 링크를 넣어 주세요."),
  // 막힌 주소 같은 까닭은 운영자 로그에만(내부망 탐지 도구가 되지 않게)
  "direct-unavailable": () => warning("link", "재생할 수 없는 링크예요!", "해당 링크가 오디오나 영상이 맞는지, 용량이 너무 크지는 않은지, 접속이 정상적으로 가능한지 확인해주세요."),
  "unavailable-contents": () => warning("blocked", "접근할 수 없거나 존재하지 않는 영상이에요!", "비공개이거나 삭제된 콘텐츠는 틀 수 없어요."),
  "unavailable-playlist": () => warning("blocked", "접근할 수 없거나 존재하지 않는 재생 목록이에요!", "비공개이거나 삭제된 재생 목록은 재생할 수 없어요."),
  // 운영자가 쿠키를 일부러 안 걸어 둔 것일 수 있다. 사용자에게 설정 방법을 늘어놓지 않는다
  "yt-age-no-cookies": () => warning("blocked", "연령 제한 영상은 틀 수 없어요!", "제한되지 않은 곡을 틀어주세요."),
  // 사운드클라우드 Go+ · 음반사 곡은 30초 조각만 열린다. 조각을 곡처럼 틀지 않는다
  "sc-preview-only": () => warning("blocked", "미리듣기만 가능한 곡이라 틀 수 없어요.", "다른 곡을 재생하거나, 다른 플랫폼으로 시도해 주세요."),
  "geo-blocked": () => warning("blocked", "지역 제한 콘텐츠예요!", "이 링크의 콘텐츠는 제가 있는 곳에서 접근할 수 없어요. 다른 링크로 시도해 보세요."),
  // skipped 는 받을 수 없어 뺀 곡 수
  "nothing-playable": ({ skipped }) => warning("blocked", `앞의 ${skipped}곡이 전부 재생할 수 없는 곡이에요.`, "미리듣기만 가능하거나 지역 제한 등이 걸린 곡들이에요."),
  "more-nothing-playable": ({ skipped }) => warning("blocked", "해당 구간의 곡들이 받을 수 없는 곡뿐이에요.", `미리듣기나 지역 제한 등이 걸린 곡들이라 넣지 못했어요. (${skipped}곡)`),
  // 바깥 실패
  // 고치는 법(bgutil · 쿠키)은 운영자 로그에(rules/operatorHints). 사용자는 설정을 만질 수 없다
  "yt-bot-check": () => error("failed", "유튜브가 요청을 차단했어요!", "잠시 후에 재시도해 보고, 계속 동일한 문제가 발생하면 봇 운영자에게 알려주세요."),
  "network-error": () => error("failed", "연결 오류가 발생했어요!", "해당 플랫폼에 연결하지 못했어요. 보통은 일시적인 오류이니 잠시 뒤에 다시 시도해 보세요. 오류가 계속되면 봇 운영자에게 알려주세요."),
  "stream-failed": () => error("failed", "오디오를 받아오지 못했어요!", "링크에 성공적으로 접속했지만 정상적으로 재생 가능한 음원을 가져오지 못했어요. 다시 시도하거나 다른 버전을 넣어 주세요."),
  "voice-failed": () => error("voice", "음성 채널에 들어가지 못했어요!", "디스코드 서버의 문제나 채널 인원 제한, 봇의 네트워크 문제 등이 원인일 수 있어요. 잠시 후에 다시 시도해 보고, 동일한 오류가 반복되면 서버 관리자에게 알려주세요. 그래도 해결되지 않으면 봇 운영자에게 보고해 주세요."),
  // 운영자 설정 · 잠시 못 함
  "rate-limited": () => error("failed", "요청이 너무 많아요...!", "해당 플랫폼이 제 요청을 차단했어요. 몇 분 뒤에 다시 해 보고, 계속되거나 자주 발생하면 봇 운영자에게 알려주세요."),
  // 운영자 설정이 없다. 까닭은 운영자 로그에만
  "spotify-unavailable": () => error("blocked", "지금은 스포티파이 링크를 재생할 수 없어요."),
  // 운영자가 쿠키를 다시 넣으면 풀린다
  "yt-age-cookies-invalid": () => error("blocked", "일시적으로 연령 제한 영상을 틀 수 없어요!", "오류가 계속되면 봇 운영자에게 알려주세요."),
  // 설치된 ffmpeg 가 라이브를 열 수 없다. 고치는 법은 운영자 로그에
  "live-no-ffmpeg": () => error("live", "라이브 방송을 틀 수 없어요!", "의도된 동작이 아니니 봇 운영자에게 알려 주세요."),
  "still-starting": () => warning("waiting", "잠시만 기다려 주세요...!", "아직 재생을 준비하는 중이에요. 잠시 뒤에 다시 시도해 주세요."),
  // 봇 안쪽 실패
  "unknown-error": () => error("failed", "예상치 못한 오류예요!", "잠시 후 재시도해 보세요. 오류가 계속되면 봇 운영자에게 알려 주세요."),
  // 명령 처리기가 던졌는데 종류를 가를 수 없다
  "command-failed": () => error("failed", "예상치 못한 오류예요!", "명령어 처리 중 오류가 발생했어요. 오류가 반복되면 봇 운영자에게 알려주세요."),
  // 버튼 · 메뉴의 처리가 던졌다(전용 채널 입력 포함)
  "processing-failed": () => error("failed", "예상치 못한 오류예요!", "처리 중에 오류가 발생했어요. 오류가 반복되면 봇 운영자에게 알려주세요."),
  "control-failed": () => error("failed", "작업이 실패했어요!", "잠시 뒤 재시도해 보고, 계속되면 봇 운영자에게 알려주세요."),
  "add-failed": () => error("failed", "오류가 발생했어요!", "곡을 넣는 중에 오류가 발생했어요."),
  // 까닭을 모르고 곡을 못 틀었다
  "cannot-start": () => error("failed", "예상치 못한 오류예요!", "곡을 재생하지 못했어요. 오류가 반복되면 봇 운영자에게 알려주세요."),
  // 새로고침 버튼이 화면(/help · /system)을 다시 그리다 실패했다
  "refresh-failed": () => error("failed", "정보를 새로 고치지 못했어요.", "명령어를 다시 입력하여 새 패널로 조회해 주세요."),
  "channel-set-failed": () => error("failed", "채널 지정에 실패했어요.", "채널을 조회하지 못했거나 저장에 실패했어요. 권한 설정을 확인해보고, 잠시 후 시도해도 오류가 발생한다면 봇 운영자에게 알려주세요."),
  "settings-save-failed": () => error("failed", "설정을 저장하지 못했어요.", "데이터베이스나 저장소에 문제가 있어요. 봇 운영자에게 알려주세요."),
  "dj-role-save-failed": () => error("failed", "저장하지 못했어요", "DJ 역할 저장 중에 오류가 발생했어요. 잠시 후 다시 시도해 주세요."),
  // /join 이 저장한 세션을 되살리지 못했다. 저장된 곡이 없다 · 다시 틀다 실패하고 남은 곡이 없다 · 연달아 실패해 멈췄다 · 되살리다 오류
  "restore-nothing-saved": () => warning("state", "이어 들을 곡이 없어요", "저장된 기록에 곡이 없어서 음성 채널에만 들어왔어요."),
  "restore-nothing-left": () => error("failed", "이어 들을 곡을 틀지 못했어요", "저장된 곡을 다시 틀다 실패했고 남은 곡이 없어요. `/play`로 곡을 넣어 주세요."),
  "restore-failed-in-row": ({ left }) => error("failed", "이어 들을 곡들을 연달아 틀지 못했어요", `남은 ${left}곡은 대기열에 그대로 있고, 곡을 넣으면 이어서 틀어요.`),
  "restore-failed": () => error("failed", "오류가 발생했어요!", "이전에 듣던 곡을 복구하던 중 오류가 발생했어요. 잠시 후에 `/join`을 다시 시도해보세요. 여전히 문제가 있다면 봇 운영자에게 알려주세요."),

  // 대시보드(지금 대시보드의 문장 그대로. 대시보드 개편 때 다시 쓴다): 접속 · 권한
  "login-required": () => warning("permission", "로그인이 필요합니다."),
  "bad-csrf-token": () => warning("stale", "Invalid CSRF token."),
  "no-guild-access": () => warning("permission", "접근 권한이 없습니다"),
  "not-guild-member": () => warning("permission", "서버 멤버가 아닙니다"),
  "bad-tier": () => warning("input", "권한 수준이 올바르지 않습니다"),
  // 대시보드: 상태
  "bot-not-ready": () => error("waiting", "봇이 아직 준비되지 않았습니다."),
  "guild-not-found": () => warning("notFound", "서버를 찾을 수 없습니다."),
  "member-not-found": () => warning("notFound", "서버에서 사용자를 찾을 수 없습니다"),
  "bot-not-in-voice": () => warning("state", "봇이 음성 채널에 없습니다. 먼저 봇을 참가시켜 주세요"),
  "bot-in-other-voice": () => warning("voice", "봇이 이미 다른 음성 채널에서 사용 중입니다"),
  "too-many-requests": () => warning("waiting", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요"),
  "too-many-streams": () => warning("waiting", "이벤트 연결이 너무 많습니다"),
  // 대시보드: 요청 형식
  "bad-request": () => warning("input", "요청 형식이 올바르지 않습니다."),
  "payload-too-large": () => warning("input", "보낸 내용이 너무 깁니다. 줄여서 다시 시도해 주세요."),
  "route-not-found": () => warning("notFound", "요청한 경로를 찾을 수 없습니다."),
  "bad-queue-range": () => warning("input", "대기열 시작 위치나 요청 개수가 올바르지 않습니다."),
  "bad-query": ({ max }) => warning("input", `검색어를 입력해 주세요 (문자열, 최대 ${max}자)`),
  "bad-more-state": () => warning("input", "더 넣을 목록 정보가 올바르지 않습니다"),
  "bad-settings": () => warning("input", "서버 설정 형식이 올바르지 않습니다"),
  "bad-sponsorblock": () => warning("input", "sponsorblock 설정 형식이 올바르지 않습니다"),
  "bad-sponsor-categories": () => warning("input", "sponsorblock.categories는 문자열 배열이어야 합니다"),
  "bad-dj-roles": () => warning("input", "djRoleIds는 역할 ID 문자열 배열이어야 합니다"),
  "too-many-dj-roles": ({ max }) => warning("input", `DJ 역할은 최대 ${max}개까지 지정할 수 있습니다`),
  "bad-bot-channel": () => warning("input", "봇 전용 채널은 일반 텍스트 채널이어야 합니다"),
  // 대시보드: 운영자
  "announce-empty": () => warning("input", "공지 내용을 입력해 주세요."),
  "announce-too-long": ({ max, length }) => warning("input", `공지는 ${max}자까지 보낼 수 있습니다 (지금 ${length}자).`),
  "bad-announce-type": () => warning("input", "공지 종류가 올바르지 않습니다."),
  "announce-no-guilds": () => warning("state", "봇이 들어가 있는 서버가 없습니다."),
  "announce-failed": () => error("failed", "어느 서버에도 보내지 못했습니다 (보낼 수 있는 채널이 없거나 권한이 없습니다)."),
  "leave-guild-failed": () => error("failed", "서버 나가기에 실패했습니다"),
  "deploy-failed": () => error("failed", "배포에 실패했습니다"),
  "suggest-failed": () => error("failed", "후보를 받지 못했습니다"),
  "model-refresh-failed": () => error("failed", "모델 정보를 받지 못했습니다."),
  "cache-clear-failed": () => error("failed", "캐시 초기화에 실패했습니다"),
  "token-count-failed": () => error("failed", "토큰을 세지 못했습니다."),
  "bad-suggest-type": () => warning("input", "자동완성이 없는 종류입니다."),
  "bad-suggest-field": () => warning("input", "자동완성이 없는 칸입니다."),
  "bad-suggest-term": ({ max }) => warning("input", `검색어는 1~${max}자여야 합니다.`),
  "too-many-items": ({ max }) => warning("input", `한 번에 ${max}개까지`),
  "urls-empty": () => warning("input", "유튜브 주소를 적어 주세요."),
  "nothing-to-save": () => warning("input", "보낸 내용이 없습니다."),
  "config-not-found": () => warning("notFound", "그런 설정이 없습니다."),
  "config-invalid": () => warning("input", "설정에 문제가 있습니다."),
  "config-unreadable": () => error("failed", "설정 파일을 읽지 못했습니다."),
  "config-save-failed": () => error("failed", "설정을 저장하지 못했습니다."),
  "storage-unavailable": () => error("failed", "일시적으로 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."),
};

/** 코드의 안내. params 는 그 코드의 문장에 드는 값(rules/problems 의 params), look 은 그리는 쪽의 값 꼴 */
const notice = (code: Code, params: Params = {}, look: Look = PLAIN): Notice => ({ code, ...TEXT[code](params, look) });

export { notice, PLAIN };
export type { Look };
