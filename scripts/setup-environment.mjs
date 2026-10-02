#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { chmod, copyFile, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { emitKeypressEvents } from 'node:readline';
import { createInterface } from 'node:readline/promises';
import { homedir, userInfo } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = resolve(root, '.env');
const isWindows = process.platform === 'win32';
let prompts = createInterface({ input: process.stdin, output: process.stdout });

function question(message, defaultValue) {
  const suffix = defaultValue === undefined ? '' : ` [${defaultValue}]`;
  return prompts.question(`${message}${suffix}: `).then(value => value.trim() || defaultValue || '');
}

async function choose(message, choices, defaultValue) {
  const labels = choices.map(([key, description]) => `${key}) ${description}`).join('  ');
  while (true) {
    const answer = (await question(`${message} (${labels})`, defaultValue)).toLowerCase();
    if (choices.some(([key]) => key === answer)) return answer;
    console.log(`Escolha uma das opções: ${choices.map(([key]) => key).join(', ')}.`);
  }
}

async function confirm(message, defaultYes = false) {
  const answer = await question(`${message} [${defaultYes ? 'S/n' : 's/N'}]`);
  if (!answer) return defaultYes;
  return ['s', 'sim', 'y', 'yes'].includes(answer.toLowerCase());
}

async function secret(message) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== 'function') {
    throw new Error('A entrada oculta exige um terminal interativo.');
  }
  prompts.close();
  process.stdout.write(`${message}: `);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  try {
    return await new Promise((resolveSecret, rejectSecret) => {
      let value = '';
      const onKey = (character, key = {}) => {
        if (key.ctrl && key.name === 'c') {
          process.stdin.off('keypress', onKey);
          process.stdout.write('\n');
          rejectSecret(new Error('Operação cancelada.'));
          return;
        }
        if (key.name === 'return' || key.name === 'enter') {
          process.stdin.off('keypress', onKey);
          process.stdout.write('\n');
          resolveSecret(value);
          value = '';
          return;
        }
        if (key.name === 'backspace') {
          if (value.length) {
            value = value.slice(0, -1);
            process.stdout.write('\b \b');
          }
          return;
        }
        if (character && !key.ctrl && !key.meta) {
          value += character;
          process.stdout.write('*');
        }
      };
      process.stdin.on('keypress', onKey);
    });
  } finally {
    process.stdin.setRawMode(false);
    prompts = createInterface({ input: process.stdin, output: process.stdout });
  }
}

function capture(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: isWindows,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}

async function run(command, args, { optional = false } = {}) {
  const shown = [command, ...args].join(' ');
  console.log(`\n$ ${shown}`);
  const result = await new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, args, {
      cwd: root,
      env: process.env,
      shell: isWindows,
      stdio: 'inherit'
    });
    child.once('error', rejectRun);
    child.once('close', code => resolveRun(code ?? 1));
  });
  if (result !== 0 && !optional) throw new Error(`O comando terminou com código ${result}: ${shown}`);
  return result === 0;
}

function commandAvailable(command, args = ['--version']) {
  return capture(command, args).status === 0;
}

async function ensureYarn() {
  if (commandAvailable('yarn')) return 'yarn';
  if (commandAvailable('corepack')) {
    const prefix = ['yarn@1.22.22'];
    if (capture('corepack', [...prefix, '--version']).status === 0) {
      console.log('Yarn não está instalado globalmente; usando Yarn 1.22.22 pelo Corepack.');
      return { command: 'corepack', prefix };
    }
  }
  if (commandAvailable('npm')) {
    const prefix = ['exec', '--yes', '--package=yarn@1.22.22', '--', 'yarn'];
    if (capture('npm', [...prefix, '--version']).status === 0) {
      console.log('Yarn não está instalado globalmente; usando Yarn 1.22.22 pelo npm exec.');
      return { command: 'npm', prefix };
    }
  }
  throw new Error('Yarn/Corepack não encontrado e não foi possível executar Yarn 1.22.22 via npm.');
}

