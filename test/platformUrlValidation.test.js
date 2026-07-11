"use strict";

process.env.DISCORD_TOKEN ||= "test-token";
process.env.CLIENT_ID ||= "test-client";

const test = require("node:test");
const assert = require("node:assert/strict");
const TrackResolver = require("../src/TrackResolver");
const YouTube = require("../src/YouTube");
const Spotify = require("../src/Spotify");
const SoundCloud = require("../src/SoundCloud");
const CacheManager = require("../src/CacheManager");

test("accepts supported media hosts by parsed hostname", () => {
  assert.equal(TrackResolver.detectPlatform("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "youtube");
  assert.equal(TrackResolver.detectPlatform("https://open.spotify.com/track/123abc"), "spotify");
  assert.equal(TrackResolver.detectPlatform("spotify:track:123abc"), "spotify");
  assert.equal(TrackResolver.detectPlatform("https://soundcloud.com/artist/track"), "soundcloud");
});

test("does not treat embedded domain text as a trusted media URL", () => {
  const internalPlaylist = "http://127.0.0.1:33333/youtube.com/playlist?list=PL123";
  assert.equal(YouTube.isYouTubeURL(internalPlaylist), false);
  assert.equal(YouTube.isPlaylist(internalPlaylist), false);
  assert.equal(YouTube.isYouTubeURL("https://youtube.com@127.0.0.1/watch?v=dQw4w9WgXcQ"), false);
  assert.equal(Spotify.isSpotifyURL("https://evil.example/open.spotify.com/track/123abc"), false);
  assert.equal(SoundCloud.isSoundCloudURL("https://evil.example/soundcloud.com/artist/track"), false);
});

test("recognizes canonical YouTube playlists and video IDs", () => {
  assert.equal(YouTube.isPlaylist("https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123"), true);
  assert.equal(YouTube.isPlaylist("https://youtu.be/dQw4w9WgXcQ?list=PL123"), true);
  assert.equal(YouTube.extractVideoId("https://m.youtube.com/shorts/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
  assert.equal(YouTube.extractVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ"), "dQw4w9WgXcQ");
});

test("cache normalization only canonicalizes genuine YouTube URLs", () => {
  const disguised = "https://evil.example/youtube.com/watch?v=dQw4w9WgXcQ";
  assert.equal(CacheManager._normalizeSourceUrl(disguised), disguised);
  assert.equal(
    CacheManager._normalizeSourceUrl("https://youtu.be/dQw4w9WgXcQ"),
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  );
});
