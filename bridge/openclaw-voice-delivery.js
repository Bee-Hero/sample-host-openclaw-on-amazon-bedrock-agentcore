"use strict";

const fs = require("fs/promises");
const path = require("path");
const { uploadMp3BytesToVoiceOut } = require("./polly-tts");

const MEDIA_LINE_RE = /MEDIA:(\/tmp\/openclaw\/[^\s\n]+)/g;
const AUDIO_AS_VOICE_RE = /\[\[audio_as_voice\]\]/g;
const VOICE_REPLY_RE = /\[VOICE_REPLY:/;

function collectMediaPathsFromString(s) {
  if (!s || typeof s !== "string") return [];
  const out = [];
  let m;
  MEDIA_LINE_RE.lastIndex = 0;
  while ((m = MEDIA_LINE_RE.exec(s)) !== null) {
    out.push(m[1]);
  }
  return out;
}

function stripOpenclawTtsMarkers(text) {
  if (!text || typeof text !== "string") return "";
  let t = text.replace(AUDIO_AS_VOICE_RE, "");
  t = t.replace(/MEDIA:\/tmp\/openclaw\/[^\s\n]+/g, "");
  t = t.replace(/\bNO_REPLY\b/gi, "");
  t = t.replace(/\n{3,}/g, "\n\n").trim();
  return t;
}

async function readValidatedLocalTtsFile(filePath) {
  const resolved = path.resolve(filePath);
  const prefix = path.resolve("/tmp/openclaw");
  if (!resolved.startsWith(prefix + path.sep) && resolved !== prefix) {
    throw new Error("path outside openclaw tts dir");
  }
  const st = await fs.stat(resolved);
  if (!st.isFile()) {
    throw new Error("not a file");
  }
  const max = 12 * 1024 * 1024;
  if (st.size > max) {
    throw new Error("file too large");
  }
  return fs.readFile(resolved);
}

async function promoteOpenclawTtsInResponse(text, namespace, lastMediaHint) {
  const base = typeof text === "string" ? text : "";
  if (!namespace) {
    return base;
  }
  if (VOICE_REPLY_RE.test(base)) {
    return base;
  }
  const fromText = collectMediaPathsFromString(base);
  const fromHint = lastMediaHint ? [lastMediaHint] : [];
  const merged = [...fromText, ...fromHint];
  const localPath = merged.length ? merged[merged.length - 1] : null;
  if (!localPath) {
    return base;
  }
  const buf = await readValidatedLocalTtsFile(localPath);
  const key = await uploadMp3BytesToVoiceOut({ buffer: buf, namespace });
  let out = stripOpenclawTtsMarkers(base);
  if (!out) {
    return `[VOICE_REPLY:${key}]`;
  }
  if (out.includes(`[VOICE_REPLY:${key}]`)) {
    return out;
  }
  return `${out}\n\n[VOICE_REPLY:${key}]`;
}

function extractPendingTtsMediaPathFromBedrockMessages(messages) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return null;
  }
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !Array.isArray(last.content)) {
    return null;
  }
  const paths = [];
  for (const block of last.content) {
    if (block.text != null && String(block.text).trim() !== "") {
      return null;
    }
    if (block.image || block.document || block.video || block.audio) {
      return null;
    }
    if (!block.toolResult || !Array.isArray(block.toolResult.content)) {
      return null;
    }
    for (const item of block.toolResult.content) {
      if (item && typeof item.text === "string") {
        for (const p of collectMediaPathsFromString(item.text)) {
          paths.push(p);
        }
      }
    }
  }
  if (paths.length === 0) {
    return null;
  }
  return paths[paths.length - 1];
}

async function promoteAssistantAfterTtsToolTurn(text, namespace, bedrockMessages) {
  const base = typeof text === "string" ? text : "";
  if (!namespace) {
    return base;
  }
  const pending = extractPendingTtsMediaPathFromBedrockMessages(bedrockMessages);
  if (!pending) {
    return base;
  }
  if (VOICE_REPLY_RE.test(base)) {
    return base;
  }
  try {
    return await promoteOpenclawTtsInResponse(base, namespace, pending);
  } catch (err) {
    console.warn(`[openclaw-voice] promoteAssistantAfterTtsToolTurn: ${err.message}`);
    return base;
  }
}

module.exports = {
  promoteOpenclawTtsInResponse,
  promoteAssistantAfterTtsToolTurn,
  extractPendingTtsMediaPathFromBedrockMessages,
  collectMediaPathsFromString,
  stripOpenclawTtsMarkers,
};