function runYarn(yarn, args) {
  if (typeof yarn === 'string') return run(yarn, args);
  return run(yarn.command, [...yarn.prefix, ...args]);
}

function validateNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 24) throw new Error(`Node.js 24 ou superior é necessário; encontrado ${process.versions.node}.`);
}

async function readCurrentEnv() {
  try {
    return parseEnv(await readFile(envPath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
}

async function environmentChoice() {
  const current = await readCurrentEnv();
  if (!(await readFileExists(envPath))) return { current, keep: false };
  console.log('Já existe um .env. Os valores e segredos não serão exibidos.');
  const keep = await choose('Manter o arquivo existente ou reconfigurá-lo?', [['m', 'manter'], ['r', 'reconfigurar com backup']], 'm');
  return { current, keep: keep === 'm' };
}

async function readFileExists(path) {
  try { await readFile(path); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function saveEnv(values, previous) {
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('-', '').replace(/\.\d{3}Z$/, 'Z');
  if (await readFileExists(envPath)) {
    const backup = `${envPath}.backup-${stamp}`;
    await copyFile(envPath, backup);
    if (!isWindows) await chmod(backup, 0o600);
    console.log(`Backup do .env salvo em ${backup}`);
  }
  const merged = { ...previous, ...values };
  for (const [key, value] of Object.entries(merged)) if (value === null) delete merged[key];
  const content = [
    '# Gerado pelo assistente interativo scripts/setup-environment.mjs.',
    ...Object.entries(merged).filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => `${key}=${JSON.stringify(String(value))}`),
    ''
  ].join('\n');
  const temporary = `${envPath}.tmp-${process.pid}`;
  try {
    await writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
    await rename(temporary, envPath);
    if (!isWindows) await chmod(envPath, 0o600);
  } finally {
    await unlink(temporary).catch(() => {});
  }
  console.log(`Arquivo .env atualizado em ${envPath}`);
  return merged;
}

function parsePort(value, label = 'PORT') {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`${label} deve ser um inteiro entre 1 e 65535.`);
  return String(port);
}

function validateServiceUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('SERVICE_URL precisa ser uma URL HTTP(S) válida.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('Informe SERVICE_URL como origem HTTP(S), sem credenciais, caminho, query ou fragmento.');
  }
  return url.origin;
}

function validateMongoUri(value) {
  if (!/^mongodb(?:\+srv)?:\/\//i.test(value) || /[\r\n]/.test(value)) throw new Error('A URI deve começar com mongodb:// ou mongodb+srv:// e ficar em uma linha.');
  try { new URL(value); } catch { throw new Error('A URI MongoDB não é válida. Use uma URI padrão ou SRV.'); }
  return value;
}

function validateLocalMongoUri(value) {
  validateMongoUri(value);
  const uri = new URL(value);
  if (!['localhost', '127.0.0.1'].includes(uri.hostname) || uri.username || uri.password || uri.searchParams.get('replicaSet') !== 'rs0' || uri.port === '27017') {
    throw new Error('yarn dev exige MongoDB local, sem autenticação, com replicaSet=rs0; use a porta 27018 ou outra porta local diferente de 27017.');
  }
  return value;
}

async function collectCommonEnv(environment, current) {
  const port = parsePort(await question('Porta HTTP do MCP', current.PORT || '3443'));
  const serviceUrl = validateServiceUrl(await question('URL base do serviço', current.SERVICE_URL || (environment === 'local' ? 'http://localhost:3443' : 'https://mcp.exemplo.com')));
  const leaseMinutes = await question('Duração do lease em minutos', current.LEASE_MINUTES || '30');
  if (!Number.isFinite(Number(leaseMinutes)) || Number(leaseMinutes) <= 0) throw new Error('LEASE_MINUTES deve ser um número positivo.');
  const allowedOrigins = await question('Origens CORS permitidas (separadas por vírgula; vazio para nenhuma)', current.ALLOWED_ORIGINS ?? serviceUrl);
  const logLevel = await question('Nível de log', current.LOG_LEVEL || 'info');
  return { PORT: port, SERVICE_URL: serviceUrl, LEASE_MINUTES: leaseMinutes, ALLOWED_ORIGINS: allowedOrigins, LOG_LEVEL: logLevel };
}

async function configureLocal(current) {
  const values = await collectCommonEnv('local', current);
  const defaultUri = 'mongodb://localhost:27018/project_tasks?replicaSet=rs0';
  const enteredUri = await secret('URI MongoDB local (entrada oculta; Enter usa a URI padrão sem autenticação)');
  values.MONGODB_URI = validateLocalMongoUri(enteredUri || defaultUri);
  values.MONGOD_PATH = (await question('Caminho do executável mongod (vazio para detecção automática/PATH)', current.MONGOD_PATH || undefined)) || null;
  values.MCP_AUTH_MODE = 'trusted_local';
  values.NODE_ENV = 'development';
  values.TLS_CERT_PATH = null;
  values.TLS_KEY_PATH = null;
  return values;
}

async function ensureDocker() {
  if (!commandAvailable('docker', ['info', '--format', '{{.ServerVersion}}'])) {
    throw new Error('Docker Engine não está instalado ou o daemon não está acessível. Instale/inicie o Docker e execute o assistente novamente.');
  }
}

async function configureDockerMongo() {
  await ensureDocker();
  const containerName = 'project-tasks-mongo';
  const port = '27018';
  const inspected = capture('docker', ['inspect', containerName]);
  if (inspected.status === 0) {
    let container;
    try { container = JSON.parse(inspected.stdout)[0]; }
    catch { throw new Error(`Não consegui inspecionar o container ${containerName}; ele foi preservado.`); }
    const binding = container.HostConfig?.PortBindings?.['27018/tcp']?.[0];
    if (binding?.HostIp !== '127.0.0.1' || binding?.HostPort !== port) {
      throw new Error(`O container ${containerName} já existe com outro vínculo de porta. Ele foi preservado; escolha uma URI MongoDB existente ou revise o container manualmente.`);
    }
    const command = container.Config?.Cmd ?? [];
    const persistentData = container.Mounts?.some(mount => mount.Type === 'volume' && mount.Name === 'project-tasks-mongo' && mount.Destination === '/data/db');
    if (!command.some((value, index) => value === '--replSet' && command[index + 1] === 'rs0') || !persistentData) {
      throw new Error(`O container ${containerName} não corresponde à configuração esperada (rs0 com volume persistente). Ele foi preservado; escolha uma URI MongoDB existente ou revise o container manualmente.`);
    }
    if (!container.State?.Running) await run('docker', ['start', containerName]);
  } else {
    await run('docker', ['volume', 'create', 'project-tasks-mongo']);
    await run('docker', [
      'run', '-d', '--name', containerName, '--restart', 'unless-stopped',
      '-p', `127.0.0.1:${port}:${port}`, '-v', 'project-tasks-mongo:/data/db',
      'mongo:8.0', 'mongod', '--replSet', 'rs0', '--bind_ip_all', '--port', port
    ]);
  }

  console.log('Aguardando o MongoDB e confirmando o replica set rs0...');
  const initialize = `const h=db.hello(); if(h.setName && h.setName!=='rs0'){print('ERRO: outro replica set já está configurado: '+h.setName); quit(3);} if(!h.setName){printjson(rs.initiate({_id:'rs0',members:[{_id:0,host:'localhost:${port}'}]}));} const s=db.hello(); if(s.setName==='rs0' && s.isWritablePrimary){print('PRIMARY'); quit(0);} print('WAIT'); quit(2);`;
  for (let attempt = 0; attempt < 30; attempt++) {
    const result = capture('docker', ['exec', containerName, 'mongosh', '--port', port, '--quiet', '--eval', initialize]);
    if (result.status === 0 && result.stdout.includes('PRIMARY')) {
      console.log('MongoDB pronto. Dados persistentes no volume project-tasks-mongo; porta exposta somente em 127.0.0.1.');
      return `mongodb://127.0.0.1:${port}/project_tasks?replicaSet=rs0`;
    }
    if (result.stdout.includes('outro replica set')) throw new Error(result.stdout.trim());
    if (attempt < 29) await new Promise(resolveDelay => setTimeout(resolveDelay, 2000));
  }
  throw new Error(`MongoDB não ficou pronto. O container e o volume foram preservados; consulte: docker logs ${containerName}`);
}

async function configureHostMongo(current) {
  if (!commandAvailable('sudo', ['--version'])) throw new Error('O helper do MongoDB no host precisa de sudo para configurar /etc/mongod.conf.');
  console.log('O helper pode alterar bindIp, criar/ajustar o keyFile, reiniciar mongod e inicializar rs0. Ele pedirá confirmação e fará backup do arquivo de configuração.');
  await run('sudo', ['bash', resolve(root, 'scripts/configure-mongodb-prod.sh'), '--configure']);
  let uri = current.MONGODB_URI || '';
  while (true) {
    const entered = await secret('URI MongoDB da aplicação (entrada oculta; vazio mantém a URI existente)');
    uri = entered || uri;
    try { return validateMongoUri(uri); }
    catch (error) { console.log(error.message); uri = ''; }
  }
}

async function configureProduction(current) {
  if (process.platform !== 'linux') throw new Error('A opção produção usa PM2/systemd e deve ser executada em Ubuntu/Linux.');
  if (typeof process.getuid === 'function' && process.getuid() === 0) throw new Error('Execute como o usuário que será dono do checkout e do PM2, sem sudo. O assistente usará sudo apenas para registrar o startup se você confirmar.');
  const values = await collectCommonEnv('produção', current);
  const databaseChoice = await choose('Como configurar o MongoDB?', [['d', 'criar/usar MongoDB dedicado em Docker local'], ['h', 'configurar MongoDB Community já instalado neste host'], ['u', 'usar uma instância MongoDB existente']], 'd');
  let existingMongoUri = '';
  if (databaseChoice === 'u') {
    existingMongoUri = current.MONGODB_URI || '';
    while (true) {
      const entered = await secret('URI MongoDB completa (entrada oculta; vazio mantém a URI existente)');
      existingMongoUri = entered || existingMongoUri;
      try { existingMongoUri = validateMongoUri(existingMongoUri); break; }
      catch (error) { console.log(error.message); existingMongoUri = ''; }
    }
  }
  values.MCP_AUTH_MODE = await choose('Autenticação do MCP', [['b', 'bearer (recomendado para produção)'], ['t', 'trusted_local (somente rede privada controlada)']], current.MCP_AUTH_MODE === 'trusted_local' ? 't' : 'b') === 'b' ? 'bearer' : 'trusted_local';
  values.NODE_ENV = 'production';
  if (values.SERVICE_URL.startsWith('https://')) {
    values.TLS_CERT_PATH = (await question('Certificado TLS servido diretamente pelo MCP (vazio se TLS termina em proxy)', current.TLS_CERT_PATH || '')) || null;
    values.TLS_KEY_PATH = (await question('Chave TLS (vazio se TLS termina em proxy)', current.TLS_KEY_PATH || '')) || null;
    if (Boolean(values.TLS_CERT_PATH) !== Boolean(values.TLS_KEY_PATH)) throw new Error('TLS_CERT_PATH e TLS_KEY_PATH devem ser definidos juntos.');
  } else {
    values.TLS_CERT_PATH = null;
    values.TLS_KEY_PATH = null;
    const url = new URL(values.SERVICE_URL);
    if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) console.log('A URL de produção usa HTTP remoto. Restrinja a rede ou configure TLS no MCP/proxy antes de expor o serviço.');
  }
  if (values.MCP_AUTH_MODE === 'trusted_local') console.log('Aviso: trusted_local confia na identidade informada pelo cliente; mantenha o serviço somente em rede privada controlada.');
  if (databaseChoice === 'd') values.MONGODB_URI = await configureDockerMongo();
  else if (databaseChoice === 'h') values.MONGODB_URI = await configureHostMongo(current);
  else values.MONGODB_URI = existingMongoUri;
  return values;
}

async function installDependencies(yarn) {
  await runYarn(yarn, ['install', '--frozen-lockfile', '--production=false']);
}

async function runLocal(yarn, env) {
  if (await confirm('Instalar as dependências do projeto?', true)) await installDependencies(yarn);
  if (!env.MONGOD_PATH && process.platform !== 'win32' && !commandAvailable('mongod', ['--version'])) console.log('MongoDB não encontrado no PATH. Instale MongoDB Community ou informe MONGOD_PATH antes de iniciar.');
  if (await confirm('Iniciar o ambiente local com yarn dev agora?', true)) await runYarn(yarn, ['dev']);
  else console.log('Ambiente preparado. Inicie quando quiser com: yarn dev');
}

async function installPm2() {
  if (commandAvailable('pm2', ['--version'])) return;
  if (!(await confirm('PM2 não encontrado. Instalar globalmente com npm?', true))) throw new Error('Instale PM2 e execute novamente para concluir a configuração de produção.');
  try {
    await run('npm', ['install', '--global', 'pm2']);
  } catch (error) {
    if (!commandAvailable('sudo', ['--version']) || !(await confirm('A instalação global falhou por permissão. Tentar com sudo?', false))) throw error;
    await run('sudo', ['npm', 'install', '--global', 'pm2']);
  }
  if (!commandAvailable('pm2', ['--version'])) throw new Error('PM2 ainda não está disponível no PATH após a instalação.');
}

async function bootstrapAdministrator(yarn) {
  if (!(await confirm('Deseja criar o primeiro administrador agora? A credencial será exibida uma única vez.', false))) return;
  const userId = await question('E-mail/identificador do administrador inicial');
  if (!userId || /[\r\n]/.test(userId)) throw new Error('Informe um identificador válido para o administrador.');
  console.log('Guarde o token mostrado a seguir em um gerenciador seguro; ele não será salvo no .env.');
  await runYarn(yarn, ['cli', '--', 'bootstrap', userId]);
}

async function runProduction(yarn, env) {
  if (env.MCP_AUTH_MODE === 'trusted_local') console.log('Aviso: trusted_local confia na identidade enviada pelo cliente; mantenha o serviço somente em rede privada controlada.');
  const serviceUrl = new URL(validateServiceUrl(env.SERVICE_URL));
  if (serviceUrl.protocol === 'http:' && !['localhost', '127.0.0.1', '::1', '[::1]'].includes(serviceUrl.hostname)) console.log('A URL de produção usa HTTP remoto. Restrinja a rede ou configure TLS no MCP/proxy antes de expor o serviço.');
  await installDependencies(yarn);
  await runYarn(yarn, ['build']);
  await installPm2();
  const listed = capture('pm2', ['jlist']);
  let alreadyRunning = false;
  if (listed.status === 0) {
    try { alreadyRunning = JSON.parse(listed.stdout).some(app => app.name === 'project-tasks-mcp'); }
    catch { throw new Error('Não consegui ler a lista de processos do PM2; nenhum processo foi alterado.'); }
  }
  if (alreadyRunning) await run('pm2', ['restart', 'project-tasks-mcp', '--update-env']);
  else await run('pm2', ['start', 'ecosystem.config.cjs', '--env', 'production']);
  await run('pm2', ['save']);

  if (commandAvailable('systemctl', ['--version']) && await confirm('Configurar o PM2 para iniciar automaticamente pelo systemd no boot?', true)) {
    if (commandAvailable('sudo', ['--version'])) {
      const configured = await run('sudo', ['env', `PATH=${process.env.PATH}`, 'pm2', 'startup', 'systemd', '-u', userInfo().username, '--hp', homedir()], { optional: true });
      if (!configured) console.log('O startup do PM2 não foi registrado. Execute o comando de startup indicado pelo PM2 com uma conta administrativa.');
    } else {
      console.log(`Execute como administrador para habilitar o startup: pm2 startup systemd -u ${userInfo().username} --hp ${homedir()}`);
    }
  } else if (!commandAvailable('systemctl', ['--version'])) console.log('systemd não foi detectado; PM2 foi salvo, mas o início automático no boot precisa ser configurado manualmente.');
  await run('pm2', ['status']);
  const port = Number(env.PORT || 3443);
  const directTls = Boolean(env.TLS_CERT_PATH && env.TLS_KEY_PATH);
  const healthUrl = directTls
    ? new URL(`${env.SERVICE_URL}/health`)
    : new URL(`http://127.0.0.1:${port}/health`);
  if (directTls) healthUrl.port = String(port);
  let healthy = false;
  for (let attempt = 0; attempt < 15; attempt++) {
    try {
      const response = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) });
      if (response.ok) { healthy = true; break; }
    } catch { /* PM2 may still be starting; the final status is reported below. */ }
    if (attempt < 14) await new Promise(resolveDelay => setTimeout(resolveDelay, 2000));
  }
  if (healthy) console.log(`Health check respondeu em ${healthUrl}.`);
  else console.log(`Não consegui confirmar /health em ${healthUrl}. Consulte: pm2 logs project-tasks-mcp --lines 100`);
  await bootstrapAdministrator(yarn);
  console.log('Produção configurada. MongoDB e PM2 usam processos independentes; não inicie também o serviço systemd project-tasks-mcp.');
}

