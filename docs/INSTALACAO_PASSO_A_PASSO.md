# Instalação passo a passo: servidor Windows, Ubuntu e máquinas clientes

Guia para o contrato da versão 0.2.0. Os comandos abaixo são instruções para o operador; sua publicação não instala nem ativa serviços.

## 1. Escolha o papel de cada máquina

| Papel | Instalar | Precisa permanecer ligado? |
| --- | --- | --- |
| Servidor MCP | Código deste projeto, Node.js, dependências e MongoDB em replica set | Sim, para atender a equipe |
| Cliente manual | Codex e/ou Claude Code, conexão global ao endereço do servidor | Durante o uso |
| Executor automático, opcional | Código deste projeto, Node.js, Git, clientes dos provedores e repositórios de trabalho | Sim, enquanto executar tarefas |

Uma máquina pode acumular papéis. **Clientes comuns não precisam instalar MongoDB, clonar este projeto ou iniciar outro servidor.** O sistema operacional do cliente pode ser diferente do servidor.

Siga a seção 2 para Windows ou a seção 3 para Ubuntu; depois configure identidades na seção 4 e cada cliente na seção 5. A seção 6 adiciona executores automáticos.

Antes de começar, defina:

- A URL Git deste projeto e uma revisão completa para instalar.
- O nome/IP do servidor alcançável pelas máquinas da equipe.
- O e-mail individual de cada pessoa e quais projetos ela pode acessar.
- O modo de autenticação: `trusted_local` apenas em rede privada controlada; `bearer` com HTTPS para equipe e executores remotos.

Exemplos usados: `http://localhost:3443` para a mesma máquina e `https://mcp.empresa.com.br:3443` para a equipe. Substitua o domínio pelo nome real, com DNS e certificado correspondentes. A URL dos clientes termina em `/mcp`; `SERVICE_URL` e a URL do executor não têm esse sufixo. `localhost` em um cliente aponta para o próprio cliente.

Use um checkout contendo `src/main.ts`, `src/cli.ts`, `src/runner/main.ts`, `env.config.ts`, `package.json` e `yarn.lock`. Se `git status --short` mostrar exclusões de `src/`, use outro checkout completo da revisão desejada; não restaure arquivos por cima de trabalho em andamento.

## 2. Servidor em uma máquina Windows

### 2.1. Instalar os pré-requisitos

