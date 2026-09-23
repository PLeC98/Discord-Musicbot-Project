"use strict";

// 옮기는 중의 껍데기. 설정 읽기는 yamlStore · genres · status · ai · cookies 로 갔다. 부르는 곳을 옮기면 없어진다.

module.exports = { ...require("./yamlStore"), ...require("./genres"), ...require("./status"), ...require("./ai"), ...require("./cookies") };
