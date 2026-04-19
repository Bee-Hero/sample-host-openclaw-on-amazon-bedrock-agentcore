"use strict";

const https = require("https");
const { S3Client, GetObjectCommand } = require("@aws-sdk/client-s3");
const { sendTelegramPhotoBytes, sendTelegramAudioBytes } = require("./telegram-multipart");

function s3() {
  return new S3Client({ region: process.env.AWS_REGION || "us-west-2" });
}

async function readS3Object(bucket, key) {
  const resp = await s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
  const chunks = [];
  for await (const c of resp.Body) {
    chunks.push(c);
  }
  return Buffer.concat(chunks);
}

function validateMediaKey(s3Key, namespace, subfolder, filePrefix) {
  if (!s3Key || s3Key.includes("..")) return null;
  const expected = `${namespace}/${subfolder}/${filePrefix}`;
  if (!s3Key.startsWith(expected)) return null;
  return s3Key;
}

async function fetchScreenshotBytes(s3Key, namespace) {
  const key = validateMediaKey(s3Key, namespace, "_screenshots", "screenshot_");
  if (!key) return null;
  const bucket = process.env.S3_USER_FILES_BUCKET;
  if (!bucket) return null;
  try {
    return await readS3Object(bucket, key);
  } catch {
    return null;
  }
}

async function fetchVoiceReplyBytes(s3Key, namespace) {
  const key = validateMediaKey(s3Key, namespace, "_voice_out", "tts_");
  if (!key) return null;
  const bucket = process.env.S3_USER_FILES_BUCKET;
  if (!bucket) return null;
  try {
    return await readS3Object(bucket, key);
  } catch {
    return null;
  }
}

function telegramJsonPost(botToken, method, body) {
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${botToken}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve({ ok: false, description: data });
          }
        });
      },
    );
    req.on("error", reject);
    req.setTimeout(30000, () => {
      req.destroy();
      reject(new Error("telegram timeout"));
    });
    req.end(payload);
  });
}

async function deliverTelegramMediaFromResponse(botToken, chatId, namespace, responseText) {
  const { extractMarkers } = require("./response-markers");
  const { cleanText, screenshotKeys, voiceKeys } = extractMarkers(responseText);
  const results = { cleanText, sent: 0, errors: [] };
  if (cleanText) {
    const r = await telegramJsonPost(botToken, "sendMessage", {
      chat_id: chatId,
      text: cleanText,
    });
    if (r.ok) results.sent += 1;
    else results.errors.push(r.description || "sendMessage failed");
  }
  for (const sk of screenshotKeys) {
    const bytes = await fetchScreenshotBytes(sk, namespace);
    if (bytes) {
      const r = await sendTelegramPhotoBytes(botToken, chatId, bytes, "");
      if (r.ok) results.sent += 1;
      else results.errors.push(r.description || "photo failed");
    }
  }
  for (const vk of voiceKeys) {
    const bytes = await fetchVoiceReplyBytes(vk, namespace);
    if (bytes) {
      const r = await sendTelegramAudioBytes(botToken, chatId, bytes, "reply.mp3");
      if (r.ok) results.sent += 1;
      else results.errors.push(r.description || "audio failed");
    }
  }
  return results;
}

module.exports = {
  deliverTelegramMediaFromResponse,
  fetchScreenshotBytes,
  fetchVoiceReplyBytes,
};
