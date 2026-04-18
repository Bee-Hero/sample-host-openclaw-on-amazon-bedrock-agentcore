const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { extractMarkers } = require("./response-markers");

describe("extractMarkers", () => {
  it("returns empty for non-string", () => {
    const r = extractMarkers(null);
    assert.equal(r.cleanText, "");
    assert.deepEqual(r.screenshotKeys, []);
    assert.deepEqual(r.voiceKeys, []);
  });
  it("collects screenshot and voice keys and strips markers", () => {
    const t =
      "Hello [SCREENSHOT:ns/_screenshots/x.png] mid [VOICE_REPLY:ns/_voice_out/tts_1.mp3] tail";
    const r = extractMarkers(t);
    assert.equal(r.cleanText, "Hello mid tail");
    assert.deepEqual(r.screenshotKeys, ["ns/_screenshots/x.png"]);
    assert.deepEqual(r.voiceKeys, ["ns/_voice_out/tts_1.mp3"]);
  });
});
