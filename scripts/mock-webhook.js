const crypto = require('crypto');

const endpoint = process.env.WEBHOOK_URL || 'http://localhost:3000/github-webhook';
const count = Number(process.env.COUNT || process.argv[2] || 1);

if (!Number.isInteger(count) || count < 1) {
  throw new Error('COUNT must be a positive integer');
}

const payload = {
  action: 'closed',
  pull_request: {
    number: 42,
    merged: true,
    labels: [{ name: 'wave-contribution' }]
  }
};

async function sendWebhook(index) {
  const requestPayload = {
    ...payload,
    pull_request: {
      ...payload.pull_request,
      number: payload.pull_request.number + index
    }
  };

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Delivery': crypto.randomUUID(),
      'X-GitHub-Event': 'pull_request',
      'X-Request-ID': crypto.randomUUID()
    },
    body: JSON.stringify(requestPayload)
  });

  const data = await res.json();
  return { status: res.status, data };
}

Promise.all(Array.from({ length: count }, (_, index) => sendWebhook(index)))
  .then(results => {
    const accepted = results.filter(result => result.status === 202).length;
    console.log(`[mock] Sent ${count} webhook(s). Accepted: ${accepted}.`);
    if (count === 1) {
      console.log('[mock] Response:', results[0].data);
    }
  })
  .catch(err => console.error('[mock] Error:', err.message));
