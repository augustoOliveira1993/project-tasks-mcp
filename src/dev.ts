import { spawn } from 'node:child_process';
import { startLocalMongo } from './local-mongo.js';
import { env } from './env.js';
import { logger } from './logger.js';

const mongoUri = env.mongodbUri;
const mongo = await startLocalMongo();
const mcp = spawn(process.execPath, ['--env-file-if-exists=.env', '--import', 'tsx', 'src/main.ts'], {
  env: { ...process.env, MONGODB_URI: mongoUri },
  stdio: 'inherit',
  windowsHide: true
});

let stopping = false;
const stop = (signal: NodeJS.Signals) => {
  if (stopping) return;
  stopping = true;
  mcp.kill(signal);
  mongo?.kill(signal);
};
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop(signal));
mcp.on('error', error => { logger.error('Could not start MCP', { event: 'mcp_start_failed', error: error.message }); stop('SIGTERM'); process.exitCode = 1; });
mcp.on('exit', code => { mongo?.kill('SIGTERM'); process.exitCode = code ?? 0; });