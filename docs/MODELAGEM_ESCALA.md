# Modelagem e escala incremental

## Limite entre persistência e serviços

Os schemas Mongoose ficam centralizados em `src/models.ts`; `src/db.ts` mantém a conexão, inicializa índices e reexporta os modelos para compatibilidade. Cada serviço de contexto, dependências, automação, exclusão e conversa fica em arquivo próprio sob `src/services/`. `src/service.ts` continua como fachada que valida, autoriza e coordena as operações MCP.

## Contexto enviado à IA

`get_task_context` retorna `TaskContextDto`, limitado a 128 KiB. Critérios de aceite mantêm seus índices e são truncados por item; mensagens, execuções e metadados de Markdown têm limites próprios. `contextMeta.truncatedFields` indica o que deve ser carregado por ferramentas de detalhe/paginação. A resposta não inclui hash de token, membros, fences, credenciais ou payloads arbitrários de execução. `get_record` também projeta projetos sem esses campos internos.

## Dependências e migração

`Task.dependencies` continua sendo a fonte compatível com as versões atuais. Escritas de tarefa atualizam a coleção indexada `TaskDependency` na mesma transação. A validação percorre apenas ancestrais acessíveis e reconcilia as arestas antigas encontradas nesse trecho; o índice composto atende a consulta por projeto e tarefa.

Para backfill completo, com MongoDB conectado e `MONGODB_URI` configurada:

```powershell
yarn cli -- backfill-task-dependencies
```

Opcionalmente, informe o tamanho do lote entre 1 e 1000. A saída informa tarefas examinadas, arestas esperadas, arestas persistidas e se as contagens conferem. O comando pode ser repetido. Antes do corte, compare a saída e os totais no banco; rode novamente se houve escrita concorrente durante o backfill.

O rollback da aplicação permanece compatível porque as versões anteriores ignoram `TaskDependency` e continuam lendo `Task.dependencies`. Não remova a coleção na reversão. Índices são aditivos e inicializados na conexão.

## Cursores e observabilidade

Listas temporais novas usam cursor opaco vinculado ao filtro, com ordenação por data e ID. UUIDs antigos continuam aceitos: listas de registros mantêm sua ordenação anterior por ID, e o histórico preserva a posição temporal indicada pelo evento legado. Cursores novos não podem ser reutilizados com outro filtro.

Logs de diagnóstico registram nome da operação/coleção, quantidade de linhas ou arestas, bytes do contexto e duração, sem gravar conteúdo das mensagens, instruções ou resultados.

## Conversas e propostas de execução

`Conversation`, `ConversationMessage` e `ActionProposal` ficam em coleções separadas. Mensagens são append-only e idempotentes por credencial/operação. Uma conversa pode começar sem tarefa; a tarefa proposta fica visível para avaliação e só é vinculada à conversa depois da aprovação humana. A aprovação confere a versão atual, grava a autorização e cria o job de automação; alterações concorrentes tornam a proposta obsoleta. O painel consulta páginas recentes de conversas/mensagens, carrega histórico antigo sob demanda e atualiza o estado do job sem reler páginas históricas. A aprovação exige automação e provider configurados no projeto.

Mensagens, propostas, documentos, jobs e eventos ligados a uma tarefa acompanham a tarefa em uma transferência entre projetos, dentro da mesma transação. Exclusão de tarefa desvincula a conversa e torna propostas pendentes obsoletas; exclusão do projeto remove os dados subordinados pela cascata existente.

O fence do projeto agora é usado pelas mudanças que afetam invariantes do grafo. O contador global de eventos do projeto ainda é atualizado para publicar cursores duráveis e segue como ponto de contenção para projetos com alto volume simultâneo. Particionar esse feed requer evolução de cursor compatível e deve ser guiada por medição de produção.
