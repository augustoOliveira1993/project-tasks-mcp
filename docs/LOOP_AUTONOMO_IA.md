# Colaboração autônoma de IAs em tarefas e features

Este guia explica o que o runner já faz, como executar e testar o comportamento atual e qual implementação é necessária para deixar várias IAs avançarem em um ciclo sem coordenação humana pelo chat.

> **Estado atual:** o runner executa agentes sem uma pessoa no chat durante cada turno, mas uma pessoa ainda precisa liberar cada tarefa automatizada e aprovar a entrega para desbloquear dependências. Aprovação automática e repetição automática após revisão ainda não existem. As etapas futuras descritas neste documento são um plano, não opções de configuração já disponíveis.

## O que significa “loop autônomo”

O orquestrador deve acompanhar uma feature até atingir um resultado terminal:

```text
backlog elegível
  → selecionar tarefa e provedor
  → executar em worktree isolado
  → submeter evidências
  → revisar com agente independente
      → aprovado pela política → liberar próxima dependência
      → ajustes necessários → devolver ao executor, com limite de tentativas
      → incerto, inseguro ou limite atingido → parar e pedir decisão humana
  → encerrar feature quando todas as tarefas forem terminais
```

Autonomia significa que o sistema executa esse ciclo sem esperar uma mensagem no chat. A configuração inicial, escolha de escopo e política continuam sendo feitas por uma pessoa. Não é seguro dar ao agente executor acesso administrativo para aprovar o próprio trabalho.

## O que já existe

| Capacidade | Disponível agora | Observação |
|---|---|---|
| Runner local contínuo | Sim | Consulta eventos, reserva jobs liberados e executa Codex ou Claude em worktrees. |
| Vários provedores | Sim | Rotas humanas associam repositório/área a um provedor; a liberação pode especificar provedor. |
| Dependências de tarefas | Sim | Uma tarefa com dependências só pode iniciar escrita depois que elas forem aprovadas. |
| Submissão e evidências | Sim | O executor usa `submit_task`; a entrega passa para `em_revisao`. |
| Continuação de uma tarefa após revisão | Parcial | Uma pessoa escolhe “pedir alterações” e depois libera uma nova execução. |
| Revisão independente automatizada | Não | Ainda não há papel de revisor automático nem decisão estruturada de revisão. |
| Aprovação automática e avanço de dependências | Não | `review: approve` é uma ação administrativa humana. |
| Limites de segurança | Parcial | Há limites de turnos, tempo e concorrência do runner; falta uma política por feature para ciclos de revisão. |

O runner já cria uma base útil para o modo supervisionado. A rotina atual e seus limites estão em [AUTOMACAO.md](./AUTOMACAO.md).

## Plano de implementação

### Fase 0 — Executar a prova que já existe

Use a simulação integrada para confirmar que o runner registra, reserva e executa tarefas em worktrees distintos, respeitando a dependência e a aprovação humana existente.

```powershell
yarn test:realtime
```

O teste `runner.test.ts` cria projeto, repositório e tarefas temporários, configura rotas, libera jobs, inicia adaptadores simulados e verifica que a tarefa dependente só roda após a aprovação humana simulada pelo próprio teste. Não altera os projetos nem o banco de produção.

Para testar com provedores reais, configure `PTM_REAL_CLIENTS=1`, `CODEX_BIN` e `CLAUDE_BIN` conforme [AUTOMACAO.md](./AUTOMACAO.md), confirme login e sessão dos dois clientes e então execute:

```powershell
$env:PTM_REAL_CLIENTS = '1'
$env:CODEX_BIN = 'caminho\para\codex.exe'
$env:CLAUDE_BIN = 'caminho\para\claude.exe'
yarn test:realtime
```

Esse teste usa um MongoDB replica set e repositório temporários, mas chama os provedores reais e pode consumir uso/cota. Ele testa cooperação e dependência com aprovação humana; **não** valida aprovação automática. Remova as variáveis da sessão ao terminar:

