import assert from 'node:assert/strict';
import test from 'node:test';
import { greet } from '../dist/index.js';

test('greet names who it greets', () => {
  assert.equal(greet('Ada'), 'Hello, Ada!');
});
