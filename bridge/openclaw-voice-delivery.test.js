const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  collectMediaPathsFromString,
  stripOpenclawTtsMarkers,
  promoteOpenclawTtsInResponse,
  extractPendingTtsMediaPathFromBedrockMessages,
  promoteAssistantAfterTtsToolTurn,
} = require("./openclaw-voice-delivery");

describe("collectMediaPathsFromString", () => {
  it("finds MEDIA lines", () => {
    const t = "x\nMEDIA:/tmp/openclaw/a/b.mp3\ny";
    assert.deepEqual(collectMediaPathsFromString(t), ["/tmp/openclaw/a/b.mp3"]);
  });
  it("returns last path order for multiple", () => {
    const t = "MEDIA:/tmp/openclaw/one.mp3 z MEDIA:/tmp/openclaw/two.mp3";
    const p = collectMediaPathsFromString(t);
    assert.equal(p.length, 2);
    assert.equal(p[1], "/tmp/openclaw/two.mp3");
  });
});

describe("stripOpenclawTtsMarkers", () => {
  it("removes markers and NO_REPLY", () => {
    const t = "[[audio_as_voice]]\nMEDIA:/tmp/openclaw/x.mp3\nNO_REPLY";
    assert.equal(stripOpenclawTtsMarkers(t), "");
  });
  it("keeps caption text", () => {
    const t = "Caption\n[[audio_as_voice]]\nMEDIA:/tmp/openclaw/x.mp3";
    assert.equal(stripOpenclawTtsMarkers(t), "Caption");
  });
});

describe("extractPendingTtsMediaPathFromBedrockMessages", () => {
  it("returns path when last user message is tool-only with MEDIA", () => {
    const msgs = [
      {
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: "x",
              content: [
                {
                  text: "[[audio_as_voice]]\nMEDIA:/tmp/openclaw/tts-a/voice-1.mp3",
                },
              ],
            },
          },
        ],
      },
    ];
    assert.equal(
      extractPendingTtsMediaPathFromBedrockMessages(msgs),
      "/tmp/openclaw/tts-a/voice-1.mp3",
    );
  });
  it("returns null when last user has plain text", () => {
    const msgs = [
      {
        role: "user",
        content: [{ text: "hello" }],
      },
    ];
    assert.equal(extractPendingTtsMediaPathFromBedrockMessages(msgs), null);
  });
  it("returns null for mixed tool and text", () => {
    const msgs = [
      {
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: "x",
              content: [{ text: "MEDIA:/tmp/openclaw/x/voice.mp3" }],
            },
          },
          { text: "follow-up" },
        ],
      },
    ];
    assert.equal(extractPendingTtsMediaPathFromBedrockMessages(msgs), null);
  });
});

describe("promoteAssistantAfterTtsToolTurn", () => {
  it("returns empty when no pending path", async () => {
    assert.equal(
      await promoteAssistantAfterTtsToolTurn("", "ns", [{ role: "user", content: [{ text: "hi" }] }]),
      "",
    );
  });
  it("returns base unchanged when base already has VOICE_REPLY", async () => {
    const t = "[VOICE_REPLY:ns/_voice_out/tts_1.mp3]";
    const msgs = [
      {
        role: "user",
        content: [
          {
            toolResult: {
              toolUseId: "x",
              content: [{ text: "[[audio_as_voice]]\nMEDIA:/tmp/openclaw/a/voice.mp3" }],
            },
          },
        ],
      },
    ];
    assert.equal(await promoteAssistantAfterTtsToolTurn(t, "ns", msgs), t);
  });
});

describe("promoteOpenclawTtsInResponse", () => {
  it("returns unchanged without namespace", async () => {
    const t = "MEDIA:/tmp/openclaw/x.mp3";
    assert.equal(await promoteOpenclawTtsInResponse(t, null, null), t);
  });
  it("skips when VOICE_REPLY present", async () => {
    const t = "hi [VOICE_REPLY:ns/_voice_out/tts_1.mp3]";
    assert.equal(await promoteOpenclawTtsInResponse(t, "ns", null), t);
  });
});
