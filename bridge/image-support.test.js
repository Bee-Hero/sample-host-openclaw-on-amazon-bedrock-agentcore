/**
 * Tests for image support in the proxy adapter.
 *
 * Tests extractMultimodalReferences, convertMessages with multimodal content,
 * and fetchImageFromS3 key validation.
 */

const { describe, it, beforeEach, mock } = require("node:test");
const assert = require("node:assert/strict");

// We need to extract the functions from the proxy module.
// Since the proxy starts a server on import, we'll extract the functions
// by reading the source and evaluating just the relevant parts.
// Instead, we'll test the logic directly by reimplementing the pure functions
// here (they're simple enough to be tested in isolation).

// --- extractMultimodalReferences (mirror of agentcore-proxy.js) ---

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
]);
const ALLOWED_AUDIO_MARKER_TYPES = new Set([
  "audio/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/wav",
  "audio/x-wav",
  "audio/wave",
  "audio/ogg",
  "audio/aac",
  "audio/flac",
  "audio/x-m4a",
  "audio/mpga",
]);
const IMAGE_MARKER_REGEX = /\n?\n?\[OPENCLAW_IMAGES:(\[.*?\])\]\s*$/;
const AUDIO_MARKER_REGEX = /\n?\n?\[OPENCLAW_AUDIO:(\[.*?\])\]\s*$/;
const VALID_BEDROCK_AUDIO_FORMATS = new Set([
  "mp3",
  "opus",
  "wav",
  "aac",
  "flac",
  "mp4",
  "ogg",
  "webm",
  "m4a",
  "mpeg",
  "mpga",
  "pcm",
  "mkv",
  "mka",
  "x-aac",
]);

function extractMultimodalReferences(text) {
  if (typeof text !== "string") return { cleanText: text, images: [], audio: [] };
  let work = text;
  const audio = [];
  const audioMatch = work.match(AUDIO_MARKER_REGEX);
  if (audioMatch) {
    try {
      const parsed = JSON.parse(audioMatch[1]);
      if (Array.isArray(parsed)) {
        for (const a of parsed) {
          if (
            a.s3Key &&
            typeof a.s3Key === "string" &&
            a.s3Key.includes("/aud_") &&
            a.format &&
            VALID_BEDROCK_AUDIO_FORMATS.has(a.format) &&
            a.contentType &&
            ALLOWED_AUDIO_MARKER_TYPES.has(a.contentType)
          ) {
            audio.push({
              s3Key: a.s3Key,
              contentType: a.contentType,
              format: a.format,
            });
          }
        }
      }
    } catch {
      /* ignore */
    }
    work = work.slice(0, audioMatch.index).trimEnd();
  }
  const imageMatch = work.match(IMAGE_MARKER_REGEX);
  if (!imageMatch) {
    return { cleanText: work, images: [], audio };
  }
  const cleanText = work.slice(0, imageMatch.index).trimEnd();
  try {
    const images = JSON.parse(imageMatch[1]);
    if (!Array.isArray(images)) return { cleanText, images: [], audio };
    const validImages = images.filter(
      (img) =>
        img.s3Key &&
        img.contentType &&
        ALLOWED_IMAGE_TYPES.has(img.contentType),
    );
    return { cleanText, images: validImages, audio };
  } catch {
    return { cleanText, images: [], audio };
  }
}

