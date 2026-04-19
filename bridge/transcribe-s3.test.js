const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  DeleteTranscriptionJobCommand,
} = require("@aws-sdk/client-transcribe");
const {
  transcribeS3Audio,
  validateAudioS3Key,
  bedrockFormatToTranscribeMediaFormat,
  parseTranscriptHttpsToS3Ref,
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

describe("parseTranscriptHttpsToS3Ref", () => {
  it("parses path-style S3 transcript URL", () => {
    assert.deepEqual(
      parseTranscriptHttpsToS3Ref(
        "https://s3.eu-central-1.amazonaws.com/openclaw-user-files-639/_transcribe_output/oc1.json",
      ),
      {
        bucket: "openclaw-user-files-639",
        key: "_transcribe_output/oc1.json",
      },
    );
  });
  it("parses virtual-hosted-style URL", () => {
    assert.deepEqual(
      parseTranscriptHttpsToS3Ref(
        "https://my-bucket.s3.eu-west-1.amazonaws.com/folder/out.json",
      ),
      { bucket: "my-bucket", key: "folder/out.json" },
    );
  });
  it("returns null for non-S3 hosts", () => {
    assert.equal(
      parseTranscriptHttpsToS3Ref("https://transcript.example/out.json"),
      null,
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

describe("transcribeS3Audio language strategy", () => {
  it("starts with IdentifyLanguage then en-US when identify job fails", async () => {
    process.env.S3_USER_FILES_BUCKET = "b";
    process.env.AWS_REGION = "us-west-2";
    delete process.env.CMK_ARN;
    const starts = [];
    const names = [];
    const tc = {
      async send(cmd) {
        if (cmd instanceof StartTranscriptionJobCommand) {
          starts.push({ ...cmd.input });
          names.push(cmd.input.TranscriptionJobName);
          return {};
        }
        if (cmd instanceof GetTranscriptionJobCommand) {
          const jn = cmd.input.TranscriptionJobName;
          const i = names.indexOf(jn);
          if (i === 0) {
            return {
              TranscriptionJob: {
                TranscriptionJobName: jn,
                TranscriptionJobStatus: "FAILED",
                FailureReason: "identify failed",
              },
            };
          }
          return {
            TranscriptionJob: {
              TranscriptionJobName: jn,
              TranscriptionJobStatus: "COMPLETED",
              Transcript: {
                TranscriptFileUri: "https://transcript.example/out.json",
              },
            },
          };
        }
        if (cmd instanceof DeleteTranscriptionJobCommand) {
          return {};
        }
        throw new Error(`unexpected ${cmd.constructor.name}`);
      },
    };
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        results: { transcripts: [{ transcript: "hello" }] },
      }),
    });
    const text = await transcribeS3Audio({
      s3Key: "telegram_1/_uploads/aud_1.mp3",
      mediaFormat: "mp3",
      namespace: "telegram_1",
      transcribeClient: tc,
      fetchImpl,
    });
    assert.equal(text, "hello");
    assert.equal(starts.length, 2);
    assert.equal(starts[0].IdentifyLanguage, true);
    assert.deepEqual(starts[0].LanguageOptions, ["en-US", "he-IL"]);
    assert.equal(starts[1].LanguageCode, "en-US");
  });

  it("uses he-IL when identify and en-US fail", async () => {
    process.env.S3_USER_FILES_BUCKET = "b";
    process.env.AWS_REGION = "us-west-2";
    delete process.env.CMK_ARN;
    const starts = [];
    const names = [];
    const tc = {
      async send(cmd) {
        if (cmd instanceof StartTranscriptionJobCommand) {
          starts.push({ ...cmd.input });
          names.push(cmd.input.TranscriptionJobName);
          return {};
        }
        if (cmd instanceof GetTranscriptionJobCommand) {
          const jn = cmd.input.TranscriptionJobName;
          const i = names.indexOf(jn);
          if (i <= 1) {
            return {
              TranscriptionJob: {
                TranscriptionJobName: jn,
                TranscriptionJobStatus: "FAILED",
                FailureReason: "no",
              },
            };
          }
          return {
            TranscriptionJob: {
              TranscriptionJobName: jn,
              TranscriptionJobStatus: "COMPLETED",
              Transcript: {
                TranscriptFileUri: "https://transcript.example/out.json",
              },
            },
          };
        }
        if (cmd instanceof DeleteTranscriptionJobCommand) {
          return {};
        }
        throw new Error(`unexpected ${cmd.constructor.name}`);
      },
    };
    const fetchImpl = async () => ({
      ok: true,
      json: async () => ({
        results: { transcripts: [{ transcript: "ok" }] },
      }),
    });
    const text = await transcribeS3Audio({
      s3Key: "telegram_1/_uploads/aud_1.mp3",
      mediaFormat: "mp3",
      namespace: "telegram_1",
      transcribeClient: tc,
      fetchImpl,
    });
    assert.equal(text, "ok");
    assert.equal(starts.length, 3);
    assert.equal(starts[2].LanguageCode, "he-IL");
  });

  it("retries when identify completes with empty transcript", async () => {
    process.env.S3_USER_FILES_BUCKET = "b";
    process.env.AWS_REGION = "us-west-2";
    delete process.env.CMK_ARN;
    const starts = [];
    const names = [];
    const tc = {
      async send(cmd) {
        if (cmd instanceof StartTranscriptionJobCommand) {
          starts.push({ ...cmd.input });
          names.push(cmd.input.TranscriptionJobName);
          return {};
        }
        if (cmd instanceof GetTranscriptionJobCommand) {
          const jn = cmd.input.TranscriptionJobName;
          const i = names.indexOf(jn);
          if (i === 0) {
            return {
              TranscriptionJob: {
                TranscriptionJobName: jn,
                TranscriptionJobStatus: "COMPLETED",
                Transcript: {
                  TranscriptFileUri: "https://transcript.example/empty.json",
                },
              },
            };
          }
          return {
            TranscriptionJob: {
              TranscriptionJobName: jn,
              TranscriptionJobStatus: "COMPLETED",
              Transcript: {
                TranscriptFileUri: "https://transcript.example/out.json",
              },
            },
          };
        }
        if (cmd instanceof DeleteTranscriptionJobCommand) {
          return {};
        }
        throw new Error(`unexpected ${cmd.constructor.name}`);
      },
    };
    let fetchCalls = 0;
    const fetchImpl = async () => {
      fetchCalls += 1;
      if (fetchCalls === 1) {
        return {
          ok: true,
          json: async () => ({
            results: { transcripts: [{ transcript: "   " }] },
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          results: { transcripts: [{ transcript: "from en" }] },
        }),
      };
    };
    const text = await transcribeS3Audio({
      s3Key: "telegram_1/_uploads/aud_1.mp3",
      mediaFormat: "mp3",
      namespace: "telegram_1",
      transcribeClient: tc,
      fetchImpl,
    });
    assert.equal(text, "from en");
    assert.equal(starts.length, 2);
    assert.equal(starts[1].LanguageCode, "en-US");
  });
});
