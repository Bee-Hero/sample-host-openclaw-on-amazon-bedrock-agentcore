"use strict";

const SCREENSHOT_MARKER_RE = /\[SCREENSHOT:([^\]]+)\]/g;
const VOICE_REPLY_MARKER_RE = /\[VOICE_REPLY:([^\]]+)\]/g;

function extractMarkers(text) {
  const screenshotKeys = [];
  const voiceKeys = [];
  if (typeof text !== "string" || !text) {
    return { cleanText: "", screenshotKeys, voiceKeys };
  }
  let m;
  SCREENSHOT_MARKER_RE.lastIndex = 0;
  while ((m = SCREENSHOT_MARKER_RE.exec(text)) !== null) {
    screenshotKeys.push(m[1]);
  }
  VOICE_REPLY_MARKER_RE.lastIndex = 0;
  while ((m = VOICE_REPLY_MARKER_RE.exec(text)) !== null) {
    voiceKeys.push(m[1]);
  }
  let work = text.replace(/\[SCREENSHOT:[^\]]+\]/g, "");
  work = work.replace(/\[VOICE_REPLY:[^\]]+\]/g, "");
  const cleanText = work
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return { cleanText, screenshotKeys, voiceKeys };
}

module.exports = {
  extractMarkers,
  SCREENSHOT_MARKER_RE,
  VOICE_REPLY_MARKER_RE,
};
