// 기동. 설정 문제를 먼저 보고, 문제가 없을 때만 본체(src/app/main.js)를 불러온다.
// 본체를 맨 위에서 불러오지 않는 이유: 불러올 때 일하는 모듈이 생겨도 설정 검사가 구조적으로 먼저 돈다.

require("./src/infra/log/sink"); // 다른 무엇보다 먼저 콘솔을 가로챈다
const config = require("./config");

require("./src/app/configCheck").stopOnConfigProblems(config, require("./src/infra/log/logger").child({ category: "config" }));

require("./src/app/main").main();
