// 로그 문구: pnpm install의 첫 단계(install 분류). node_modules 없이 돈다

const install = {
  botRunning: ({ holder }: { holder: number | null }) => `봇이 실행 중이라(${holder ? `PID ${holder}` : "PID 모름"}) 설치 안 함. 봇을 끄고 다시 실행하세요`,
};

export { install };
