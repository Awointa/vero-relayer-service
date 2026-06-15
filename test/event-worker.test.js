const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildGitHubPullRequestEventPayload } = require('../src/queue');
const { processEventJob } = require('../src/workers/event-worker');

function job(data) {
  return {
    id: 'job-1',
    data,
    attemptsMade: 0,
    opts: {
      attempts: 5
    }
  };
}

test('processEventJob calls the existing transaction broadcasting logic', async () => {
  const calls = [];
  const payload = buildGitHubPullRequestEventPayload({
    action: 'closed',
    pull_request: {
      number: 42,
      merged: true,
      labels: [{ name: 'wave-contribution' }]
    }
  }, { deliveryId: 'delivery-worker' });

  const result = await processEventJob(job(payload), {
    registerTaskOnChain: async pullRequestNumber => {
      calls.push(pullRequestNumber);
    }
  });

  assert.deepEqual(calls, [42]);
  assert.deepEqual(result, { pr: 42 });
});

test('processEventJob rejects invalid jobs without calling broadcaster', async () => {
  const calls = [];
  const invalidPayload = {
    eventType: 'github.pull_request.merged',
    payload: {
      pull_request: {}
    }
  };

  await assert.rejects(
    () => processEventJob(job(invalidPayload), {
      registerTaskOnChain: async pullRequestNumber => {
        calls.push(pullRequestNumber);
      }
    }),
    /missing pull request number/
  );
  assert.deepEqual(calls, []);
});
