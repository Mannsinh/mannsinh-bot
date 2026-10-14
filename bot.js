// ==========================================
// 3. ROBUST TELEGRAM CALL & POLLING (Node 24 Safe)
// ==========================================
const https = require('https');

// Keep-alive agent prevents socket drops
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
      timeout: 35000 // 35-second socket timeout
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
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

// Stable Long-Polling Loop
let offset = 0;
let isPolling = false;

async function pollUpdates() {
  if (isPolling) return;
  isPolling = true;

  while (true) {
    try {
      const res = await callApi('getUpdates', {
        offset: offset,
        timeout: 25, // Telegram server waits up to 25s for an update
        allowed_updates: ['message', 'callback_query']
      });

      if (res && res.ok && Array.isArray(res.result)) {
        for (const update of res.result) {
          offset = update.update_id + 1;
          await handleUpdate(update).catch(err => console.error('Handler error:', err));
        }
      }
    } catch (err) {
      // Quietly wait 2 seconds before retrying if network glitches
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}
