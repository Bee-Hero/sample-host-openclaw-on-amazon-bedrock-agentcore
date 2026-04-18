---
name: text-to-speech
description: Convert text to spoken MP3 using Amazon Polly (neural voice), store in the user's S3 namespace, and emit a marker for Telegram or Slack to deliver as audio. Use when the user explicitly asks you to reply in voice, audio, or read aloud.
allowed-tools: Bash(node:*)
---

# Text-to-speech (Amazon Polly)

Synthesizes speech as MP3 under `{user_id}/_voice_out/tts_*.mp3` and prints a `[VOICE_REPLY:full/s3/key]` marker. Include that marker in your assistant message so the router sends the audio after your text.

## Usage

```bash
node /skills/text-to-speech/synthesize.js <user_id> '{"text":"Your reply text here"}'
```

- `user_id`: Namespace with underscores (same as s3-user-files), e.g. `telegram_12345`.
- `text`: Plain UTF-8 text to speak. Roughly **3000 characters maximum** per call; shorten or split if the user wants a very long reading.

## Output

Stdout is a single line:

`[VOICE_REPLY:telegram_12345/_voice_out/tts_1730000000_a1b2c3d4.mp3]`

Paste it into your reply. You may add a short text summary before or after the marker.

## Voice

Default Polly voice is **Joanna** (neural en-US). Override with container env `POLLY_VOICE_ID` (any Polly voice ID supported in your region).

## Notes

- Feishu delivery does not attach audio; users there get text only plus a short notice if you used only a voice marker.
- Scheduled cron responses strip markers from text and do not attach audio files in chat.
