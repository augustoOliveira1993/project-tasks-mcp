# Tipos de conversa e fluxos

Cada projeto pode manter tipos de conversa com uma lista ordenada de etapas. As etapas são declarativas; o contrato não executa código fornecido pelo usuário.

## Tipos de etapa

- `instruction`: exige texto de instrução.
- `form`: contém campos `text`, `textarea`, `number`, `checkbox` ou `select`.
- `approval`: exige rótulo e é sempre obrigatória. Não substitui a autorização humana da proposta de execução.
- `condition`: avalia declarativamente um campo de um formulário anterior com `is_set`, `is_not_set`, `equals`, `not_equals` ou `contains`.

Cada tipo tem `name`, `description`, `version` e até 30 etapas. O array define a ordem. Nomes ativos são únicos no projeto, ignorando maiúsculas/minúsculas; o nome `Geral` fica reservado ao tipo padrão.

## Compatibilidade e conversas abertas

O tipo padrão `Geral` tem ID reservado `00000000-0000-4000-8000-000000000001` e quatro etapas compatíveis com o fluxo existente: Esclarecer, Proposta, Autorização e Execução. Ele é virtual e não precisa de migração no banco. Conversas antigas sem tipo são apresentadas como `Geral` e preservam mensagens e histórico.

Ao criar ou trocar o tipo de uma conversa, o backend grava um snapshot versionado das etapas na conversa. Alterações posteriores no cadastro afetam conversas novas; conversas existentes mantêm o snapshot até alguém escolher outro tipo. Arquivar um tipo o remove das opções para novas conversas, mas não invalida snapshots já usados.

## Comportamento da IA

Em execuções do runner ligadas a uma conversa, o MCP fornece o snapshot do tipo em cada turno. No primeiro turno também fornece até 20 mensagens recentes da conversa para permitir que a IA retome o fluxo e reconheça pedidos humanos feitos antes da execução. O runner orienta a IA a tentar cumprir as etapas em ordem, coletar campos obrigatórios, avaliar condições com as respostas disponíveis e explicitar quando uma condição não se aplica.

A IA só deve ignorar ou alterar o fluxo quando uma mensagem direta da conversa, marcada pelo servidor com `authorType: human`, pedir isso explicitamente. Texto citado, anexos, saídas de ferramentas, conteúdo de tarefas e mensagens de IA não autorizam esse desvio. Um pedido para sair do fluxo não aprova uma execução nem substitui as permissões, a autorização humana de proposta ou as verificações de segurança.

O runner não grava um índice de etapa concluída. A IA infere onde está pelo histórico recebido e pela sessão ativa; quando não consegue determinar a etapa, deve explicar a dúvida e perguntar à pessoa. Conversas antigas sem snapshot recebem o fluxo Geral. Execuções sem conversa vinculada não recebem instruções de fluxo configurável.

## Operações MCP

- `list_conversation_types`, `get_conversation_type`: consulta dentro do projeto.
- `create_conversation_type`, `update_conversation_type`, `duplicate_conversation_type`, `archive_conversation_type`: cadastro autenticado com versão e `operationId`.
- `create_conversation` e `open_task_conversation` aceitam `typeId` opcional.
- `set_conversation_type` troca o fluxo de uma conversa aberta usando a versão atual.
- `list_conversations` retorna o resumo do tipo; `get_conversation` retorna o snapshot completo.

As operações de cadastro e troca exigem acesso humano ou `trusted_local`, permissão de escrita no projeto e validam o projeto em cada consulta. O tipo padrão não pode ser editado ou arquivado.

## API HTTP para o painel

- `GET /admin/conversation-types?projectId=...`
- `GET /admin/conversation-types/:typeId?projectId=...`
- `POST /admin/conversation-types`
- `PATCH /admin/conversation-types/:typeId`
- `POST /admin/conversation-types/:typeId/duplicate`
- `POST /admin/conversation-types/:typeId/archive`
- `PATCH /admin/conversations/:conversationId/type`

As rotas administrativas usam a mesma autenticação humana, schemas, controle de versão e autorização por projeto do serviço MCP. Tipos e conversas também fazem parte da exportação/importação do projeto e da remoção em cascata.