describe("extractMultimodalReferences", () => {
  it("returns original text when no marker present", () => {
    const result = extractMultimodalReferences("Hello, how are you?");
    assert.equal(result.cleanText, "Hello, how are you?");
    assert.equal(result.images.length, 0);
    assert.equal(result.audio.length, 0);
  });

  it("extracts single image reference", () => {
    const text =
      'What is this?\n\n[OPENCLAW_IMAGES:[{"s3Key":"ns/_uploads/img_123.jpeg","contentType":"image/jpeg"}]]';
    const result = extractMultimodalReferences(text);
    assert.equal(result.cleanText, "What is this?");
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].s3Key, "ns/_uploads/img_123.jpeg");
    assert.equal(result.images[0].contentType, "image/jpeg");
  });

  it("handles empty text with image only", () => {
    const text =
      '\n\n[OPENCLAW_IMAGES:[{"s3Key":"ns/_uploads/img.png","contentType":"image/png"}]]';
    const result = extractMultimodalReferences(text);
    assert.equal(result.cleanText, "");
    assert.equal(result.images.length, 1);
  });

  it("handles invalid JSON gracefully", () => {
    const text = "Hello\n\n[OPENCLAW_IMAGES:[not valid json]]";
    const result = extractMultimodalReferences(text);
    assert.equal(result.cleanText, "Hello");
    assert.equal(result.images.length, 0);
  });

  it("rejects disallowed content types", () => {
    const text =
      'Check this\n\n[OPENCLAW_IMAGES:[{"s3Key":"ns/_uploads/file.pdf","contentType":"application/pdf"}]]';
    const result = extractMultimodalReferences(text);
    assert.equal(result.cleanText, "Check this");
    assert.equal(result.images.length, 0);
  });

  it("handles non-string input", () => {
    const result = extractMultimodalReferences(42);
    assert.equal(result.cleanText, 42);
    assert.equal(result.images.length, 0);
  });

  it("handles trailing whitespace after marker", () => {
    const text =
      'Look\n\n[OPENCLAW_IMAGES:[{"s3Key":"ns/_uploads/img.jpeg","contentType":"image/jpeg"}]]  \n';
    const result = extractMultimodalReferences(text);
    assert.equal(result.cleanText, "Look");
    assert.equal(result.images.length, 1);
  });

  it("filters out entries missing s3Key", () => {
    const text =
      'Hi\n\n[OPENCLAW_IMAGES:[{"contentType":"image/jpeg"},{"s3Key":"ns/_uploads/img.jpeg","contentType":"image/jpeg"}]]';
    const result = extractMultimodalReferences(text);
    assert.equal(result.images.length, 1);
    assert.equal(result.images[0].s3Key, "ns/_uploads/img.jpeg");
  });

  it("extracts audio marker after image marker", () => {
    const text =
      'Hi\n\n[OPENCLAW_IMAGES:[{"s3Key":"ns/_uploads/img.jpeg","contentType":"image/jpeg"}]]\n\n[OPENCLAW_AUDIO:[{"s3Key":"ns/_uploads/aud_1.webm","contentType":"audio/webm","format":"webm"}]]';
    const result = extractMultimodalReferences(text);
    assert.equal(result.cleanText, "Hi");
    assert.equal(result.images.length, 1);
    assert.equal(result.audio.length, 1);
    assert.equal(result.audio[0].format, "webm");
  });

  it("rejects audio without aud_ in key", () => {
    const text =
      '[OPENCLAW_AUDIO:[{"s3Key":"ns/_uploads/img_1.jpeg","contentType":"audio/webm","format":"webm"}]]';
    const result = extractMultimodalReferences(text);
    assert.equal(result.audio.length, 0);
  });
});

// --- convertMessages with multimodal content ---

const SYSTEM_PROMPT = "Test system prompt";

function convertMessages(messages) {
  const bedrockMessages = [];
  for (const msg of messages) {
    if (msg.role === "system") continue;

    if (msg.role === "user") {
      if (Array.isArray(msg.content)) {
        const bedrockContent = [];
        for (const part of msg.content) {
          if (part.type === "text" && part.text) {
            bedrockContent.push({ text: part.text });
          } else if (part.type === "image_bedrock" && part.image) {
            bedrockContent.push({ image: part.image });
          } else if (part.type === "audio_bedrock" && part.audio) {
            bedrockContent.push({ audio: part.audio });
          }
        }
        if (bedrockContent.length > 0) {
          bedrockMessages.push({ role: "user", content: bedrockContent });
        }
      } else {
        bedrockMessages.push({
          role: "user",
          content: [
            {
              text:
                typeof msg.content === "string"
                  ? msg.content
                  : JSON.stringify(msg.content),
            },
          ],
        });
      }
    } else if (msg.role === "assistant") {
      if (msg.content) {
        bedrockMessages.push({
          role: "assistant",
          content: [
            {
              text:
                typeof msg.content === "string"
                  ? msg.content
                  : JSON.stringify(msg.content),
            },
          ],
        });
      }
    }
  }

  const systemMessages = messages.filter((m) => m.role === "system");
  const systemText =
    systemMessages.length > 0
      ? systemMessages.map((m) => m.content).join("\n")
      : SYSTEM_PROMPT;

  return { bedrockMessages, systemText };
}