```powershell
Remove-Item Env:PTM_REAL_CLIENTS, Env:CODEX_BIN, Env:CLAUDE_BIN -ErrorAction SilentlyContinue
```

### Fase 1 — Revisão automática somente consultiva

Adicionar um job de revisão separado, iniciado após `submit_task`, com contexto imutável da tarefa, critérios de aceite, resumo, arquivos, diffs e verificações. O revisor não pode editar arquivos, liberar jobs, aprovar tarefas nem executar comandos externos.

O resultado deve ser estruturado, por exemplo:

```json
{
  "decision": "changes",
  "findings": [
    { "severity": "high", "file": "src/example.ts", "line": 42, "message": "Caso de erro não tratado" }
  ],
  "criteria": [
    { "criterion": "Valida entrada", "result": "fail", "evidence": "..." }
  ],
  "confidence": 0.82
}
```

Na primeira entrega, isso é um parecer visível no painel; a aprovação continua humana. Permite medir falso positivo, falso negativo e utilidade do revisor sem alterar o estado terminal da tarefa.

### Fase 2 — Ciclo executor → revisor → ajustes

Implementar transições explícitas e idempotentes para:

1. iniciar revisão após uma submissão;
2. registrar decisão, achados, provedor/modelo, versão exata da tarefa e diffs revisados;
3. se houver pedidos de ajuste, criar uma nova tentativa com feedback vinculado à revisão;
4. executar novamente somente dentro dos limites configurados;
5. em falha do revisor, desacordo, resultado inválido ou limite atingido, parar em `waiting_human`.

O sistema não deve converter um texto livre do modelo em uma aprovação. A resposta precisa obedecer ao schema, referenciar a submissão revisada e cumprir os critérios definidos para a política.

### Fase 3 — Avanço automático com aprovação por política

Adicionar uma política opt-in por projeto/feature, desabilitada por padrão. Campos recomendados:

```json
{
  "enabled": false,
  "mode": "review_then_approve",
  "maxReviewCycles": 2,
  "maxTasksPerFeature": 20,
  "maxConcurrent": 1,
  "maxDurationMinutes": 120,
  "requireAllChecksPassed": true,
  "requireDiffEvidence": true,
  "allowedAreas": [],
  "allowedRepositories": [],
  "autoApprovalRisk": "low_only"
}
```

Esses campos são proposta de contrato e ainda não são aceitos pela API atual. A implementação deve fazer a aprovação dentro do serviço, sob identidade própria de sistema, registrando quem configurou a política, a revisão, as evidências, os limites e a regra que autorizou a transição. O agente executor e o revisor nunca recebem credencial administrativa.

Comece com um projeto descartável e tarefas sem deploy, publicação, migração destrutiva ou acesso a segredos. Recomenda-se manter revisão humana obrigatória para mudanças de segurança, permissões, dados, dependências, CI/CD e qualquer tarefa com efeitos externos.

### Fase 4 — Painel e operação

O painel deve mostrar o ciclo completo: executor, revisor, tentativa, consumo reportado, verificações, decisão, achados, próxima ação, política aplicável e motivo de parada. Deve permitir pausar o ciclo, cancelar a automação e encaminhar para decisão humana; alterações na política devem ser auditáveis.

## Regras de parada obrigatórias

O ciclo deve parar sem nova tentativa quando ocorrer qualquer condição abaixo:

- exceder tentativas, tempo, concorrência ou limite de uso configurado;
- falhar um check obrigatório ou faltar evidência exigida;
- o revisor produzir saída inválida, confiança abaixo do limite ou conclusão ambígua;
- executor e revisor discordarem após o máximo de ciclos;
- a tarefa ou feature mudar de versão enquanto a revisão está em andamento;
- expirar lease, perder conexão durante um turno com resultado incerto ou detectar checkout divergente;
- solicitar permissão para ação externa ou encontrar instrução fora do escopo;
- a tarefa incluir operação proibida pela política.