1. Instale Git e [Node.js 24](https://nodejs.org/en/download), incluindo npm no PATH.
2. Instale [MongoDB Community para Windows](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-windows/). O helper deste projeto precisa do executável `mongod.exe`; ele não baixa o MongoDB automaticamente.
3. Abra um novo PowerShell e confira:

```powershell
git --version
node --version
npm --version
npm install --global yarn@1.22.22
yarn --version
```

### 2.2. Obter o projeto e instalar dependências

```powershell
New-Item -ItemType Directory -Force C:\Servicos | Out-Null
Set-Location C:\Servicos
git clone <URL_GIT_DO_PROJETO> project-tasks-mcp
Set-Location C:\Servicos\project-tasks-mcp
yarn install --frozen-lockfile
```

Substitua `<URL_GIT_DO_PROJETO>` antes de executar. Não use `npm ci`: este checkout fornece `yarn.lock`, e o comando exige um lockfile npm.

### 2.3. Configurar o ambiente

Crie `.env` na raiz deste servidor, ao lado de `package.json`:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27018/project_tasks?replicaSet=rs0
PORT=3443
SERVICE_URL=http://localhost:3443
ALLOWED_ORIGINS=http://localhost:3443
MCP_AUTH_MODE=trusted_local
LEASE_MINUTES=30
LOG_LEVEL=info
```

Este primeiro exemplo é para uso local. Para acesso privado de outras máquinas, substitua `localhost` em `SERVICE_URL` e `ALLOWED_ORIGINS` pelo nome real do servidor. Não altere o host do MongoDB: ele permanece local.

Se o MongoDB não estiver no diretório padrão de instalação, acrescente o caminho real:

```dotenv
MONGOD_PATH=C:/Program Files/MongoDB/Server/8.0/bin/mongod.exe
```

Variáveis já definidas no processo têm precedência sobre `.env`; os defaults de `env.config.ts` completam os valores ausentes. Reinicie o processo após mudar a configuração.

### 2.4. Iniciar MongoDB e MCP

Para desenvolvimento, em um terminal:

```powershell
yarn dev
```

Esse comando inicia o MongoDB e reinicia o MCP quando o código muda. Para operar sem o observador de arquivos, use dois terminais, ambos na raiz do projeto:

```powershell
# Terminal 1: manter aberto
yarn mongo:local
```

```powershell
# Terminal 2: manter aberto
yarn start
```

O helper mantém os dados em `.local/mongo`, cria `rs0` e usa a porta `27018`. Ele não altera um MongoDB existente na porta `27017`. Encerrar o terminal do helper encerra o MongoDB que ele iniciou; os dados continuam no disco. Execute sempre a partir da mesma pasta para reutilizar os dados.

### 2.5. Conferir e permitir acesso privado

```powershell
Invoke-RestMethod http://localhost:3443/health
```

O resultado esperado é `status: ok`. Para clientes da rede privada, execute em PowerShell elevado, apenas se essa exposição for desejada:

```powershell
New-NetFirewallRule -DisplayName 'Project Tasks MCP - rede privada' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 3443 -Profile Private -RemoteAddress LocalSubnet
```

Para VPN ou outra sub-rede, peça à equipe de rede a regra com os endereços autorizados. Não abra as portas do MongoDB. A lista `ALLOWED_ORIGINS` valida o cabeçalho HTTP `Origin`, quando presente; ela não substitui firewall nem autenticação.

### 2.6. HTTPS e inicialização persistente

Para atender executores remotos, obtenha um certificado confiável com o nome do servidor e altere `.env`:

```dotenv
SERVICE_URL=https://mcp.empresa.com.br:3443
ALLOWED_ORIGINS=https://mcp.empresa.com.br:3443
MCP_AUTH_MODE=bearer
TLS_CERT_PATH=C:/Servicos/project-tasks-mcp/certs/fullchain.pem
TLS_KEY_PATH=C:/Servicos/project-tasks-mcp/certs/private.key
```

Defina os dois caminhos TLS juntos, restrinja a chave ao usuário do serviço e reinicie o MCP. O certificado deve ser confiável também na máquina servidora, pois a CLI usa `SERVICE_URL`. Prossiga para a seção 4 para emitir credenciais.

Para iniciar no logon sem terminais abertos, crie duas tarefas no Agendador de Tarefas do Windows:

| Campo | MongoDB | MCP |
| --- | --- | --- |
| Programa | Caminho absoluto retornado por `(Get-Command node).Source` | Mesmo executável |
| Argumentos | `--env-file-if-exists=.env --import tsx src/local-mongo.ts` | `--env-file-if-exists=.env --import tsx src/main.ts` |
| Iniciar em | `C:\Servicos\project-tasks-mcp` | `C:\Servicos\project-tasks-mcp` |
| Gatilho | No logon do usuário responsável | Mesmo logon, com atraso de 30 segundos |

Configure reinício após falha e remova o limite de duração. Pare os processos manuais antes de iniciar as tarefas para evitar disputa de porta. Esse modo depende do logon e da máquina permanecer acordada. Para funcionamento desde o boot sem sessão de usuário, prefira o serviço Ubuntu abaixo ou um gerenciador de serviços Windows homologado pela equipe.

## 3. Servidor Ubuntu com systemd

Este roteiro usa Node.js no host e MongoDB 8 em um container dedicado, com dados persistentes e acesso somente local. Não usa o Dockerfile atual da aplicação: ele pressupõe lockfile npm e não copia `env.config.ts`, exigindo ajustes antes de servir como alternativa de implantação.

### 3.1. Preparar o host

1. Use Ubuntu 24.04 LTS e instale Git, curl e certificados:

```bash
sudo apt-get update
sudo apt-get install -y git curl ca-certificates
```

2. Instale Node.js 24 pelo [procedimento oficial](https://nodejs.org/en/download), disponibilizando `node` e `npm` ao usuário do serviço. Não presuma que o pacote `nodejs` padrão da distribuição fornece essa versão.
3. Instale Docker Engine seguindo o [procedimento oficial para Ubuntu](https://docs.docker.com/engine/install/ubuntu/).
4. Confira e habilite Docker no boot:

```bash
node --version
npm --version
sudo npm install --global yarn@1.22.22
sudo systemctl enable --now docker
sudo docker version
```

O exemplo usa uma instalação de Node acessível ao sistema. Instalações via gerenciadores no perfil do administrador precisam ser substituídas por caminhos acessíveis ao usuário `projecttasks` nas unidades systemd.

### 3.2. Criar o MongoDB dedicado

Execute uma única vez em um host novo, sem outro container com esse nome:

```bash
sudo docker volume create project-tasks-mongo
sudo docker run -d --name project-tasks-mongo --restart unless-stopped \
  -p 127.0.0.1:27018:27018 \
  -v project-tasks-mongo:/data/db \
  mongo:8.0 mongod --replSet rs0 --bind_ip_all --port 27018
sudo docker exec project-tasks-mongo mongosh --port 27018 --quiet \
  --eval 'rs.initiate({_id:"rs0",members:[{_id:0,host:"localhost:27018"}]})'
```

Se o primeiro `mongosh` encontrar conexão recusada, aguarde a inicialização e repita somente a chamada de inicialização. Confira:

```bash
sudo docker exec project-tasks-mongo mongosh --port 27018 --quiet \
  --eval 'db.hello().isWritablePrimary'
```

Espere `true` antes de iniciar o MCP. `rs.initiate` não precisa ser repetido em reinícios; “already initialized” indica configuração existente. A porta interna e externa são iguais para que o endereço anunciado pelo replica set funcione também no host. Não conecte clientes ou um container separado de aplicação a esse endereço: esta topologia é para o MCP no host.

O MongoDB deste exemplo não tem autenticação e fica restrito ao loopback do host. Não publique `27018` em `0.0.0.0`. O volume mantém os dados ao recriar o container; não remova o volume para atualizar.

### 3.3. Instalar a aplicação

```bash
sudo useradd --system --create-home --home-dir /var/lib/projecttasks --shell /usr/sbin/nologin projecttasks
sudo install -d -o projecttasks -g projecttasks /opt/project-tasks-mcp
sudo -u projecttasks git clone <URL_GIT_DO_PROJETO> /opt/project-tasks-mcp
cd /opt/project-tasks-mcp
sudo -u projecttasks yarn install --frozen-lockfile
sudo install -o projecttasks -g projecttasks -m 600 /dev/null .env
sudoedit .env
```

Em uma instalação nova, preencha `.env` com:

```dotenv
MONGODB_URI=mongodb://127.0.0.1:27018/project_tasks?replicaSet=rs0
PORT=3443
SERVICE_URL=https://mcp.empresa.com.br:3443
ALLOWED_ORIGINS=https://mcp.empresa.com.br:3443
MCP_AUTH_MODE=bearer
LEASE_MINUTES=30
LOG_LEVEL=info
TLS_CERT_PATH=/etc/project-tasks-mcp/fullchain.pem
TLS_KEY_PATH=/etc/project-tasks-mcp/private.key
```

Não repita `install /dev/null .env` em uma atualização: isso esvazia a configuração existente.

### 3.4. Instalar o certificado

Obtenha o certificado e sua cadeia com a equipe responsável pelo domínio/CA. Copie-os para os caminhos configurados:

```bash
sudo install -d -o root -g projecttasks -m 750 /etc/project-tasks-mcp
sudo install -o root -g projecttasks -m 640 /CAMINHO/fullchain.pem /etc/project-tasks-mcp/fullchain.pem
sudo install -o root -g projecttasks -m 640 /CAMINHO/private.key /etc/project-tasks-mcp/private.key
```

Substitua os caminhos de origem. Para certificado corporativo, instale a CA conforme a política da empresa, inclusive nos clientes. Processos Node podem precisar de `NODE_EXTRA_CA_CERTS=/caminho/ca-corporativa.pem`, definido antes de iniciar o processo. Não desabilite a verificação TLS.

Para um piloto exclusivamente privado e manual, é possível usar `http://NOME_DO_SERVIDOR:3443`, `trusted_local` e omitir os dois campos TLS. Executores remotos exigem HTTPS. Outra opção é terminar TLS em um proxy autorizado, mantendo o trecho HTTP interno inacessível externamente e desabilitando buffering para o streaming MCP.

### 3.5. Registrar o serviço

Identifique o caminho absoluto do Node:

```bash
command -v node
```

Crie `/etc/systemd/system/project-tasks-mcp.service` com `sudoedit`. Substitua `/usr/bin/node` abaixo se o comando retornar outro caminho:

```ini
[Unit]
Description=Project Tasks MCP
Wants=network-online.target
After=network-online.target docker.service
Requires=docker.service

[Service]
Type=simple
User=projecttasks
Group=projecttasks
WorkingDirectory=/opt/project-tasks-mcp
EnvironmentFile=/opt/project-tasks-mcp/.env
ExecStart=/usr/bin/node --import tsx /opt/project-tasks-mcp/src/main.ts
Restart=on-failure
RestartSec=10
TimeoutStopSec=30
UMask=0077

[Install]
WantedBy=multi-user.target
```

O serviço usa o código TypeScript com `tsx`, como `yarn start`; não depende de build. A ordenação após Docker não garante que o replica set já esteja pronto: se necessário, o processo reinicia após falha de conexão.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now project-tasks-mcp
sudo systemctl status project-tasks-mcp --no-pager
sudo journalctl -u project-tasks-mcp -n 50 --no-pager
curl --fail https://mcp.empresa.com.br:3443/health
```

O domínio precisa resolver também no servidor. Para liberar a rede, se UFW já for o firewall adotado, ajuste a sub-rede ao ambiente:

```bash
sudo ufw allow from 192.168.1.0/24 to any port 3443 proto tcp
```

Não habilite um firewall novo em uma sessão remota sem antes garantir acesso SSH. Restrinja também o firewall externo/security group, quando houver.

## 4. Criar administrador, credenciais e acesso aos projetos

### 4.1. Primeiro administrador

Com MongoDB ativo, na raiz do projeto do servidor:

```bash
yarn cli bootstrap administrador@empresa.com.br
```

No Ubuntu execute como proprietário da aplicação: `sudo -u projecttasks yarn cli bootstrap administrador@empresa.com.br`. O bootstrap acessa diretamente o banco configurado e só funciona uma vez por banco. Guarde o token humano retornado em um gerenciador de senhas; não o entregue aos agentes.

### 4.2. Emitir um token individual de agente

No PowerShell, carregue o token humano sem escrevê-lo no histórico:

```powershell
$env:ADMIN_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'Token humano' -AsSecureString)).Password
yarn cli issue pessoa@empresa.com.br agent
Remove-Item Env:ADMIN_TOKEN
```

No Ubuntu, na raiz do projeto, use um shell Bash e o mesmo procedimento de entrada protegida:

```bash
read -rsp 'Token humano: ' ADMIN_TOKEN; echo
export ADMIN_TOKEN
sudo --preserve-env=ADMIN_TOKEN -u projecttasks yarn cli issue pessoa@empresa.com.br agent
unset ADMIN_TOKEN
```

Repita para cada identidade autorizada. O resultado contém o token de agente, com 64 caracteres hexadecimais. O `credentialId` é um identificador e não serve como token. Um executor também recebe token de agente próprio; nunca recebe `ADMIN_TOKEN`.

Em `trusted_local`, clientes manuais usam o e-mail em vez de token. A CLI administrativa e os executores continuam exigindo bearer.

### 4.3. Associar identidades aos projetos

Autenticar não concede acesso automático a todos os projetos. Para um projeto novo, use a IA conectada para criar o projeto, cadastrar seus repositórios e obter os UUIDs; o criador recebe a função de administrador do projeto. Consulte [Uso do MCP](USO_MCP.md).

Para adicionar outra pessoa a um projeto existente, o administrador deve obter seu UUID e sua `version` atual e salvar um arquivo `membro.json`:

```json
{
  "action": "member",
  "operationId": "SUBSTITUIR_POR_UUID_NOVO",
  "projectId": "UUID_DO_PROJETO",
  "version": 1,
  "userId": "pessoa@empresa.com.br",
  "role": "colaborador"
}
```

Substitua os IDs e a versão; gere UUID com `[guid]::NewGuid().ToString()` no PowerShell ou `node -p 'crypto.randomUUID()'` no Bash. Com `ADMIN_TOKEN` carregado, execute `yarn cli apply membro.json` (no Ubuntu, como `projecttasks`, preservando a variável como acima). Use `leitor` quando só houver necessidade de consulta. O token humano usado deve ter autorização administrativa para a operação.

Em novas mutações use novo `operationId`; em uma repetição da mesma operação mantenha UUID e argumentos idênticos. Use sempre a versão devolvida pelo servidor.

## 5. Configurar as máquinas que usarão o MCP

### 5.1. Conferir acesso ao servidor

Instale e autentique Codex e/ou Claude Code na máquina cliente. Depois verifique o endereço entregue pelo administrador:

```powershell
# Windows
Test-NetConnection mcp.empresa.com.br -Port 3443
Invoke-RestMethod https://mcp.empresa.com.br:3443/health
```

```bash
# Ubuntu
curl --fail https://mcp.empresa.com.br:3443/health
```

`/health` verifica disponibilidade; não valida o token nem as permissões. Abrir `/mcp` no navegador também não testa a inicialização do protocolo.

### 5.2. Disponibilizar o token no modo bearer

Windows, no PowerShell que iniciará o cliente:

```powershell
$env:PROJECT_TASKS_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'Token de agente' -AsSecureString)).Password
```

Para aplicativos abertos pelo menu, pode-se persistir a variável no perfil do usuário:

```powershell
[Environment]::SetEnvironmentVariable('PROJECT_TASKS_TOKEN', $env:PROJECT_TASKS_TOKEN, 'User')
```

Encerre a sessão do Windows e entre novamente para que aplicativos e tarefas no logon herdem o ambiente atualizado. Variáveis de usuário não são um cofre de segredos; use o mecanismo corporativo quando disponível.

Ubuntu, no Bash que iniciará o cliente:

```bash
read -rsp 'Token de agente: ' PROJECT_TASKS_TOKEN; echo
export PROJECT_TASKS_TOKEN
```

Esse valor vale para o shell e seus filhos. Para um aplicativo gráfico, configure a variável no ambiente de sua sessão/launcher conforme a política local. Um `.env` no projeto de trabalho não é automaticamente carregado pelo Codex ou Claude.

### 5.3. Codex: configuração global Windows e Ubuntu

Edite o arquivo do usuário preservando as outras entradas:

- Windows: `%USERPROFILE%\.codex\config.toml`.
- Ubuntu: `~/.codex/config.toml`.
- Se `CODEX_HOME` estiver personalizado, use `config.toml` nesse diretório.

Para bearer:

```toml
[mcp_servers.project_tasks]
url = "https://mcp.empresa.com.br:3443/mcp"
bearer_token_env_var = "PROJECT_TASKS_TOKEN"
startup_timeout_sec = 20
```

Para `trusted_local`, use este bloco alternativo:

```toml
[mcp_servers.project_tasks]
url = "http://NOME_DO_SERVIDOR:3443/mcp"
http_headers = { "X-Project-Tasks-Email" = "pessoa@empresa.com.br" }
startup_timeout_sec = 20
```

Mantenha apenas uma seção `project_tasks`. Feche e reabra o Codex; no CLI, confira `codex mcp list` e peça uma consulta aos projetos permitidos. A variável de bearer deve existir no processo do cliente. Veja a [documentação oficial de MCP no Codex](https://developers.openai.com/codex/mcp/).

### 5.4. Claude Code: configuração global Windows e Ubuntu

Para bearer, execute no PowerShell ou Bash, mantendo as aspas simples para preservar a referência à variável:

```bash
claude mcp add --transport http --scope user project_tasks https://mcp.empresa.com.br:3443/mcp --header 'Authorization: Bearer ${PROJECT_TASKS_TOKEN}'
```

Para `trusted_local`, use esta alternativa:

```bash
claude mcp add --transport http --scope user project_tasks http://NOME_DO_SERVIDOR:3443/mcp --header 'X-Project-Tasks-Email: pessoa@empresa.com.br'
```

Confira a conexão:

```bash
claude mcp get project_tasks
claude mcp list
claude
```

No chat, abra `/mcp` e consulte os projetos. O escopo `user` disponibiliza o servidor nos projetos desse usuário. Se já houver entrada com esse nome, confira sua origem antes de removê-la com `claude mcp remove project_tasks --scope user` e cadastrá-la novamente. Entradas antigas em outros escopos também podem causar conflito.

Estas instruções são para **Claude Code**; não pressupõem que o aplicativo Claude Desktop use a mesma configuração. Referência: [MCP no Claude Code](https://code.claude.com/docs/en/mcp).

### 5.5. Instalador Windows existente

O script `scripts/install-project-tasks-mcp.ps1` configura Codex, Claude ou ambos interativamente:

```powershell
.\scripts\install-project-tasks-mcp.ps1
```

Na versão atual ele usa `trusted_local` e tem o endpoint `http://AVB-NB-00295:3443/mcp` fixo. Use-o somente para esse servidor. Para Ubuntu, outro endereço ou bearer, siga a configuração manual acima. Não crie `.mcp.json` ou `.codex/config.toml` dentro dos repositórios de trabalho.