async function main() {
  validateNode();
  const metadata = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  if (metadata.name !== 'project-tasks-mcp') throw new Error('Execute este assistente dentro do checkout project-tasks-mcp.');
  console.log('Assistente de configuração do Project Tasks MCP\n');
  const mode = await choose('Qual ambiente deseja configurar?', [['l', 'local'], ['p', 'produção']], 'l');
  const { current, keep } = await environmentChoice();
  const yarn = await ensureYarn();
  let env;
  if (keep) {
    for (const key of ['MONGODB_URI', 'PORT', 'SERVICE_URL', 'MCP_AUTH_MODE', 'LEASE_MINUTES']) {
      if (!current[key]?.trim()) throw new Error(`O .env existente não contém ${key}; escolha reconfigurar o arquivo e tente novamente.`);
    }
    if (mode === 'l') validateLocalMongoUri(current.MONGODB_URI);
    else validateMongoUri(current.MONGODB_URI);
    parsePort(current.PORT);
    validateServiceUrl(current.SERVICE_URL);
    if (!Number.isFinite(Number(current.LEASE_MINUTES)) || Number(current.LEASE_MINUTES) <= 0) throw new Error('LEASE_MINUTES no .env deve ser um número positivo.');
    if (!['trusted_local', 'bearer'].includes(current.MCP_AUTH_MODE)) throw new Error('MCP_AUTH_MODE no .env deve ser trusted_local ou bearer.');
    if (Boolean(current.TLS_CERT_PATH) !== Boolean(current.TLS_KEY_PATH)) throw new Error('TLS_CERT_PATH e TLS_KEY_PATH devem estar definidos juntos no .env.');
    env = current;
    console.log('Usando o .env existente sem exibir seus valores.');
  } else {
    const values = mode === 'l' ? await configureLocal(current) : await configureProduction(current);
    env = await saveEnv(values, current);
  }
  if (mode === 'l') await runLocal(yarn, env);
  else await runProduction(yarn, env);
}

main().catch(error => {
  console.error(`\nFalha na configuração: ${error.message}`);
  process.exitCode = 1;
}).finally(() => prompts.close());
