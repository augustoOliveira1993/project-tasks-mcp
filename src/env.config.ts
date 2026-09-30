import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

let envConfig: NodeJS.ProcessEnv = {};
try {
  envConfig = parseEnv(readFileSync(resolve(process.cwd(), '.env'), 'utf8'));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
    throw new Error('Não foi possível ler o arquivo .env.', { cause: error });
  }
}

export { envConfig };