## 6. Opcional: máquina executora Codex/Claude

Conectar um MCP ao chat permite uso manual. Para trabalhar sem chat aberto, instale o executor independente. A automação começa desabilitada e cada task exige liberação humana.

### 6.1. Preparar a máquina

1. Instale Node.js 24, Yarn 1.22.22, Git e os clientes dos provedores que serão usados.
2. Faça login nos provedores com o mesmo usuário do sistema operacional que executará o runner. Confirme `codex --version` e/ou `claude --version` e uma sessão funcional.
3. Clone este MCP em um caminho permanente e execute `yarn install --frozen-lockfile`.
4. Clone os repositórios de trabalho, configure acesso Git e confirme que possuem um commit `HEAD`. Eles são separados do código do MCP.
5. Peça um token individual de agente e associação aos projetos autorizados. Verifique HTTPS e a confiança no certificado.

### 6.2. Criar a configuração do executor

Crie `~/.project-tasks-runner/config.json` no perfil do usuário (no Windows, `C:\Users\USUARIO\.project-tasks-runner\config.json`):

```json
{
  "serviceUrl": "https://mcp.empresa.com.br:3443",
  "machineId": "UUID_UNICO_DESTA_MAQUINA",
  "projects": ["UUID_DO_PROJETO"],
  "providers": ["codex", "claude"],
  "repositories": {
    "UUID_DO_REPOSITORIO": "C:/Repositorios/aplicacao"
  },
  "worktreeRoot": "C:/Users/USUARIO/.project-tasks-runner/worktrees",
  "maxConcurrent": 2
}
```

