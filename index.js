const express = require('express');
const {
  buildGitHubPullRequestEventPayload,
  buildMetadataFromRequest,
  enqueueEvent,
  validateRedisConfig
} = require('./src/queue');

function createApp(options = {}) {
  const enqueueEventJob = options.enqueueEventJob || enqueueEvent;
  const app = express();

  app.use(express.json());

  app.post('/github-webhook', async (req, res) => {
    const { action, pull_request: pr } = req.body;

    if (action !== 'closed' || !pr?.merged) {
      return res.status(200).json({ skipped: true });
    }

    const hasLabel = pr.labels?.some(l => l.name === 'wave-contribution');
    if (!hasLabel) {
      return res.status(200).json({ skipped: true, reason: 'no wave-contribution label' });
    }

    const eventPayload = buildGitHubPullRequestEventPayload(req.body, buildMetadataFromRequest(req));

    try {
      const job = await enqueueEventJob(eventPayload);
      console.log(`[webhook] queued PR #${pr.number} eventType=${eventPayload.eventType} job=${job.id}`);
      return res.status(202).json({ ok: true, pr: pr.number, queued: true, jobId: job.id });
    } catch (error) {
      console.error(`[webhook] failed to enqueue PR #${pr.number}: ${error.message}`);
      return res.status(500).json({ ok: false, error: 'failed to enqueue event' });
    }
  });

  return app;
}

function startServer() {
  validateRedisConfig();

  const port = process.env.PORT || 3000;
  const app = createApp();

  return app.listen(port, () => console.log(`Server listening on port ${port}`));
}

if (require.main === module) {
  startServer();
}

module.exports = {
  createApp,
  startServer
};
