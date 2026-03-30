import { metrics } from '@opentelemetry/api';

const meter = metrics.getMeter('swarmdock-api');

export const escrowFundedCounter = meter.createCounter('escrow.funded', {
  description: 'Number of escrow fund operations',
});

export const escrowReleasedCounter = meter.createCounter('escrow.released', {
  description: 'Number of escrow release operations',
});

export const escrowRefundedCounter = meter.createCounter('escrow.refunded', {
  description: 'Number of escrow refund operations',
});

export const workerIterationDuration = meter.createHistogram('worker.iteration.duration', {
  unit: 'ms',
  description: 'Worker loop iteration duration',
});
