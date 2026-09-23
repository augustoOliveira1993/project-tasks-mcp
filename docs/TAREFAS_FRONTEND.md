# Tarefas de frontend

Use uma tarefa `frontend` quando o trabalho altera telas, componentes, formulários, estados de interface, rotas, acessibilidade ou consumo de API.

## Cadastro no MCP

A tarefa deve apontar para o repositório `fbi_front` e usar `area: "frontend"`. Quando consumir uma API ou contrato novo, adicione o ID da tarefa backend aprovada em `dependencies`.

Inclua nas instruções:

- tela, rota ou componente a implementar;
- campos, ações e regras de apresentação;
- contrato de API que será consumido;
- estados de carregamento, vazio, sucesso e erro;
- verificações focadas esperadas.

## Prompt para o chat

```text
Use o MCP project_tasks. Localize o projeto FBI e a feature PCP — Outros Processos.

Crie uma tarefa frontend no repositório fbi_front para implementar <objetivo>.
A tela deve consumir o contrato da tarefa backend <id-da-tarefa-backend>.
Defina essa tarefa como dependência e inclua critérios para carregamento, sucesso e erro.
Mostre o plano antes de criar a tarefa.
```

## Execução

1. Aguarde a aprovação humana da tarefa backend.
2. Use `list_pending` com `area: "frontend"`.
3. Assuma a tarefa e chame `get_task_context` antes de editar o `fbi_front`.
4. O contexto contém critérios, instruções e evidências do backend aprovado.
5. Implemente, registre progresso e use `submit_task` com arquivos, verificações e evidências.

Não altere `fbi_back` a partir de uma tarefa frontend. Se o contrato precisar mudar, crie ou ajuste uma tarefa backend separada.

Ao receber um contrato ou diff do backend, consulte `get_project_novelties` ou a bridge `status` antes de iniciar a implementação. O vínculo Git facilita seleção de contexto, mas não permite alterar a tarefa ou repositório de outra área.