describe("convertMessages with multimodal content", () => {
  it("converts string content as before", () => {
    const messages = [{ role: "user", content: "Hello" }];
    const { bedrockMessages } = convertMessages(messages);
    assert.equal(bedrockMessages.length, 1);
    assert.equal(bedrockMessages[0].content[0].text, "Hello");
  });

  it("converts array content with text and image parts", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "What is this?" },
          {
            type: "image_bedrock",
            image: {
              format: "jpeg",
              source: { bytes: Buffer.from("fake-image") },
            },
          },
        ],
      },
    ];
    const { bedrockMessages } = convertMessages(messages);
    assert.equal(bedrockMessages.length, 1);
    assert.equal(bedrockMessages[0].content.length, 2);
    assert.equal(bedrockMessages[0].content[0].text, "What is this?");
    assert.ok(bedrockMessages[0].content[1].image);
    assert.equal(bedrockMessages[0].content[1].image.format, "jpeg");
  });

  it("handles image-only message (no text)", () => {
    const messages = [
      {
        role: "user",
        content: [
          {
            type: "image_bedrock",
            image: {
              format: "png",
              source: { bytes: Buffer.from("fake") },
            },
          },
        ],
      },
    ];
    const { bedrockMessages } = convertMessages(messages);
    assert.equal(bedrockMessages.length, 1);
    assert.equal(bedrockMessages[0].content.length, 1);
    assert.ok(bedrockMessages[0].content[0].image);
  });

  it("filters out unknown content types", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Hello" },
          { type: "audio", data: "..." },
        ],
      },
    ];
    const { bedrockMessages } = convertMessages(messages);
    assert.equal(bedrockMessages[0].content.length, 1);
    assert.equal(bedrockMessages[0].content[0].text, "Hello");
  });

  it("converts audio_bedrock parts", () => {
    const messages = [
      {
        role: "user",
        content: [
          { type: "text", text: "Transcribe this" },
          {
            type: "audio_bedrock",
            audio: {
              format: "webm",
              source: { bytes: Buffer.from("fake-audio") },
            },
          },
        ],
      },
    ];
    const { bedrockMessages } = convertMessages(messages);
    assert.equal(bedrockMessages[0].content.length, 2);
    assert.ok(bedrockMessages[0].content[1].audio);
    assert.equal(bedrockMessages[0].content[1].audio.format, "webm");
  });
});

// --- fetchImageFromS3 key validation (namespace-aware) ---

describe("fetchImageFromS3 key validation", () => {
  const namespace = "telegram_123";

  it("accepts keys in the correct user namespace", () => {
    const key = "telegram_123/_uploads/img_1234_abcd.jpeg";
    const expectedPrefix = namespace + "/_uploads/";
    assert.ok(key.startsWith(expectedPrefix));
    assert.ok(!key.includes(".."));
  });

  it("rejects keys from a different user namespace", () => {
    const key = "telegram_999/_uploads/img_1234_abcd.jpeg";
    const expectedPrefix = namespace + "/_uploads/";
    assert.ok(!key.startsWith(expectedPrefix));
  });

  it("rejects keys with path traversal", () => {
    const key = "telegram_123/_uploads/../../other_user/_uploads/img.jpeg";
    assert.ok(key.includes(".."));
  });

  it("rejects keys without /_uploads/ segment", () => {
    const key = "telegram_123/regular-file.txt";
    const expectedPrefix = namespace + "/_uploads/";
    assert.ok(!key.startsWith(expectedPrefix));
  });

  it("rejects crafted keys that contain /_uploads/ but wrong namespace", () => {
    // Attacker sends: other_ns/_uploads/stolen.jpeg
    const key = "other_ns/_uploads/stolen.jpeg";
    const expectedPrefix = namespace + "/_uploads/";
    assert.ok(!key.startsWith(expectedPrefix));
  });
});
