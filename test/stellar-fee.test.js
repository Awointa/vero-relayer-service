const assert = require('node:assert/strict');
const { test } = require('node:test');
const { registerTaskOnChain } = require('../stellar');

test('registerTaskOnChain estimates fee before transaction submission', async () => {
  const calls = [];
  const logs = [];
  const originalLog = console.log;

  console.log = message => {
    logs.push(message);
  };

  try {
    await registerTaskOnChain(42, {
      estimateFee: async () => {
        calls.push('estimateFee');
        return '777';
      },
      submitTransaction: async transaction => {
        calls.push(`submit:${transaction.fee}`);
        return { hash: '0xtest' };
      }
    });
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(calls, ['estimateFee', 'submit:777']);
  assert.ok(logs.some(line => line.includes('fee: "777"')));
  assert.ok(!logs.some(line => line.includes('fee: "100"')));
});

test('registerTaskOnChain does not submit when fee estimation throws a configuration error', async () => {
  const calls = [];
  const originalLog = console.log;
  console.log = () => {};

  try {
    await assert.rejects(
      () => registerTaskOnChain(42, {
        estimateFee: async () => {
          calls.push('estimateFee');
          throw new Error('invalid fee config');
        },
        submitTransaction: async () => {
          calls.push('submit');
          return { hash: '0xtest' };
        }
      }),
      /invalid fee config/
    );
  } finally {
    console.log = originalLog;
  }

  assert.deepEqual(calls, ['estimateFee']);
});
