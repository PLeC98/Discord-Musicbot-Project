// 로그 문구: 바깥 도구의 고정 버전 갱신(scripts/check-vendor-updates)

const vendor = {
  lineNotFound: ({ name }: { name: string }) => `${name} 줄을 찾지 못함`,
  bgutilCommitUnread: ({ tag, sha }: { tag: string; sha: string }) => `bgutil ${tag}의 커밋을 읽지 못했습니다: ${sha}`,
  bgutilServerFileFailed: ({ commit, name, status }: { commit: string; name: string; status: number }) => `bgutil ${commit}의 server/${name} 조회 실패: ${status}`,
  bgutilAuditUnread: ({ commit, detail }: { commit: string; detail: string }) => `npm audit 결과를 읽지 못했습니다(bgutil ${commit}): ${detail}`,
  cloudflareListMalformed: ({ family }: { family: string }) => `Cloudflare ips-${family}: 목록 형식이 아님`,
  ytdlpPublicKeyProblem: ({ problem }: { problem: string }) => `yt-dlp 저장소의 public.key: ${problem}`,
  bgutilNewerCommit: ({ tag }: { tag: string }) => `bgutil ${tag}의 커밋`,
  bgutilAuditCurrent: () => `bgutil lockfile 취약점 점검`,
  bgutilAuditNewer: ({ tag }: { tag: string }) => `bgutil ${tag} lockfile 취약점 점검`,
};

export { vendor };
