"use strict";

const https = require("https");

function postMultipart(botToken, method, fields, fileFieldName, fileBytes, fileName, contentType) {
  const boundary = "----OpenClawBoundary" + Date.now();
  const parts = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
      ),
    );
  }
  const header = Buffer.from(
    `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${fileFieldName}"; filename="${fileName}"\r\n` +
      `Content-Type: ${contentType}\r\n\r\n`,
  );
  const end = Buffer.from(`\r\n--${boundary}--\r\n`);
  const body = Buffer.concat([...parts, header, fileBytes, end]);

  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: "api.telegram.org",
        path: `/bot${botToken}/${method}`,
        method: "POST",
        headers: {
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
          "Content-Length": body.length,
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
    req.setTimeout(60000, () => {
      req.destroy();
      reject(new Error("telegram multipart timeout"));
    });
    req.end(body);
  });
}

async function sendTelegramPhotoBytes(botToken, chatId, imageBytes, caption) {
  const fields = { chat_id: String(chatId) };
  if (caption) fields.caption = caption;
  return postMultipart(
    botToken,
    "sendPhoto",
    fields,
    "photo",
    imageBytes,
    "photo.png",
    "image/png",
  );
}

async function sendTelegramAudioBytes(botToken, chatId, audioBytes, filename) {
  return postMultipart(
    botToken,
    "sendAudio",
    { chat_id: String(chatId) },
    "audio",
    audioBytes,
    filename,
    "audio/mpeg",
  );
}

module.exports = {
  sendTelegramPhotoBytes,
  sendTelegramAudioBytes,
};
