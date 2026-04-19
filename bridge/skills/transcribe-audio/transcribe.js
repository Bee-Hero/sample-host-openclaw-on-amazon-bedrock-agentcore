#!/usr/bin/env node
const ns = process.argv[2] || "";
const s3Key = process.argv[3] || "";
if (!ns || !s3Key) {
  process.stderr.write(
    "Usage: node transcribe.js <user_id> <s3_key>\nuser_id: namespace with underscores (e.g. telegram_12345)\ns3_key: full key under that namespace, must include /_uploads/aud_\n",
  );
  process.exit(1);
}
const { transcribeS3Audio } = require("/app/transcribe-s3");
const ext = (s3Key.split(".").pop() || "mp3").toLowerCase();
transcribeS3Audio({ s3Key, mediaFormat: ext, namespace: ns })
  .then((t) => {
    process.stdout.write(t || "");
    process.stdout.write("\n");
  })
  .catch((e) => {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  });