No Ubuntu, troque os caminhos por absolutos, por exemplo `/home/usuario/repos/aplicacao` e `/home/usuario/.project-tasks-runner/worktrees`. Substitua todos os UUIDs e mantenha `machineId` estável. Liste somente provedores instalados. Se os executáveis não estiverem no PATH do serviço, configure `codexBinary` e `claudeBinary` com caminhos absolutos. Não coloque tokens no JSON.

O runner cria worktrees exclusivos a partir de `HEAD`; alterações sem commit no checkout original não entram neles. A configuração não concede acesso a projetos por si só: o servidor também verifica a identidade.

### 6.3. Iniciar manualmente

Windows, na raiz do código do MCP:

```powershell
$env:RUNNER_TOKEN = [System.Net.NetworkCredential]::new('', (Read-Host 'Token do executor' -AsSecureString)).Password
yarn runner "$env:USERPROFILE/.project-tasks-runner/config.json"
```

Ubuntu:

```bash
read -rsp 'Token do executor: ' RUNNER_TOKEN; echo
export RUNNER_TOKEN
yarn runner "$HOME/.project-tasks-runner/config.json"
```

O comando `runner` não carrega automaticamente o `.env` do servidor. Configure `RUNNER_TOKEN` no ambiente do processo. HTTP só é aceito pelo runner em loopback; a conexão remota exige HTTPS.

