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
// 2. HEALTH CHECK WEB SERVER (24/7 HOSTING)
// ==========================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Mannsinh CAD Suite Bot is alive and running 24/7!\n');
}).listen(PORT, () => {
  console.log(`Web health check server active on port ${PORT}`);
});

// Helper to escape HTML special characters in customer names
function escapeHtml(str) {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

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
    return null;
  }
}

// Generate the 3-part LF-PERM-XXXXXXXX key that your C# AutoCAD plugin accepts
function generateLifetimeKey(machineId) {
  const cleanMid = machineId.trim().toUpperCase();
  const tier = 'LF';
  const expiryTag = 'PERM';
  const payload = `${cleanMid}_${tier}_${expiryTag}_${SECRET_SALT}`;
  const hashBuffer = crypto.createHash('sha256').update(payload, 'utf8').digest();
  const signature = hashBuffer.subarray(0, 8).toString('hex').toUpperCase();
  return `${tier}-${expiryTag}-${signature}`;
}

const userSessions = new Map();
const pendingRequests = new Map();
let lastUpdateId = 0;

// ==========================================
// 3. UPDATE HANDLER
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

      if (!req || !req.mid || req.mid === 'NOT DETECTED') {
        await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Machine ID missing! Cannot issue key.' });
        return;
      }

      const key = generateLifetimeKey(req.mid);

      // Deliver key directly to client
      await callApi('sendMessage', {
        chat_id: req.clientChatId,
        text: `🎉 <b>Payment Confirmed!</b>\n\n` +
              `📦 <b>Plan:</b> Lifetime Access\n` +
              `🔑 <b>Activation Key:</b>\n\n` +
              `<code>${key}</code>\n\n` +
              `👉 Copy this key, paste it into your AutoCAD dialog, and click <b>Activate License</b>.`,
        parse_mode: 'HTML'
      });

      // Update admin message
      const finalCaption = `✅ <b>Approved & Key Delivered</b>\n\n` +
                           `📦 Plan: Lifetime Access\n` +
                           `💻 Machine ID: <code>${escapeHtml(req.mid)}</code>\n` +
                           `🔑 Generated Key: <code>${key}</code>`;

      if (query.message.photo || query.message.document) {
        await callApi('editMessageCaption', {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          caption: finalCaption,
          parse_mode: 'HTML'
        });
      } else {
        await callApi('editMessageText', {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          text: finalCaption,
          parse_mode: 'HTML'
        });
      }

      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Key sent to customer!' });
      pendingRequests.delete(reqId);

    } else if (data.startsWith('reject_')) {
      const reqId = data.replace('reject_', '');
      const req = pendingRequests.get(reqId);

      if (req) {
        await callApi('sendMessage', {
          chat_id: req.clientChatId,
          text: `❌ Your payment receipt could not be verified. Please check the amount or contact support.`
        });
      }

      const rejectCaption = `❌ <b>Rejected</b>`;
      if (query.message.photo || query.message.document) {
        await callApi('editMessageCaption', {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          caption: rejectCaption,
          parse_mode: 'HTML'
        });
      } else {
        await callApi('editMessageText', {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          text: rejectCaption,
          parse_mode: 'HTML'
        });
      }

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

    // 1. /start command
    if (text.startsWith('/start')) {
      const parts = text.split(' ');
      const rawParam = parts.length > 1 ? parts[1].trim().toUpperCase() : null;

      let passedMid = null;
      if (rawParam) {
        passedMid = rawParam.includes('_') ? rawParam.split('_')[0] : rawParam;
      }

      if (passedMid && passedMid.length >= 8) {
        userSessions.set(chatId, passedMid);
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `👋 <b>Welcome to Mannsinh CAD Suite Activation!</b>\n\n` +
                `💻 <b>Detected Machine ID:</b> <code>${escapeHtml(passedMid)}</code>\n\n` +
                `Please send a screenshot or photo of your <b>$3 ABA / Bakong payment slip</b> below.`,
          parse_mode: 'HTML'
        });
      } else {
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `👋 <b>Welcome to Mannsinh CAD Suite Activation!</b>\n\n` +
                `To receive your lifetime activation key:\n` +
                `1️⃣ Send your <b>Machine Hardware ID</b> (from AutoCAD dialog).\n` +
                `2️⃣ Send your <b>$3 ABA / Bakong payment slip</b> photo.`,
          parse_mode: 'HTML'
        });
      }
      return;
    }

    // 2. Receipt photo/document handler
    const isPhoto = Boolean(msg.photo && msg.photo.length > 0);
    const isDoc = Boolean(msg.document);

    if (isPhoto || isDoc) {
      const fileId = isPhoto ? msg.photo[msg.photo.length - 1].file_id : msg.document.file_id;
      const caption = (msg.caption || '').trim().toUpperCase();
      const mid = caption.match(/[A-F0-9]{8,24}/)?.[0] || userSessions.get(chatId) || 'NOT DETECTED';

      const reqId = `REQ_${Date.now()}`;
      pendingRequests.set(reqId, { clientChatId: chatId, mid: mid });

      const clientName = msg.from.username 
        ? `@${msg.from.username}` 
        : [msg.from.first_name, msg.from.last_name].filter(Boolean).join(' ') || 'Customer';

      const sendMethod = isPhoto ? 'sendPhoto' : 'sendDocument';
      const payloadKey = isPhoto ? 'photo' : 'document';

      // Send slip with Approve/Reject buttons to admin
      const sendResult = await callApi(sendMethod, {
        chat_id: ADMIN_CHAT_ID,
        [payloadKey]: fileId,
        caption: `📩 <b>New Payment Slip Received</b>\n\n` +
                 `👤 <b>Client:</b> ${escapeHtml(clientName)} (<code>${chatId}</code>)\n` +
                 `💻 <b>Machine ID:</b> <code>${escapeHtml(mid)}</code>\n` +
                 `🏷 <b>Plan:</b> Lifetime ($3.00)`,
        parse_mode: 'HTML',
        reply_markup: {
          inline_keyboard: [
            [
              { text: '✅ Approve & Issue Key', callback_data: `approve_${reqId}` },
              { text: '❌ Reject', callback_data: `reject_${reqId}` }
            ]
          ]
        }
      });

      // If photo forwarding failed for any reason, send fallback text message to admin
      if (!sendResult || !sendResult.ok) {
        await callApi('sendMessage', {
          chat_id: ADMIN_CHAT_ID,
          text: `⚠️ <b>New Payment Slip (Text Notice)</b>\n\n` +
                `👤 <b>Client:</b> ${escapeHtml(clientName)} (<code>${chatId}</code>)\n` +
                `💻 <b>Machine ID:</b> <code>${escapeHtml(mid)}</code>\n` +
                `<i>Note: Client sent slip, but photo preview failed. Check direct chat.</i>`,
          parse_mode: 'HTML',
          reply_markup: {
            inline_keyboard: [
              [
                { text: '✅ Approve & Issue Key', callback_data: `approve_${reqId}` },
                { text: '❌ Reject', callback_data: `reject_${reqId}` }
              ]
            ]
          }
        });
      }

      // Notify customer
      if (chatId.toString() !== ADMIN_CHAT_ID.toString()) {
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `✅ <b>Receipt received!</b> Your payment slip is under review. Your activation key will be delivered right here once verified.`,
          parse_mode: 'HTML'
        });
      }
      return;
    }

    // 3. User sends raw text (Machine ID)
    if (text && !text.startsWith('/')) {
      const cleanText = text.toUpperCase();
      if (cleanText.length >= 8) {
        userSessions.set(chatId, cleanText);
        await callApi('sendMessage', {
          chat_id: chatId,
          text: `💻 Machine ID saved: <code>${escapeHtml(cleanText)}</code>\n\nNow please send the photo of your <b>$3 payment receipt</b>.`,
          parse_mode: 'HTML'
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
// 4. CRASH-PROOF POLLING LOOP
// ==========================================
async function startPolling() {
  while (true) {
    try {
      console.log('>>> Initializing Telegram Polling Connection... <<<');
      await callApi('deleteWebhook', { drop_pending_updates: false });

      while (true) {
        try {
          const res = await fetch(`${TELEGRAM_API}/getUpdates?offset=${lastUpdateId + 1}&timeout=10`);
          const data = await res.json();

          if (data.ok && data.result.length > 0) {
            for (const update of data.result) {
              lastUpdateId = update.update_id;
              try {
                await handleUpdate(update);
              } catch (updateErr) {
                console.error('Handled update error safely:', updateErr.message);
              }
            }
          }
        } catch (fetchErr) {
          console.error('Polling network glitch, retrying in 2s:', fetchErr.message);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    } catch (criticalErr) {
      console.error('Critical crash. Restarting polling loop in 5s...', criticalErr.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

startPolling();
