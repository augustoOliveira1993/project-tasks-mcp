# Tarefas de backend

Use uma tarefa `backend` quando o trabalho altera API, regras de negócio, persistência, validação, autorização, jobs ou contrato de integração.

## Cadastro no MCP

A tarefa deve apontar para o repositório `fbi_back` e usar `area: "backend"`. Ela não depende de uma tarefa de frontend.

Inclua nas instruções:

- endpoints, comandos ou eventos a implementar;
- regras de negócio e validações;
- formato de entrada e resposta;
- impacto em banco de dados ou migrações;
- verificações focadas esperadas.

## Prompt para o chat

```text
Use o MCP project_tasks. Localize o projeto FBI e a feature PCP — Outros Processos.

Crie uma tarefa backend no repositório fbi_back para implementar <objetivo>.
Inclua endpoints, regras de negócio, validações e critérios de aceite.
A tarefa não possui dependências.
Mostre o plano antes de criar a tarefa.
```

## Execução

1. Use `get_task_context` antes de editar o `fbi_back`.
2. Assuma a tarefa com `claim_task`.
3. Registre progresso relevante.
4. Execute verificações focadas.
5. Use `submit_task` com resumo, arquivos, verificações, evidências, branch, commit e PR quando existirem.

A pessoa revisora aprova pela CLI. Depois da aprovação, tarefas de frontend que dependem dela ficam disponíveis.

Quando o checkout estiver vinculado por Git, publique a evidência técnica com `publish_task_diff`. Inclua patch somente quando a revisão precisar dele; commits e arquivos são sempre suficientes para rastreabilidade básica.