### 6.4. Inicialização automática Windows

Depois de testar manualmente, encerre esse processo e, na raiz do MCP, execute:

```powershell
[Environment]::SetEnvironmentVariable('RUNNER_TOKEN', $env:RUNNER_TOKEN, 'User')
.\scripts\install-project-tasks-runner.ps1 -ConfigPath "$env:USERPROFILE/.project-tasks-runner/config.json" -AutoStart
```

O instalador cria um launcher no perfil e a tarefa `Project Tasks Runner` para o logon. Faça novo logon para herdar o token. Ele referencia o checkout do MCP: não mova nem apague essa pasta. Somente uma instância por `machineId` deve estar ativa.

### 6.5. Inicialização automática Ubuntu

No perfil do usuário que já autenticou os provedores, salve o token informado interativamente em um arquivo restrito:

```bash
mkdir -p "$HOME/.project-tasks-runner" "$HOME/.config/systemd/user"
chmod 700 "$HOME/.project-tasks-runner"
read -rsp 'Token do executor: ' RUNNER_TOKEN; echo
(umask 077; printf 'RUNNER_TOKEN=%s\n' "$RUNNER_TOKEN" > "$HOME/.project-tasks-runner/runner.env")
unset RUNNER_TOKEN
```

Crie `~/.config/systemd/user/project-tasks-runner.service`, substituindo `USUARIO`, o caminho do checkout e o caminho retornado por `command -v node`:

