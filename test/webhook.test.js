const assert = require('node:assert/strict');
const { test } = require('node:test');
const { createApp } = require('../index');

function listen(app) {
  return new Promise(resolve => {
    const server = app.listen(0, () => {
      resolve(server);
    });
  });
}

function close(server) {
  return new Promise(resolve => {
    server.close(resolve);
  });
}

function url(server, path) {
  const address = server.address();
  return `http://127.0.0.1:${address.port}${path}`;
}

test('github webhook enqueues qualifying events instead of broadcasting synchronously', async t => {
  const enqueuedEvents = [];
  const app = createApp({
    enqueueEventJob: async eventPayload => {
      enqueuedEvents.push(eventPayload);
      return { id: 'job-42' };
    }
  });
  const server = await listen(app);
  t.after(() => close(server));

  const response = await fetch(url(server, '/github-webhook'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Delivery': 'delivery-route',
      'X-Request-ID': 'request-route'
    },
    body: JSON.stringify({
      action: 'closed',
      pull_request: {
        number: 42,
        merged: true,
        labels: [{ name: 'wave-contribution' }]
      }
    })
  });

  const body = await response.json();

  assert.equal(response.status, 202);
  assert.deepEqual(body, { ok: true, pr: 42, queued: true, jobId: 'job-42' });
  assert.equal(enqueuedEvents.length, 1);
  assert.equal(enqueuedEvents[0].payload.pull_request.number, 42);
  assert.equal(enqueuedEvents[0].idempotencyKey, 'delivery-route');
  assert.equal(enqueuedEvents[0].requestId, 'request-route');
});

test('github webhook keeps existing skipped response for non-qualifying events', async t => {
  const app = createApp({
    enqueueEventJob: async () => {
      throw new Error('should not enqueue skipped events');
    }
  });
  const server = await listen(app);
  t.after(() => close(server));

  const response = await fetch(url(server, '/github-webhook'), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      action: 'opened',
      pull_request: {
        number: 42,
        merged: false,
        labels: []
      }
    })
  });

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { skipped: true });
});
