const crypto = require("crypto");
const {
  TranscribeClient,
  StartTranscriptionJobCommand,
  GetTranscriptionJobCommand,
  DeleteTranscriptionJobCommand,
} = require("@aws-sdk/client-transcribe");

const OUTPUT_PREFIX = "_transcribe_output/";
const POLL_MS = 1500;
const MAX_WAIT_MS = 120000;

const VALID_NAMESPACE = /^[a-zA-Z][a-zA-Z0-9_-]{1,64}$/;

const FORMAT_TO_TRANSCRIBE = {
  webm: "webm",
  mp3: "mp3",
  mp4: "mp4",
  wav: "wav",
  ogg: "ogg",
  flac: "flac",
  m4a: "mp4",
  mpga: "mp3",
  aac: "mp4",
};

function bedrockFormatToTranscribeMediaFormat(format) {
  if (!format || typeof format !== "string") return "mp3";
  const k = format.toLowerCase();
  return FORMAT_TO_TRANSCRIBE[k] || "mp3";
}

function validateAudioS3Key(s3Key, namespace) {
  if (!s3Key || typeof s3Key !== "string" || s3Key.includes("..")) {
    return "invalid s3Key";
  }
  if (!namespace || !VALID_NAMESPACE.test(namespace)) {
    return "invalid namespace";
  }
  const prefix = `${namespace}/_uploads/aud_`;
  if (!s3Key.startsWith(prefix)) {
    return "s3Key must be under namespace/_uploads/aud_*";
  }
  return null;
}

function buildTranscribeClient(region, transcribeClient) {
  if (transcribeClient) return transcribeClient;
  return new TranscribeClient({ region });
}

async function fetchTranscriptJson(uri, fetchFn) {
  const res = await fetchFn(uri, { method: "GET" });
  if (!res.ok) {
    throw new Error(`transcript download HTTP ${res.status}`);
  }
  const data = await res.json();
  const t = data?.results?.transcripts?.[0]?.transcript;
  return typeof t === "string" ? t.trim() : "";
}

async function transcribeS3Audio(opts) {
  const {
    s3Key,
    mediaFormat,
    namespace,
    transcribeClient: injectedTc,
    fetchImpl,
  } = opts;
  const err = validateAudioS3Key(s3Key, namespace);
  if (err) {
    throw new Error(err);
  }
  const bucket = process.env.S3_USER_FILES_BUCKET;
  const region = process.env.AWS_REGION || "us-west-2";
  if (!bucket) {
    throw new Error("S3_USER_FILES_BUCKET is not set");
  }
  const mediaFmt = bedrockFormatToTranscribeMediaFormat(mediaFormat);
  const jobName = `oc${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 200);
  const mediaUri = `s3://${bucket}/${s3Key}`;
  const tc = buildTranscribeClient(region, injectedTc);
  const startInput = {
    TranscriptionJobName: jobName,
    Media: { MediaFileUri: mediaUri },
    MediaFormat: mediaFmt,
    OutputBucketName: bucket,
    OutputKey: OUTPUT_PREFIX,
  };
  const cmk = process.env.CMK_ARN;
  if (cmk) {
    startInput.OutputEncryptionKMSKeyId = cmk;
  }
  await tc.send(new StartTranscriptionJobCommand(startInput));
  const deadline = Date.now() + MAX_WAIT_MS;
  let status = "";
  while (Date.now() < deadline) {
    const g = await tc.send(
      new GetTranscriptionJobCommand({ TranscriptionJobName: jobName }),
    );
    const job = g.TranscriptionJob;
    status = job?.TranscriptionJobStatus || "";
    if (status === "COMPLETED") {
      const uri = job?.Transcript?.TranscriptFileUri;
      if (!uri) {
        throw new Error("transcribe completed but no TranscriptFileUri");
      }
      const fetchFn = fetchImpl || fetch;
      const text = await fetchTranscriptJson(uri, fetchFn);
      try {
        await tc.send(
          new DeleteTranscriptionJobCommand({
            TranscriptionJobName: jobName,
          }),
        );
      } catch {
      }
      return text;
    }
    if (status === "FAILED") {
      const reason = job?.FailureReason || "unknown";
      try {
        await tc.send(
          new DeleteTranscriptionJobCommand({
            TranscriptionJobName: jobName,
          }),
        );
      } catch {
      }
      throw new Error(`Transcribe job failed: ${reason}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  try {
    await tc.send(
      new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName }),
    );
  } catch {
  }
  throw new Error(`Transcribe job timed out (last status=${status})`);
}

module.exports = {
  transcribeS3Audio,
  validateAudioS3Key,
  bedrockFormatToTranscribeMediaFormat,
  OUTPUT_PREFIX,
};
