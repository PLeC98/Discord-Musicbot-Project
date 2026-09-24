// 설정 문제를 찍고, 있으면 멈춘다. config 는 불러와도 멈추지 않고 목록만 내므로, 기동과 명령 배포 스크립트가
// 첫 줄에서 이것을 부른다. out: warn · error 를 가진 것(로거나 console)
function stopOnConfigProblems(config, out) {
  config.warnings.forEach((line) => out.warn(line));
  if (config.problems.length === 0) return;
  config.problems.forEach((line) => out.error(line));
  process.exit(1);
}

const exported = { stopOnConfigProblems };
export default exported;
export { exported as "module.exports" };
