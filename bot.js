const crypto = require('crypto');
const http = require('http');

// ==========================================
// 1. CONFIGURATION
// ==========================================
const BOT_TOKEN = '8885385318:AAF1PqJygt9mC5ZA6imJl0Q-6jvkCjAvfw0';
const ADMIN_CHAT_ID = '6271974217';
const SECRET_SALT = 'Mannsinh_CAD_Suite_2026_SecureKey_#9982!';

const TELEGRAM_API = `https://api.telegram.org/bot${BOT_TOKEN}`;

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
// 3. HELPER FUNCTIONS
// ==========================================
async function callApi(method, payload) {
  try {
    const res = await fetch(`${TELEGRAM_API}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    if (!json.ok) {
      console.error(`API Error on ${method}:`, json.description);
    }
    return json;
  } catch (err) {
    console.error(`Network Error on ${method}:`, err.message);
  }
}

function generateLifetimeKey(machineId) {
  const cleanMid = machineId.trim().toUpperCase();
  const payload = `${cleanMid}_LF_${SECRET_SALT}`;
  const hashBuffer = crypto.createHash('sha256').update(payload, 'utf8').digest();
  const hashHex = hashBuffer.subarray(0, 8).toString('hex').toUpperCase();
  return `LF-${hashHex}`;
}

const userSessions = new Map();
const pendingRequests = new Map();
let lastUpdateId = 0;

// ==========================================
// 4. TELEGRAM POLLING LOOP
// ==========================================
async function pollUpdates() {
  await callApi('deleteWebhook', { drop_pending_updates: false });
  console.log('>>> Mannsinh License Bot is polling for Telegram updates... <<<');

  while (true) {
    try {
      const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=20`);
      const data = await res.json();

      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          lastUpdateId = update.update_id;
          console.log('\n--- Incoming Update Processed ---');
          await handleUpdate(update);
        }
      }
    } catch (e) {
      console.error('Polling error:', e.message);
      await new Promise(r => setTimeout(r, 2000));
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
    if (query.from.id.toString() !== ADMIN_CHAT_ID.toString()) {
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

      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Key sent!' });
    } else if (data.startsWith('reject_')) {
      const reqId = data.replace('reject_', '');
      const req = pendingRequests.get(reqId);

      if (req) {
        await callApi('sendMessage', {
          chat_id: req.clientChatId,
          text: `❌ Your payment receipt could not be verified. Please check the amount or contact support.`
        });
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

    // 1. /start command
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const passedMid = parts.length > 1 ? parts[1].trim().toUpperCase() : null;

      if (passedMid && passedMid.length >= 12) {
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
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const caption = msg.caption ? msg.caption.trim().toUpperCase() : '';
      const mid = caption.match(/[A-F0-9]{12,20}/)?.[0] || userSessions.get(chatId) || '';

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
      if (cleanText.length >= 12) {
        userSessions.set(chatId, cleanText);
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `💻 Machine ID saved: \`${cleanText}\`\n\nNow please send the photo of your **$3 payment receipt**.`,
          parse_mode: 'Markdown'
        });
      } else {
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `Please send a valid Machine ID (16 characters from AutoCAD activation dialog).`
        });
      }
    }
  }
}

// ==========================================
// 6. START BOT
// ==========================================
pollUpdates();