Ao parar, guardar estado e evidências, não repetir automaticamente comandos ou publicações de resultado incerto e apresentar uma ação humana clara para retomar, cancelar ou revisar.

## Plano de teste para a futura implementação

Criar testes determinísticos com adaptadores simulados. Nenhum teste de rotina deve chamar provedores pagos ou depender da rede.

| Cenário | Resultado esperado |
|---|---|
| Feature com duas tarefas dependentes e política habilitada | Primeira tarefa roda; após revisão aprovada, a segunda é liberada sem intervenção. |
| Revisor pede ajustes uma vez | Executor recebe os achados e roda nova tentativa; revisão final aprova ou para. |
| Máximo de ciclos atingido | Ciclo pausa para humano sem liberar outra execução. |
| Dependência falha ou é cancelada | Tarefa dependente não inicia. |
| Check obrigatório ausente/falho | Sem aprovação automática; resultado encaminhado para humano. |
| Resposta malformada ou revisor indisponível | Estado seguro `waiting_human`, sem aprovação. |
| Evento ou chamada repetidos | Idempotência: uma revisão/transição por submissão e tentativa. |
| Mudança concorrente de versão | Revisão antiga não altera a tarefa atual. |
| Limite de duração/uso/concorrência atingido | Nenhum novo job é reservado. |
| Política desabilitada ou removida | Runner não avança o loop; fluxo manual continua disponível. |
| Acesso a tarefa/projeto fora da rota | Rejeição de autorização e evento de auditoria. |
| Reinício do runner durante execução | Recuperação segura ou parada para revisão; nunca duplica submissão às cegas. |

Comandos de validação previstos durante a implementação:

```powershell
yarn test:realtime
yarn test:flow
```

O primeiro cobre eventos e runner; o segundo cobre transições do serviço, autorização, idempotência e revisão. Acrescentar testes focados do orquestrador e revisão antes de habilitar qualquer piloto. A prova com provedores reais deve ser opt-in, limitada a fixtures descartáveis e executada somente depois que a simulação passar.

## Roteiro de piloto após a implementação

1. Atualize o servidor e os runners para a mesma versão; confirme backup e saúde do MongoDB replica set.
2. Crie um projeto de teste com um repositório temporário e uma feature com duas tarefas pequenas e dependentes.
3. Configure provedores, rotas e limites baixos; deixe a política em `enabled: false` enquanto confere o status.
4. Execute primeiro os testes simulados. Confirme tentativas, decisões, eventos, evidências e estados terminais.
5. Habilite a política apenas no projeto de teste e acompanhe logs, jobs, worktrees e painel até a feature parar em estado terminal.
6. Injete cenários de falha: revisão pede ajustes, check falha, timeout, limite atingido e saída inválida. Confirme que cada um para como esperado.
7. Só depois faça uma prova com provedores reais, em tarefas descartáveis e sem operações externas.
8. Compare resultados do revisor automático com decisões humanas e ajuste critérios antes de ampliar escopo.

### Rollback do piloto

Desabilite a política do projeto, pare novos despachos e aguarde ou interrompa execuções de forma supervisionada. Preserve jobs, revisões, eventos, logs e worktrees para análise. Reencaminhe tarefas pendentes para revisão humana e mantenha o fluxo manual disponível. Não apague registros para “limpar” o estado do piloto.

## Critério para considerar pronto

O loop só está pronto para uso contínuo quando os testes simulados cobrem todos os cenários de parada, decisões são auditáveis e idempotentes, o revisor não possui poderes de escrita/aprovação, reinícios não duplicam trabalho, limites são aplicados no servidor e existe rollback testado. A aprovação autônoma deve ser habilitada por política explícita e inicialmente limitada a tarefas de baixo risco.
