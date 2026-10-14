const crypto = require('crypto');
const http = require('http');
const https = require('https');

// ==========================================
// 1. CONFIGURATION
// ==========================================
const BOT_TOKEN = '8885385318:AAF1PqJygt9mC5ZA6imJl0Q-6jvkCjAvfw0';
const ADMIN_CHAT_ID = '6271974217';
const SECRET_SALT = 'Mannsinh_CAD_Suite_2026_SecureKey_#9982!';

const TELEGRAM_HOST = 'api.telegram.org';
const TELEGRAM_BASE_PATH = `/bot${BOT_TOKEN}`;

// ==========================================
// 2. HEALTH CHECK WEB SERVER (FOR 24/7 CLOUD HOSTING)
// ==========================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Mannsinh CAD Suite Bot is alive and running 24/7!\n');
}).listen(PORT, () => {
  console.log(`Web health check server active on port ${PORT}`);
});

// ==========================================
// 3. HELPER FUNCTIONS (STABLE HTTPS)
// ==========================================
const agent = new https.Agent({ keepAlive: true, timeout: 60000 });

function callApi(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const options = {
      hostname: TELEGRAM_HOST,
      port: 443,
      path: `${TELEGRAM_BASE_PATH}/${method}`,
      method: 'POST',
      agent: agent,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      },
      timeout: 35000
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (!json.ok) {
            console.error(`Telegram API Error on [${method}]:`, json.description);
          }
          resolve(json);
        } catch (e) {
          reject(new Error(`Invalid JSON: ${data}`));
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    req.on('error', (err) => {
      reject(err);
    });

    req.write(postData);
    req.end();
  });
}

function generateLifetimeKey(machineId) {
  const cleanMid = machineId.trim().toUpperCase();
  const hash = crypto.createHash('sha256')
    .update(cleanMid + SECRET_SALT)
    .digest('hex')
    .toUpperCase();

  const p1 = hash.substring(0, 4);
  const p2 = hash.substring(4, 8);
  const p3 = hash.substring(8, 12);
  const p4 = hash.substring(12, 16);

  return `LF-${p1}-${p2}-${p3}-${p4}`;
}

const userSessions = new Map();
const pendingRequests = new Map();
let lastUpdateId = 0;

// ==========================================
// 4. TELEGRAM POLLING LOOP
// ==========================================
async function pollUpdates() {
  await callApi('deleteWebhook', { drop_pending_updates: true });
  console.log('>>> Mannsinh License Bot is polling for Telegram updates... <<<');

  while (true) {
    try {
      const res = await callApi('getUpdates', {
        offset: lastUpdateId + 1,
        timeout: 20,
        allowed_updates: ['message', 'callback_query']
      });

      if (res && res.ok && Array.isArray(res.result) && res.result.length > 0) {
        for (const update of res.result) {
          lastUpdateId = update.update_id;
          console.log('\n--- Incoming Update Processed ---');
          await handleUpdate(update).catch(err => console.error('Handler error:', err));
        }
      }
   } catch (e) {
  console.error('Polling error:', e.message);
  // Wait 5s to allow duplicate instances to disconnect cleanly
  await new Promise(r => setTimeout(r, 5000));
}
  }
}

