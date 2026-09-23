# Concluir e aprovar tarefas

## Tokens: qual usar

Existem tres credenciais diferentes:

| Credencial | Uso | Aprova tarefa? |
| --- | --- | --- |
| `X-Project-Tasks-Email` | Identifica agente no MCP `trusted_local` | Nao |
| `X-Project-Tasks-Project-Token` | Abre projeto privado | Nao |
| `ADMIN_TOKEN` | Credencial `human` administrativa, usada pela CLI | Sim |

`ADMIN_TOKEN` deve ter exatamente 64 caracteres hexadecimais e corresponder a uma credencial ativa com escopo `human`. Um `credentialId`, token de agente, ou token de projeto privado retorna 401 e nao pode aprovar tarefas.

## 1. Obter ou recuperar o token humano

No servidor, com acesso ao MongoDB configurado, recupere o token humano:

```powershell
yarn cli recover seu.email@empresa.com.br --confirm
```

Copie o valor `token` retornado. Ele revoga os tokens humanos anteriores desse e-mail. Carregue-o somente na sessao atual:

```powershell
$env:ADMIN_TOKEN = 'TOKEN_HEXADECIMAL_DE_64_CARACTERES'
```

Nunca configure esse token no Claude MCP nem o envie em conversas, commits ou arquivos versionados.

## 2. Consultar a tarefa e sua versao

```powershell
yarn cli context ID_DO_PROJETO ID_DA_TAREFA
```

Use o valor atual de `task.version`. A aprovacao falha se a versao estiver desatualizada ou se a tarefa nao estiver em `em_revisao`.

## Diffs e evidencias

`submit_task` pode referenciar `diffIds` produzidos por `publish_task_diff`. A aprovacao humana continua baseada no estado `em_revisao`, verificacoes e evidencias registradas; o diff nao aprova, faz merge ou implanta codigo.

## 3. Enviar a aprovacao

Crie um arquivo temporario `aprovar.json` fora do repositorio com os IDs e a versao consultada:

```json
{
  "action": "review",
  "operationId": "UUID_NOVO",
  "projectId": "ID_DO_PROJETO",
  "taskId": "ID_DA_TAREFA",
  "version": 3,
  "decision": "approve",
  "reason": "Revisado e aprovado"
}
```

Gere o UUID no PowerShell e aplique:

```powershell
[guid]::NewGuid().ToString()
yarn cli apply C:\Temp\aprovar.json
Remove-Item C:\Temp\aprovar.json
Remove-Item Env:ADMIN_TOKEN
```

O resultado deve mostrar `status: "concluida"`.

## Outras decisoes humanas

- `changes`: devolve uma tarefa em revisao para `pendente` com pedidos de ajuste.
- `unblock`: desbloqueia uma tarefa `bloqueada` e a devolve para `pendente`.
- `cancel`: cancela uma tarefa permitida pela regra de transicao.

Sempre consulte o contexto novamente antes de repetir uma operacao. Em caso de erro de versao, atualize `version`; em caso de 401, confirme que o `ADMIN_TOKEN` e um token humano ativo.

## Aprovar pelo Postman

Use a URL do servidor seguida de `/admin`, por exemplo `http://SERVIDOR:3443/admin`.

- Método: `POST`
- Headers:
  - `Authorization: Bearer TOKEN_HUMANO_DE_64_CARACTERES`
  - `Content-Type: application/json`
- Body: `raw` / `JSON`

Para aprovar, envie:

```json
{
  "action": "review",
  "operationId": "{{$guid}}",
  "projectId": "ID_DO_PROJETO",
  "taskId": "ID_DA_TAREFA",
  "version": 3,
  "decision": "approve",
  "reason": "Revisado e aprovado"
}
```

Troque somente `decision` para usar as demais transições permitidas:

| Decisão | Estado exigido | Resultado |
| --- | --- | --- |
| `approve` | `em_revisao` | `concluida` |
| `changes` | `em_revisao` | `pendente` |
| `unblock` | `bloqueada` | `pendente` |
| `cancel` | `pendente`, `em_execucao`, `bloqueada` ou `em_revisao` | `cancelada` |

Para consultar a tarefa no Postman antes de decidir, envie `POST /admin/query` com os mesmos headers:

```json
{
  "tool": "get_task_context",
  "arguments": {
    "projectId": "ID_DO_PROJETO",
    "taskId": "ID_DA_TAREFA"
  }
}
```

O Postman substitui `{{$guid}}` automaticamente por um UUID novo a cada envio. Copie a `version` atual de `task.version` para o corpo de `/admin`.

Se a rede falhar depois do envio, nao use `{{$guid}}` para o retry: copie o UUID usado do Postman, substitua-o no body por texto fixo e repita o mesmo corpo. Isso preserva a idempotencia e evita aprovar duas vezes.

## Diagnostico de erros comuns

### `Project access denied`

Confira, nesta ordem:

1. A URL chama o processo certo: em desenvolvimento use `http://localhost:3443/admin`; em servidor compartilhado use a URL publicada dele. Nao misture o token de um banco com a URL de outro servidor.
2. O token deve ser uma credencial `human`. Token de agente, token privado de projeto e `credentialId` nao servem para `/admin`.
3. Para um administrador normal, o e-mail da credencial precisa estar em `project.members` com papel `administrador`. Uma credencial `systemAdmin` pode administrar qualquer projeto.
4. O `projectId` precisa ser o mesmo da tarefa. Consulte `POST /admin/query` com `get_task_context` e use `task.projectId`/`project._id` retornados.

### `Version conflict`

Nao reutilize uma versao copiada de outra tela. Consulte a tarefa imediatamente antes da decisao e copie `task.version` atual para o campo `version`. Cada mutacao bem-sucedida incrementa a versao.

### `Invalid user ID or email`

Em uma acao `member`, envie apenas o e-mail puro em `userId`. Nao escape o `@` e nao inclua token, barras, asteriscos ou espacos:

```json
"userId": "nome@empresa.com.br"
```

### Token exposto

Nunca cole token em conversa, log, print ou arquivo versionado. Se isso acontecer, rotacione-o no ambiente correto:

```powershell
yarn cli recover nome@empresa.com.br --confirm
```

Use o token novo somente no header `Authorization: Bearer ...` e remova `ADMIN_TOKEN` da sessao ao terminar.
