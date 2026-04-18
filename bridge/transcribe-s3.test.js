const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  validateAudioS3Key,
  bedrockFormatToTranscribeMediaFormat,
} = require("./transcribe-s3");

describe("validateAudioS3Key", () => {
  it("accepts valid upload key", () => {
    assert.equal(
      validateAudioS3Key("telegram_1/_uploads/aud_1.webm", "telegram_1"),
      null,
    );
  });
  it("rejects path traversal", () => {
    assert.ok(validateAudioS3Key("telegram_1/../x", "telegram_1"));
  });
  it("rejects wrong prefix", () => {
    assert.ok(
      validateAudioS3Key("telegram_1/_uploads/img_1.jpeg", "telegram_1"),
    );
  });
  it("rejects namespace mismatch", () => {
    assert.ok(
      validateAudioS3Key("telegram_2/_uploads/aud_1.webm", "telegram_1"),
    );
  });
});

describe("bedrockFormatToTranscribeMediaFormat", () => {
  it("maps webm", () => {
    assert.equal(bedrockFormatToTranscribeMediaFormat("webm"), "webm");
  });
  it("maps mpga to mp3", () => {
    assert.equal(bedrockFormatToTranscribeMediaFormat("mpga"), "mp3");
  });
});