// ==========================================
// 5. UPDATE HANDLER (MESSAGES & BUTTONS)
// ==========================================
async function handleUpdate(update) {
  // A. Admin Button Actions (Approve / Reject)
  if (update.callback_query) {
    const query = update.callback_query;
    if (String(query.from.id) !== String(ADMIN_CHAT_ID)) {
      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Unauthorized!' });
      return;
    }

    const data = query.data;

    if (data.startsWith('approve_')) {
      const reqId = data.replace('approve_', '');
      const req = pendingRequests.get(reqId);

      if (!req || !req.mid) {
        await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Machine ID missing!' });
        return;
      }

      const key = generateLifetimeKey(req.mid);

      // Send the activation key to the client
      await callApi('sendMessage', {
        chat_id: req.clientChatId,
        text: `🎉 *Payment Confirmed!*\n\n` +
              `Here is your **Lifetime Activation Key**:\n\n` +
              `\`${key}\`\n\n` +
              `👉 Copy this key, paste it into your AutoCAD dialog, and click **Activate License**.`,
        parse_mode: 'Markdown'
      });

      // Update admin message caption
      await callApi('editMessageCaption', {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        caption: `✅ *Approved & Key Delivered*\n\n` +
                 `💻 Machine ID: \`${req.mid}\`\n` +
                 `🔑 Generated Key: \`${key}\``,
        parse_mode: 'Markdown'
      });

      pendingRequests.delete(reqId);
      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Key sent!' });
    } else if (data.startsWith('reject_')) {
      const reqId = data.replace('reject_', '');
      const req = pendingRequests.get(reqId);

      if (req) {
        await callApi('sendMessage', {
          chat_id: req.clientChatId,
          text: `❌ Your payment receipt could not be verified. Please check the amount or contact support.`
        });
        pendingRequests.delete(reqId);
      }

      await callApi('editMessageCaption', {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        caption: `❌ *Rejected*`
      });

      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Rejected' });
    }
    return;
  }

  // B. Customer Messages
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    console.log(`[Message from Chat ID ${chatId}]:`, text || (msg.photo ? '[Photo Attachment]' : '[Other]'));

    // 1. /start command
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const passedMid = parts.length > 1 ? parts[1].trim().toUpperCase() : null;

      if (passedMid && passedMid.length >= 8) {
        userSessions.set(chatId, passedMid);
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `👋 *Welcome to Mannsinh CAD Suite Activation!*\n\n` +
                `💻 *Detected Machine ID:* \`${passedMid}\`\n\n` +
                `Please send a photo or screenshot of your **$3 ABA / Bakong payment slip** below.`,
          parse_mode: 'Markdown'
        });
      } else {
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `👋 *Welcome to Mannsinh CAD Suite Activation!*\n\n` +
                `To receive your lifetime activation key:\n` +
                `1️⃣ Send your **Machine Hardware ID** (from AutoCAD dialog).\n` +
                `2️⃣ Send your **$3 ABA / Bakong payment slip** screenshot.`,
          parse_mode: 'Markdown'
        });
      }
      return;
    }

    // 2. Payment receipt image
    if (msg.photo && msg.photo.length > 0) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const caption = msg.caption ? msg.caption.trim().toUpperCase() : '';
      const mid = caption.match(/[A-F0-9]{8,32}/)?.[0] || userSessions.get(chatId) || '';

      const reqId = `REQ_${Date.now()}`;
      pendingRequests.set(reqId, { clientChatId: chatId, mid: mid });

      await callApi('sendPhoto', {
        chat_id: ADMIN_CHAT_ID,
        photo: fileId,
        caption: `📩 *New Payment Slip Received*\n\n` +
                 `👤 Client: @${msg.from.username || msg.from.first_name || 'Customer'}\n` +
                 `💻 Machine ID: \`${mid || 'NOT DETECTED (Ask user)'}\``,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve & Issue Key', callback_data: `approve_${reqId}` },
              { text: '❌ Reject', callback_data: `reject_${reqId}` }
            ]
          ]
        }
      });

      await callApi('sendMessage', {
        chat_id: chatId,
        text: `✅ *Receipt received!* Your slip is under review. Your activation key will be delivered right here once verified.`,
        parse_mode: 'Markdown'
      });
      return;
    }

    // 3. Text inputs (Manual Machine ID)
    if (text && !text.startsWith('/')) {
      const cleanText = text.toUpperCase();
      if (cleanText.length >= 8) {
        userSessions.set(chatId, cleanText);
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `💻 Machine ID saved: \`${cleanText}\`\n\nNow please send the photo of your **$3 payment receipt**.`,
          parse_mode: 'Markdown'
        });
      } else {
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `Please send a valid Machine ID from your AutoCAD activation dialog.`
        });
      }
    }
  }
}

// ==========================================
// 6. START BOT
// ==========================================
pollUpdates();
