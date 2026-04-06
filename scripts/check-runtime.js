'use strict';

const process = require('node:process');

function fail(message) {
  throw new Error(`[runtime] ${message}`);
}

const [major] = process.versions.node.split('.').map(Number);

if (major !== 24) {
  fail(`Unsupported Node.js ${process.versions.node}. This project currently requires Node.js 24.x.`);
}
