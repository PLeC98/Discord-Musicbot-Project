"use strict";

// 옮기는 중의 껍데기. 곡 찾기(lookup) · 유튜브 동등물(youtube/equivalent) · 스트림(streamUrl)으로 갔다.
// 옮겨 간 것은 그쪽으로 넘긴다(덮어쓰면 그쪽이 바뀐다). 부르는 곳을 옮기면 없어진다.

const lookup = require("./lookup");
const equivalent = require("./youtube/equivalent");
const streamUrl = require("./streamUrl");

const TrackResolver = {};
for (const [target, names] of [
  [lookup, ["detectPlatform", "isUnsupportedYouTubeLink", "getTrackData", "getCollection", "resolveQuery", "ensureAudioSourceKey"]],
  [equivalent, ["findYouTubeEquivalent", "reresolveYouTube"]],
  [streamUrl, ["getStream"]],
]) {
  for (const name of names) {
    Object.defineProperty(TrackResolver, name, {
      get: () => target[name].bind(target),
      set: (value) => {
        target[name] = value;
      },
      enumerable: true,
    });
  }
}

module.exports = TrackResolver;
