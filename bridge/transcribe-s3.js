const crypto = require("crypto");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
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

function buildS3Client(region, s3Client) {
  if (s3Client) return s3Client;
  return new S3Client({ region });
}

function parseTranscriptHttpsToS3Ref(uri) {
  if (!uri || typeof uri !== "string") return null;
  try {
    const u = new URL(uri);
    const path = decodeURIComponent(u.pathname.replace(/^\//, ""));
    const host = u.hostname.toLowerCase();
    const pathStyle = /^s3[.-]([a-z0-9-]+)\.amazonaws\.com$/.exec(host);
    if (pathStyle && path) {
      const i = path.indexOf("/");
      if (i <= 0) return null;
      return { bucket: path.slice(0, i), key: path.slice(i + 1) };
    }
    const vh = /^(.+)\.s3[.-]([a-z0-9-]+)\.amazonaws\.com$/.exec(host);
    if (vh && path) {
      return { bucket: vh[1], key: path };
    }
  } catch {
    return null;
  }
  return null;
}

function newJobName() {
  return `oc${crypto.randomUUID().replace(/-/g, "")}`.slice(0, 200);
}

async function deleteJobQuietly(tc, jobName) {
  try {
    await tc.send(
      new DeleteTranscriptionJobCommand({ TranscriptionJobName: jobName }),
    );
  } catch {
  }
}

async function fetchTranscriptJson(uri, fetchFn, s3) {
  const ref = parseTranscriptHttpsToS3Ref(uri);
  let data;
  if (ref && s3) {
    const out = await s3.send(
      new GetObjectCommand({ Bucket: ref.bucket, Key: ref.key }),
    );
    const raw = await out.Body.transformToString();
    data = JSON.parse(raw);
  } else {
    const res = await fetchFn(uri, { method: "GET" });
    if (!res.ok) {
      throw new Error(`transcript download HTTP ${res.status}`);
    }
    data = await res.json();
  }
  const t = data?.results?.transcripts?.[0]?.transcript;
  return typeof t === "string" ? t.trim() : "";
}

async function pollTranscriptionJob(tc, jobName, fetchFn, s3) {
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
        await deleteJobQuietly(tc, jobName);
        throw new Error("transcribe completed but no TranscriptFileUri");
      }
      const fetchImpl = fetchFn || fetch;
      const text = await fetchTranscriptJson(uri, fetchImpl, s3);
      await deleteJobQuietly(tc, jobName);
      return text;
    }
    if (status === "FAILED") {
      const reason = job?.FailureReason || "unknown";
      await deleteJobQuietly(tc, jobName);
      throw new Error(`Transcribe job failed: ${reason}`);
    }
    await new Promise((r) => setTimeout(r, POLL_MS));
  }
  await deleteJobQuietly(tc, jobName);
  throw new Error(`Transcribe job timed out (last status=${status})`);
}

async function startAndPollTranscription(tc, startInput, fetchFn, s3) {
  await tc.send(new StartTranscriptionJobCommand(startInput));
  return pollTranscriptionJob(tc, startInput.TranscriptionJobName, fetchFn, s3);
}

const LANGUAGE_ATTEMPTS = [
  { IdentifyLanguage: true, LanguageOptions: ["en-US", "he-IL"] },
  { LanguageCode: "en-US" },
  { LanguageCode: "he-IL" },
];

async function transcribeS3Audio(opts) {
  const {
    s3Key,
    mediaFormat,
    namespace,
    transcribeClient: injectedTc,
    s3Client: injectedS3,
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
  const mediaUri = `s3://${bucket}/${s3Key}`;
  const tc = buildTranscribeClient(region, injectedTc);
  const s3 = buildS3Client(region, injectedS3);
  const base = {
    Media: { MediaFileUri: mediaUri },
    MediaFormat: mediaFmt,
    OutputBucketName: bucket,
    OutputKey: OUTPUT_PREFIX,
  };
  const cmk = process.env.CMK_ARN;
  if (cmk) {
    base.OutputEncryptionKMSKeyId = cmk;
  }
  let lastErr;
  const n = LANGUAGE_ATTEMPTS.length;
  for (let i = 0; i < n; i++) {
    const lang = LANGUAGE_ATTEMPTS[i];
    const jobName = newJobName();
    const startInput = { ...base, ...lang, TranscriptionJobName: jobName };
    try {
      const text = await startAndPollTranscription(tc, startInput, fetchImpl, s3);
      if (text.trim() || i === n - 1) {
        return text;
      }
      lastErr = new Error("Transcribe returned empty transcript");
    } catch (e) {
      lastErr = e;
      if (e?.message && /timed out/i.test(e.message)) {
        throw e;
      }
    }
  }
  throw lastErr;
}

module.exports = {
  transcribeS3Audio,
  validateAudioS3Key,
  bedrockFormatToTranscribeMediaFormat,
  parseTranscriptHttpsToS3Ref,
  OUTPUT_PREFIX,
};
