// src/ui/text/ko/settings.ts — 설정 화면의 글자를 모두 적어 둔다. 문장을 고치면 여기도 같이 고친다

import { test } from "node:test";
import assert from "node:assert/strict";
import * as settings from "../../../../src/ui/text/ko/settings.ts";

test("모든 문장", () => {
  assert.deepEqual(
    [settings.channelRemoved(), settings.channelSet("<#1>"), settings.playlistLimitReset(50), settings.playlistLimitNow({ count: 50, isDefault: true, min: 1, max: 100 }), settings.playlistLimitNow({ count: 30, isDefault: false, min: 1, max: 100 }), settings.playlistLimitSet(30)],
    [
      { icon: "channel", title: "전용 채널 해제됨", description: "이제 명령어로만 곡을 재생할 수 있어요." },
      { icon: "done", title: "전용 채널 설정됨", description: "<#1> 채널을 봇 전용 채널로 설정했어요.\n\n이 채널에 링크나 검색어를 적으면 바로 재생해요.\n대시보드의 공지도 이 채널로 발송돼요.", inputs: "📋 입력할 수 있는 것", inputsValue: "• 지원하는 플랫폼 링크 (유튜브, 스포티파이, 사운드클라우드)\n• 재생 가능한 미디어 링크\n• 곡 이름이나 아티스트 이름 등의 검색어" },
      { icon: "playlist_add", title: "기본값으로 되돌렸어요", description: "재생목록을 넣으면 한 번에 **50곡**씩 들어가요." },
      { icon: "playlist_add", title: "재생목록에 한 번에 넣을 곡 수", description: "지금은 **50곡**이에요 (기본값).\n`/setplaylistlimit count:<곡 수>`로 바꿀 수 있어요 (1~100곡)." },
      { icon: "playlist_add", title: "재생목록에 한 번에 넣을 곡 수", description: "지금은 **30곡**이에요.\n`/setplaylistlimit count:<곡 수>`로 바꿀 수 있어요 (1~100곡)." },
      { icon: "done", title: "재생목록에 한 번에 넣을 곡 수를 바꿨어요", description: '이제 재생목록을 넣으면 한 번에 **30곡**씩 들어가요.\n남은 곡은 "더 넣기"로 이어 넣을 수 있어요.' },
    ],
  );
});
