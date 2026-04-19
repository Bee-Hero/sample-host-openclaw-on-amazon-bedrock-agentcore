"use strict";

const crypto = require("crypto");
const { PollyClient, SynthesizeSpeechCommand } = require("@aws-sdk/client-polly");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

const VALID_NAMESPACE = /^[a-zA-Z][a-zA-Z0-9_-]{1,64}$/;
const MAX_CHARS = 3000;

function validateNamespace(namespace) {
  if (!namespace || !VALID_NAMESPACE.test(namespace)) {
    throw new Error("invalid namespace");
  }
}

function getPollyClient() {
  return new PollyClient({ region: process.env.AWS_REGION || "us-west-2" });
}

function getS3() {
  return new S3Client({ region: process.env.AWS_REGION || "us-west-2" });
}

async function synthesizeSpeechToS3({ text, namespace }) {
  validateNamespace(namespace);
  const bucket = process.env.S3_USER_FILES_BUCKET;
  if (!bucket) {
    throw new Error("S3_USER_FILES_BUCKET is not set");
  }
  let t = typeof text === "string" ? text : "";
  t = t.trim();
  if (!t) {
    throw new Error("text is required");
  }
  if (t.length > MAX_CHARS) {
    t = t.slice(0, MAX_CHARS - 3) + "...";
  }
  const voiceId = process.env.POLLY_VOICE_ID || "Joanna";
  const polly = getPollyClient();
  const out = await polly.send(
    new SynthesizeSpeechCommand({
      Text: t,
      OutputFormat: "mp3",
      VoiceId: voiceId,
      Engine: "neural",
    }),
  );
  const chunks = [];
  for await (const c of out.AudioStream) {
    chunks.push(c);
  }
  const audio = Buffer.concat(chunks);
  if (!audio.length) {
    throw new Error("Polly returned empty audio");
  }
  const suffix = crypto.randomBytes(4).toString("hex");
  const s3Key = `${namespace}/_voice_out/tts_${Date.now()}_${suffix}.mp3`;
  await getS3().send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: s3Key,
      Body: audio,
      ContentType: "audio/mpeg",
    }),
  );
  return s3Key;
}

module.exports = {
  synthesizeSpeechToS3,
  MAX_CHARS,
};
