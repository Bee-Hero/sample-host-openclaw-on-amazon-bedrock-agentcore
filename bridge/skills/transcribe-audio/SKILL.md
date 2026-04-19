---
name: transcribe-audio
description: Transcribe audio files stored in the user's S3 uploads using Amazon Transcribe. Use when the user asks to turn voice or audio into text for a file already in their namespace (for example under _uploads). Incoming voice from Slack is transcribed automatically before the model sees the message; this skill is for other audio objects the user points you to.
allowed-tools: Bash(node:*)
---

# Transcribe audio (Amazon Transcribe)

Runs an asynchronous Amazon Transcribe job on an object in your user files bucket. The object must live under your namespace and use the voice upload prefix `/_uploads/aud_`.

## Usage

```bash
node /skills/transcribe-audio/transcribe.js <user_id> <s3_key>
```

- `user_id`: Your namespace with underscores (for example `telegram_12345`), same as for s3-user-files.
- `s3_key`: Full S3 object key including the namespace prefix, for example `telegram_12345/_uploads/aud_1700000000_a1b2c3d4.webm`.

The transcript text is printed to stdout.

## Notes

- Supported formats follow the bridge upload allowlist (webm, mp3, mp4, wav, ogg, flac, m4a, and similar).
- Transcription can take from a few seconds to around two minutes for longer files.
