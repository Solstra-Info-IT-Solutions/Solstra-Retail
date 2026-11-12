const { existsSync } = require('fs');
const { resolve } = require('path');
const dotenv = require('dotenv');

const candidates = [
  resolve(process.cwd(), 'apps/api/.env'),
  resolve(process.cwd(), '.env'),
  resolve(process.cwd(), '../.env'),
];

const envFile = candidates.find(existsSync);

if (envFile) {
  dotenv.config({ path: envFile, override: false });
}

const uri = process.env.TEST_MONGODB_URI;

if (!uri) {
  throw new Error(
    'E2E BLOCKED: TEST_MONGODB_URI is required. MONGODB_URI will not be used as a fallback.',
  );
}

let parsed;

try {
  parsed = new URL(uri);
} catch {
  throw new Error('E2E BLOCKED: TEST_MONGODB_URI is not a valid MongoDB URI.');
}

if (!['mongodb:', 'mongodb+srv:'].includes(parsed.protocol)) {
  throw new Error('E2E BLOCKED: Unsupported MongoDB protocol.');
}

const databaseName = decodeURIComponent(
  parsed.pathname.replace(/^\/+/, ''),
);

if (databaseName !== 'solstra_retail_test') {
  throw new Error(
    `E2E BLOCKED: Expected solstra_retail_test, received "${databaseName}".`,
  );
}

if (!process.env.JWT_ACCESS_SECRET) {
  throw new Error('E2E BLOCKED: JWT_ACCESS_SECRET is required.');
}

// Force the actual AppModule connection to use the validated test database.
process.env.MONGODB_URI = uri;
process.env.NODE_ENV = 'test';