```ini
[Unit]
Description=Project Tasks Runner

[Service]
Type=simple
WorkingDirectory=/home/USUARIO/servicos/project-tasks-mcp
EnvironmentFile=%h/.project-tasks-runner/runner.env
Environment=PATH=/home/USUARIO/.local/bin:/usr/local/bin:/usr/bin:/bin
ExecStart=/usr/bin/node --import tsx /home/USUARIO/servicos/project-tasks-mcp/src/runner/main.ts /home/USUARIO/.project-tasks-runner/config.json
Restart=on-failure
RestartSec=10
UMask=0077

[Install]
WantedBy=default.target
```

Inclua também `NODE_EXTRA_CA_CERTS` no `runner.env` se necessário. Pare a instância manual e inicie:

```bash
systemctl --user daemon-reload
systemctl --user enable --now project-tasks-runner
systemctl --user status project-tasks-runner --no-pager
journalctl --user -u project-tasks-runner -n 50 --no-pager
```

Para continuar após logout e iniciar no boot, um administrador pode habilitar `sudo loginctl enable-linger USUARIO`. Sem linger, o serviço depende da sessão do usuário. Sessões dos provedores que dependem de um cofre interativo podem exigir ajuste de autenticação conforme o provedor; valide um reinício sem login antes de considerar a instalação autônoma.

