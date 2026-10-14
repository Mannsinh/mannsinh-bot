const crypto = require('crypto');
const http = require('http');
const https = require('https');

// ==========================================
// 1. CONFIGURATION
// ==========================================
const BOT_TOKEN = '8885385318:AAF1PqJygt9mC5ZA6imjl0Q-6jvkcjAvfw0';
const ADMIN_CHAT_ID = '6271974217';
const SECRET_SALT = 'Mannsinh_CAD_Suite_2026_SecureKey_#9982!';

// In-memory sessions
const userSessions = {};
const pendingApprovals = {};

// ==========================================
// 2. HEALTH CHECK WEB SERVER (FOR RENDER 24/7)
// ==========================================
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Mannsinh CAD Suite Bot is alive and running 24/7!\n');
}).listen(PORT, () => {
  console.log(`Web health check server active on port ${PORT}`);
});

// ==========================================
// 3. TELEGRAM API HELPER (STABLE HTTPS)
// ==========================================
const agent = new https.Agent({ keepAlive: true, timeout: 60000 });

function callApi(method, payload = {}) {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(payload);
    const options = {
      hostname: 'api.telegram.org',
      port: 443,
      path: `/bot${BOT_TOKEN}/${method}`,
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
          resolve(JSON.parse(data));
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

// ==========================================
// 4. KEY GENERATION ALGORITHM
// ==========================================
function generateActivationKey(machineId) {
  const hash = crypto.createHash('sha256')
    .update(machineId.trim().toUpperCase() + SECRET_SALT)
    .digest('hex')
    .toUpperCase();

  const p1 = hash.substring(0, 4);
  const p2 = hash.substring(4, 8);
  const p3 = hash.substring(8, 12);
  const p4 = hash.substring(12, 16);

  return `LF-${p1}-${p2}-${p3}-${p4}`;
}

// ==========================================
// 5. UPDATE HANDLER
// ==========================================
async function handleUpdate(update) {
  // Handle Button Clicks (Approve / Reject)
  if (update.callback_query) {
    const query = update.callback_query;
    const adminId = String(query.from.id);
    const data = query.data;

    if (adminId !== String(ADMIN_CHAT_ID)) {
      await callApi('answerCallbackQuery', {
        callback_query_id: query.id,
        text: 'Unauthorized action.',
        show_alert: true
      });
      return;
    }

    if (data.startsWith('approve_')) {
      const approvalId = data.replace('approve_', '');
      const reqData = pendingApprovals[approvalId];

      if (!reqData) {
        await callApi('answerCallbackQuery', {
          callback_query_id: query.id,
          text: 'Request expired or already handled.',
          show_alert: true
        });
        return;
      }

      const key = generateActivationKey(reqData.machineId);

      // Send key to client
      await callApi('sendMessage', {
        chat_id: reqData.userId,
        text: `🎉 *Payment Approved!*\\n\\nHere is your lifetime activation key for *Mannsinh CAD Suite*:\\n\\n\`${key}\`\\n\\n👉 *To Activate:*\\n1. Open AutoCAD.\\n2. Paste this key into the activation prompt.\\n3. Enjoy full lifetime access!`,
        parse_mode: 'Markdown'
      });

      // Update Admin message
      await callApi('editMessageCaption', {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        caption: `${query.message.caption || ''}\n\n✅ *APPROVED* by Admin.\n🔑 Key: \`${key}\``,
        parse_mode: 'Markdown'
      });

      delete pendingApprovals[approvalId];
      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'License approved & key sent!' });

    } else if (data.startsWith('reject_')) {
      const approvalId = data.replace('reject_', '');
      const reqData = pendingApprovals[approvalId];

      if (reqData) {
        await callApi('sendMessage', {
          chat_id: reqData.userId,
          text: '❌ *Payment Verification Failed.*\\n\\nWe could not verify your receipt. Please ensure you sent the correct payment slip or contact support.',
          parse_mode: 'Markdown'
        });
        delete pendingApprovals[approvalId];
      }

      await callApi('editMessageCaption', {
        chat_id: query.message.chat.id,
        message_id: query.message.message_id,
        caption: `${query.message.caption || ''}\n\n❌ *REJECTED* by Admin.`,
        parse_mode: 'Markdown'
      });

      await callApi('answerCallbackQuery', { callback_query_id: query.id, text: 'Request rejected.' });
    }
    return;
  }

  // Handle Standard Messages
  if (!update.message) return;
  const msg = update.message;
  const chatId = msg.chat.id;
  const text = msg.text ? msg.text.trim() : '';

  if (!userSessions[chatId]) {
    userSessions[chatId] = {};
  }

  // Command: /start or /start <MACHINE_ID>
  if (text.startsWith('/start')) {
    const parts = text.split(' ');
    if (parts.length > 1 && parts[1].length >= 8) {
      const mid = parts[1].trim().toUpperCase();
      userSessions[chatId].machineId = mid;
      await callApi('sendMessage', {
        chat_id: chatId,
        text: `👋 *Welcome to Mannsinh CAD Suite Activation!*\n\n💻 *Detected Machine ID:* \`${mid}\`\n\nPlease send a photo or screenshot of your *$3 ABA / Bakong* payment slip below.`,
        parse_mode: 'Markdown'
      });
      return;
    }

    await callApi('sendMessage', {
      chat_id: chatId,
      text: `👋 *Welcome to Mannsinh CAD Suite Activation!*\n\nTo receive your lifetime activation key:\n1️⃣ Send your *Machine Hardware ID* (from AutoCAD dialog).\n2️⃣ Send your *$3 ABA / Bakong* payment slip screenshot.`,
      parse_mode: 'Markdown'
    });
    return;
  }

  // Check if user manually typed a 16-character Machine ID
  const hexPattern = /^[A-Fa-f0-9]{12,24}$/;
  if (text && hexPattern.test(text)) {
    userSessions[chatId].machineId = text.toUpperCase();
    await callApi('sendMessage', {
      chat_id: chatId,
      text: `✅ *Machine ID Saved:* \`${text.toUpperCase()}\`\n\nNow, please send your *$3 payment slip photo* to complete activation.`,
      parse_mode: 'Markdown'
    });
    return;
  }

  // User sends Payment Slip Photo
  if (msg.photo && msg.photo.length > 0) {
    const mid = userSessions[chatId].machineId;

    if (!mid) {
      await callApi('sendMessage', {
        chat_id: chatId,
        text: `⚠️ *Machine ID Missing!*\n\nPlease send your Machine Hardware ID before submitting the receipt, or launch the bot via your checkout page link.`
      });
      return;
    }

    const largestPhoto = msg.photo[msg.photo.length - 1];
    const approvalId = `${chatId}_${Date.now()}`;

    pendingApprovals[approvalId] = {
      userId: chatId,
      machineId: mid,
      photoId: largestPhoto.file_id
    };

    // Forward receipt to Admin with Inline Buttons
    await callApi('sendPhoto', {
      chat_id: ADMIN_CHAT_ID,
      photo: largestPhoto.file_id,
      caption: `🔔 *New License Order ($3)*\n\n👤 *User ID:* \`${chatId}\`\n💻 *Machine ID:* \`${mid}\`\n\nPlease verify payment receipt and approve below:`,
      parse_mode: 'Markdown',
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Approve & Send Key', callback_data: `approve_${approvalId}` },
            { text: '❌ Reject', callback_data: `reject_${approvalId}` }
          ]
        ]
      }
    });

    // Notify Customer
    await callApi('sendMessage', {
      chat_id: chatId,
      text: `📥 *Receipt received!*\\n\\nOur admin has received your slip. Your lifetime key will be sent here automatically upon confirmation (usually within 1–5 minutes).`,
      parse_mode: 'Markdown'
    });
    return;
  }
}

// ==========================================
// 6. STABLE LONG-POLLING LOOP
// ==========================================
let offset = 0;
let isPolling = false;

async function pollUpdates() {
  if (isPolling) return;
  isPolling = true;
  console.log('>>> Mannsinh License Bot is polling for Telegram updates... <<<');

  while (true) {
    try {
      const res = await callApi('getUpdates', {
        offset: offset,
        timeout: 25,
        allowed_updates: ['message', 'callback_query']
      });

      if (res && res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          offset = update.update_id + 1;
          await handleUpdate(update).catch(err => console.error('Handler error:', err));
        }
      }
    } catch (err) {
      // Wait 2 seconds before retrying on network drops
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

pollUpdates();
