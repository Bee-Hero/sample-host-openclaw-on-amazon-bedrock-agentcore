#!/usr/bin/env node
const ns = process.argv[2] || "";
const jsonRaw = process.argv[3] || "{}";
if (!ns) {
  process.stderr.write(
    "Usage: node synthesize.js <user_id> '{\"text\":\"...\"}'\nuser_id: namespace with underscores (e.g. telegram_12345)\n",
  );
  process.exit(1);
}
let body;
try {
  body = JSON.parse(jsonRaw);
} catch {
  process.stderr.write("Invalid JSON for arguments\n");
  process.exit(1);
}
const { synthesizeSpeechToS3 } = require("/app/polly-tts");
synthesizeSpeechToS3({ text: body.text || "", namespace: ns })
  .then((key) => {
    process.stdout.write(`[VOICE_REPLY:${key}]\n`);
  })
  .catch((e) => {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  });
