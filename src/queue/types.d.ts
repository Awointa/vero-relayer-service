export type EventJobPayload = {
  eventType: string;
  receivedAt: string;
  requestId: string | null;
  source: string | null;
  idempotencyKey: string | null;
  payload: {
    action: string;
    pull_request: {
      id?: number | string;
      node_id?: string;
      number: number;
      merged: boolean;
      labels: Array<{
        id?: number | string;
        name: string;
      }>;
    };
    repository: {
      id?: number | string;
      name?: string;
      full_name?: string;
    } | null;
  };
};

export const EVENT_TYPES: {
  GITHUB_PULL_REQUEST_MERGED: 'github.pull_request.merged';
};