### 6.6. Ativar o primeiro trabalho

Pelo canal administrativo humano:

1. Configure o roteamento por repositório/área e habilite a política do projeto.
2. Libere uma task na revisão atual, com dependências já aprovadas.
3. Consulte `yarn cli automation UUID_DO_PROJETO` com `ADMIN_TOKEN` carregado.
4. Confira presença do executor, reserva, progresso e envio para revisão.
5. Resolva solicitações de permissão e aprove o resultado pela CLI humana.

Os JSONs das operações, limites, recuperação e rollback estão em [Automação supervisionada](AUTOMACAO.md). Ausência de rota, liberação ou dependência aprovada impede despacho; troca de mensagens não substitui aprovação.

## 7. Bridge MCP Git opcional

Em um cliente que suporte MCP stdio, instale a bridge no perfil do usuário e mantenha os segredos somente no ambiente:

```powershell
$env:PTM_SERVICE_URL = 'https://SERVIDOR:3443'
$env:PTM_BRIDGE_TOKEN = 'TOKEN_DE_AGENTE'
yarn bridge
```

Abra o chat dentro do checkout e chame `status`. Um administrador humano deve primeiro vincular o repositório cadastrado com `bind_repository_git`, usando a URL remota canônica e o commit raiz. A bridge não substitui autorização do servidor, não lê arquivos fora do Git e não deve receber token em configuração versionada.

