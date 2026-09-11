import { spawn } from 'node:child_process';
import { mkdir, readdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { mongo } from 'mongoose';

async function main() {
  // Dedicated development instance; never changes the Windows MongoDB service.
  const uri = new URL(process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27018/project_tasks?replicaSet=rs0');
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
    console.log(`MongoDB rs0 already running on localhost:${port}. No new instance was started.`);
    return;
  } catch (error) {
    if (!(error instanceof mongo.MongoServerSelectionError)) throw error;
  } finally { await client.close(); }
  let binary = process.env.MONGOD_PATH;
  if (!binary && process.platform === 'win32') {
    const root = join(process.env.ProgramFiles ?? 'C:/Program Files', 'MongoDB', 'Server');
    const versions = (await readdir(root)).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    if (versions[0]) binary = join(root, versions[0], 'bin', 'mongod.exe');
  }
  const directory = resolve('.local/mongo');
  await mkdir(directory, { recursive: true });
  const child = spawn(binary ?? 'mongod', ['--dbpath', directory, '--replSet', 'rs0', '--bind_ip', '127.0.0.1', '--port', String(port), '--logpath', join(directory, 'mongod.log'), '--logappend'], { windowsHide: true, stdio: 'inherit' });
  let stopped = false;
  child.on('error', error => { stopped = true; console.error(`Could not start mongod: ${error.message}. Set MONGOD_PATH in .env.`); process.exitCode = 1; });
  child.on('exit', code => { stopped = true; if (code) process.exitCode = code; });
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { child.kill(signal); });
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
    console.log(`MongoDB rs0 ready on localhost:${port}. Data: ${directory}. Keep this terminal open.`);
  } catch (error) {
    console.error((error as Error).message); child.kill(); process.exitCode = 1;
  } finally { await client.close(); }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
