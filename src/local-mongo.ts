import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';
import { mongo } from 'mongoose';
import { env } from './env.js';
import { logger } from './logger.js';

export async function startLocalMongo(): Promise<ChildProcess | undefined> {
  // Dedicated development instance; never changes the Windows MongoDB service.
  const uri = new URL(env.mongodbUri);
  if (!['127.0.0.1', 'localhost'].includes(uri.hostname) || uri.username || uri.password || uri.searchParams.get('replicaSet') !== 'rs0') {
    throw new Error('mongo:local requires a local MongoDB URI without authentication and replicaSet=rs0');
  }
  const port = Number(uri.port || 27018);
  if (port === 27017) throw new Error('Use port 27018 for the dedicated instance; port 27017 is reserved for your existing MongoDB.');
  const directUri = `mongodb://127.0.0.1:${port}/admin?directConnection=true`;
  const client = new mongo.MongoClient(directUri, { serverSelectionTimeoutMS: 1000 });
  try {
    await client.connect();
    const existing = await client.db().command({ hello: 1 });
    if (existing.setName !== 'rs0' || !existing.isWritablePrimary) {
      throw new Error(`MongoDB already occupies port ${port}, but rs0 has no writable primary. No new process was started.`);
    }
    logger.info('MongoDB local already running', { event: 'mongo_ready', port, started: false });
    return;
  } catch (error) {
    if (!(error instanceof mongo.MongoServerSelectionError)) throw error;
  } finally { await client.close(); }

  let binary = env.mongodPath;
  if (!binary && process.platform === 'win32') {
    const root = join(process.env.ProgramFiles ?? 'C:/Program Files', 'MongoDB', 'Server');
    const versions = (await readdir(root)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (versions[0]) binary = join(root, versions[0], 'bin', 'mongod.exe');
  }
  const directory = resolve('.local/mongo');
  await mkdir(directory, { recursive: true });
  const child = spawn(binary ?? 'mongod', ['--dbpath', directory, '--replSet', 'rs0', '--bind_ip', '127.0.0.1', '--port', String(port), '--logpath', join(directory, 'mongod.log'), '--logappend'], { windowsHide: true, stdio: 'inherit' });
  let stopped = false;
  child.on('error', error => { stopped = true; logger.error('Could not start mongod', { event: 'mongo_start_failed', error: error.message, hint: 'Set MONGOD_PATH in env.config.ts or .env.' }); });
  child.on('exit', () => { stopped = true; });
  try {
    let ready = false;
    for (let attempt = 0; attempt < 30 && !stopped; attempt++) {
      try {
        await client.connect();
        const status = await client.db().command({ serverStatus: 1 });
        if (stopped || status.pid !== child.pid) {
          throw new Error(`Another MongoDB process occupies port ${port}. This invocation did not start it.`);
        }
        const hello = await client.db().command({ hello: 1 });
        if (!hello.setName && hello.isreplicaset) {
          await client.db().command({ replSetInitiate: { _id: 'rs0', members: [{ _id: 0, host: `localhost:${port}` }] } });
        } else if (hello.setName === 'rs0' && hello.isWritablePrimary) { ready = true; break; }
        else if (!hello.isreplicaset && !hello.setName) throw new Error('Port occupied by a standalone MongoDB');
      } catch (error) {
        if (!(error instanceof mongo.MongoServerSelectionError)) throw error;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    if (!ready || stopped) throw new Error(`Replica set not ready. Check ${join(directory, 'mongod.log')}`);
    logger.info('MongoDB local ready', { event: 'mongo_ready', port, directory, started: true });
    return child;
  } catch (error) {
    child.kill();
    throw error;
  } finally { await client.close(); }
}

async function runCli() {
  const child = await startLocalMongo();
  if (!child) return;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => child.kill(signal));
  await new Promise<void>(resolve => child.once('exit', () => resolve()));
}

const isEntryPoint = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntryPoint) runCli().catch(error => { logger.error('MongoDB local failed', { event: 'mongo_failed', error: error.message }); process.exitCode = 1; });