## 8. Operação e diagnóstico

| Sintoma | Verificação |
| --- | --- |
| Arquivo `src/main.ts` ausente | Checkout incompleto; instale uma revisão íntegra em outra pasta |
| Falha de transação ou Change Stream | MongoDB precisa ser replica set `rs0` com primary; standalone não atende |
| `mongod` não encontrado no Windows | Instalação Community e `MONGOD_PATH` |
| `/health` inacessível | Processo, DNS, porta, firewall, certificado e logs |
| `/health` funciona, MCP retorna 401 | Token de agente ativo ou cabeçalho de e-mail no modo correto; reinicialize a sessão após trocar identidade |
| Consulta retorna 403 | Associação/role do projeto; se erro for `Origin denied`, confira `ALLOWED_ORIGINS` |
| Certificado rejeitado | Nome DNS, cadeia e CA confiável no cliente e no serviço; não use bypass TLS |
| Cliente envia variável literal | Variável ausente no processo ou cliente antigo; confira versão e ambiente do launcher |
| Executor conectado sem executar | Política habilitada, rota, liberação válida, dependências, token/membro, capacidade e limites |
| Execução expirada/bloqueada | Intervenção humana; não force outra execução para repetir ações de resultado incerto |

No Ubuntu, reinicie a aplicação após mudanças com `sudo systemctl restart project-tasks-mcp`. Para o executor, use `systemctl --user restart project-tasks-runner`. No Windows, reinicie o processo ou a tarefa agendada correspondente.

Antes de atualizar, suspenda novos despachos e trate execuções em andamento. Preserve configuração, credenciais, dados MongoDB e worktrees. Faça backup consistente com ferramentas MongoDB e teste a restauração; copiar arquivos de um banco em execução não substitui backup consistente. Não apague volumes ou `.local/mongo` para resolver um problema de instalação.

Critério de instalação concluída: health OK, cliente inicializa MCP e consulta um projeto autorizado, identidade sem acesso continua bloqueada e, quando automação for utilizada, um trabalho piloto percorre liberação, execução e revisão humana. Builds, testes globais e execuções de modelos não são parte automática deste roteiro.
