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
// 3. HELPER FUNCTIONS & KEY GENERATION
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

function formatDate(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

// Generates tamper-proof 3-part key: PREFIX-EXPIRY-SIGNATURE
function generatePluginKey(machineId, tier) {
  const cleanMid = machineId.trim().toUpperCase();
  const now = new Date();
  let expiryTag = 'PERM';

  if (tier === 'M3') {
    // 90 Days from now in UTC
    const exp = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);
    expiryTag = formatDate(exp);
  } else {
    tier = 'LF';
    expiryTag = 'PERM';
  }

  // Exact formula: $"{machineId}_{prefix}_{expiryTag}_{SecretSalt}"
  const payload = `${cleanMid}_${tier}_${expiryTag}_${SECRET_SALT}`;
  const hashBuffer = crypto.createHash('sha256').update(payload, 'utf8').digest();
  const signature = hashBuffer.subarray(0, 8).toString('hex').toUpperCase();

  return {
    key: `${tier}-${expiryTag}-${signature}`,
    tier: tier,
    expiryTag: expiryTag
  };
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
  // A. Admin Button Actions (Approve M3 / Approve LF / Reject)
  if (update.callback_query) {
    const query = update.callback_query;
    if (query.from.id.toString() !== ADMIN_CHAT_ID.toString()) {
      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Unauthorized!' });
      return;
    }

    const data = query.data;

    // Handles approve_M3_REQID or approve_LF_REQID
    if (data.startsWith('approve_')) {
      const parts = data.split('_');
      const tier = parts[1]; // 'M3' or 'LF'
      const reqId = parts.slice(2).join('_');
      const req = pendingRequests.get(reqId);

      if (!req || !req.mid) {
        await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Machine ID missing!' });
        return;
      }

      const { key, expiryTag } = generatePluginKey(req.mid, tier);
      const planName = tier === 'M3' ? '3 Months Access' : 'Lifetime Access';
      const expiryText = tier === 'M3' ? `\n⏳ Valid Until: \`${expiryTag}\`` : '';

      // 1. Send the activation key to the client
      await callApi('sendMessage', {
        chat_id: req.clientChatId,
        text: `🎉 *Payment Confirmed!*\n\n` +
              `📦 **Plan:** ${planName}${expiryText}\n` +
              `🔑 **Activation Key:**\n\n` +
              `\`${key}\`\n\n` +
              `👉 Copy this key, paste it into your AutoCAD dialog, and click **Activate License**.`,
        parse_mode: 'Markdown'
      });

      // 2. Update admin message to record issuance
      await callApi('editMessageCaption', {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        caption: `✅ *Approved & Key Delivered*\n\n` +
                 `📦 Plan: *${planName}*\n` +
                 `💻 Machine ID: \`${req.mid}\`\n` +
                 `🔑 Generated Key: \`${key}\``,
        parse_mode: 'Markdown'
      });

      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: `Key issued for ${planName}!` });
      pendingRequests.delete(reqId);

    } else if (data.startsWith('reject_')) {
      const reqId = data.replace('reject_', '');
      const req = pendingRequests.get(reqId);

      if (req) {
        await callApi('sendMessage', {
          chat_id: req.clientChatId,
          text: `❌ Your payment receipt could not be verified. Please check the amount or contact @MANNSINH for support.`
        });
      }

      await callApi('editMessageCaption', {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        caption: `❌ *Slip Rejected*`
      });

      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Rejected' });
      pendingRequests.delete(reqId);
    }
    return;
  }

  // B. Customer Messages
  if (update.message) {
    const msg = update.message;
    const chatId = msg.chat.id;
    const text = msg.text ? msg.text.trim() : '';

    // 1. /start command (supports ?start=MID or ?start=MID_TIER)
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const rawParam = parts.length > 1 ? parts[1].trim().toUpperCase() : null;

      let passedMid = null;
      let requestedTier = 'LF';

      if (rawParam) {
        if (rawParam.includes('_')) {
          const split = rawParam.split('_');
          passedMid = split[0];
          requestedTier = split[1] === 'M3' ? 'M3' : 'LF';
        } else {
          passedMid = rawParam;
        }
      }

      if (passedMid && passedMid.length >= 8) {
        userSessions.set(chatId, { mid: passedMid, tier: requestedTier });
        const planPrompt = requestedTier === 'M3' ? '3 Months ($1.50)' : 'Lifetime ($3.00)';
        
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `👋 *Welcome to Axon Arch Activation!*\n\n` +
                `💻 *Detected Machine ID:* \`${passedMid}\`\n` +
                `📦 *Selected Plan:* ${planPrompt}\n\n` +
                `Please send a photo or screenshot of your **ABA / Bakong payment slip** below.`,
          parse_mode: 'Markdown'
        });
      } else {
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `👋 *Welcome to Axon Arch Activation!*\n\n` +
                `To receive your activation key:\n` +
                `1️⃣ Send your **Machine Hardware ID** (from AutoCAD dialog).\n` +
                `2️⃣ Send your **payment slip screenshot** ($1.50 for 3 Months or $3.00 for Lifetime).`,
          parse_mode: 'Markdown'
        });
      }
      return;
    }

    // 2. Payment receipt image
    if (msg.photo) {
      const fileId = msg.photo[msg.photo.length - 1].file_id;
      const caption = msg.caption ? msg.caption.trim().toUpperCase() : '';
      
      const session = userSessions.get(chatId) || {};
      const mid = caption.match(/[A-F0-9]{8,24}/)?.[0] || session.mid || '';
      const chosenTier = session.tier || 'LF';

      const reqId = `REQ_${Date.now()}`;
      pendingRequests.set(reqId, { clientChatId: chatId, mid: mid, requestedTier: chosenTier });

      const clientName = msg.from.username ? `@${msg.from.username}` : (msg.from.first_name || 'Customer');

      await callApi('sendPhoto', {
        chat_id: ADMIN_CHAT_ID,
        photo: fileId,
        caption: `📩 *New Payment Slip Received*\n\n` +
                 `👤 Client: ${clientName} (\`${chatId}\`)\n` +
                 `💻 Machine ID: \`${mid || 'NOT DETECTED (Ask user)'}\`\n` +
                 `🏷 Requested: *${chosenTier === 'M3' ? '3 Months ($1.50)' : 'Lifetime ($3.00)'}*\n\n` +
                 `*Check slip amount and choose action:*`,
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '📅 Approve 3M ($1.50)', callback_data: `approve_M3_${reqId}` },
              { text: '✨ Approve Lifetime ($3)', callback_data: `approve_LF_${reqId}` }
            ],
            [
              { text: '❌ Reject Slip', callback_data: `reject_${reqId}` }
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
        userSessions.set(chatId, { mid: cleanText, tier: 'LF' });
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `💻 Machine ID saved: \`${cleanText}\`\n\nNow please send the photo of your **payment receipt** ($1.50 for 3 Months or $3 for Lifetime).`,
          parse_mode: 'Markdown'
        });
      } else {
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `Please send a valid Machine ID (shown in your AutoCAD activation dialog).`
        });
      }
    }
  }
}

// ==========================================
// 6. START BOT
// ==========================================
pollUpdates();
