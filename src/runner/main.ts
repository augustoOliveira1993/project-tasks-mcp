import { readFile, mkdir, open, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { homedir } from 'node:os';
import { runnerConfig, RunnerClient, LocalRunner } from './runtime.js';

async function main() {
  const path = process.argv[2] ?? resolve(homedir(), '.project-tasks-runner', 'config.json');
  const config = runnerConfig.parse(JSON.parse(await readFile(path, 'utf8')));
  const runner = new LocalRunner(config, new RunnerClient(config.serviceUrl, process.env.RUNNER_TOKEN ?? ''));
  const lockDirectory = resolve(homedir(), '.project-tasks-runner', 'locks'); await mkdir(lockDirectory, { recursive: true });
  const lockPath = resolve(lockDirectory, `${config.machineId}.lock`);
  let lock;
  try { lock = await open(lockPath, 'wx'); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    const pid = Number(await readFile(lockPath, 'utf8'));
    if (!Number.isSafeInteger(pid) || pid <= 0) throw new Error('Runner lock needs human recovery');
    try { process.kill(pid, 0); throw new Error('Another runner owns this machine configuration'); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error; }
    await unlink(lockPath); lock = await open(lockPath, 'wx');
  }
  await lock.writeFile(String(process.pid));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void runner.stop(); });
  try { await runner.run(); } finally { await lock.close(); await unlink(lockPath); }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
