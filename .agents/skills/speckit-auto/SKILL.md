---
name: speckit-auto
description: Planeja uma funcionalidade com Spec Kit e mantém especificação, plano e tarefas nos documentos da feature no MCP project_tasks.
---

# Spec Kit Auto — orquestrador global

Quando o usuário invocar esta skill, conduza o fluxo de especificação solicitado e persista os artefatos na feature correspondente do Project Tasks MCP.

## Regra de armazenamento
- Especificações e artefatos de planejamento ficam como documentos Markdown vinculados à feature no banco do MCP. Mantenha o conteúdo em memória até gravá-lo com as ferramentas MCP; não crie cópias em `specs/`, `.specify/` ou outra pasta do repositório trabalhado.
- Não execute `specify init` nem comandos/skills que escrevam artefatos Spec Kit no workspace. Use as skills disponíveis como orientação e produza o conteúdo sem efeito de escrita local.
- Arquivos de implementação, testes e demais mudanças de código continuam no checkout. Não migre nem apague arquivos Spec Kit que já existam, salvo pedido explícito.
- Se o MCP, a feature ou as ferramentas para ler/gravar documentos não estiverem disponíveis, pare e informe o bloqueio. Não volte silenciosamente a gravar especificações no workspace.
- Use documentos da feature (`save_markdown`), não memórias resumidas do projeto, para guardar o conteúdo completo dos artefatos.
- Esses documentos ficam vinculados ao cadastro da feature e aparecem no detalhe em **Documentos e especificações**. Não gere anexos binários duplicados para a feature; o Markdown versionado no MCP é o registro canônico.

## Gate obrigatório antes de criar tarefas
- Não chame `create_task` antes de salvar e confirmar no MCP os documentos SDD aplicáveis da feature, no mínimo `spec.md`, `plan.md` e `tasks.md`. Use `featureId` na tarefa e siga o conteúdo da revisão de `tasks.md` que acabou de ler.
- A descrição/instruções da tarefa devem explicar o trabalho e citar nomes, IDs e revisões dos documentos MCP. Não use `specs/.../tasks.md` nem qualquer caminho local como origem ou substituto de conteúdo/anexo.
- Depois que cada tarefa for criada, monte em memória um `sdd-context.md` específico com nome/ID da tarefa, escopo, critérios de aceite, dependências e nomes/IDs/revisões dos documentos SDD da feature. Envie o Markdown real à tarefa com `upload_task_attachment` (`contentType: text/markdown; charset=utf-8`, Base64 codificado em memória, sem arquivo temporário). Esse anexo deve aparecer em **Arquivos**; salvar somente um Markdown task-scoped não substitui o upload.
- Confira a resposta do upload. Se a tarefa foi criada mas o upload falhou, informe sincronização parcial, preserve o ID da tarefa e retome o anexo nessa tarefa; nunca repita `create_task` para corrigir uma falha de anexo.
- Para sincronizações repetidas, localize tarefas/anexos existentes e reconcilie por ID. Compare o anexo existente antes de decidir se precisa enviar uma nova revisão; não crie duplicatas cegamente.

## Pré-verificações
1. Identifique a raiz do repositório e verifique `git status`. Nunca descarte alterações existentes.
2. Verifique quais skills Spec Kit e ferramentas MCP estão realmente disponíveis. Não exija o CLI `specify` se o conteúdo puder ser produzido com as capacidades disponíveis.
3. Descubra no MCP `project_tasks` os fluxos reais para resolver projeto, localizar/criar feature e listar, ler, criar ou atualizar documentos Markdown. Nunca presuma ferramentas, argumentos, URL ou autenticação.
4. Resolva o projeto indicado pelo usuário ou pelo workspace. Localize a feature com `list_records` e pesquise documentos existentes com `list_markdowns`; reutilize uma correspondência única. Se houver ambiguidade, pergunte. Crie uma feature somente quando o pedido do usuário autorizar e não houver uma correspondente.

## Execução
1. Leia as instruções e convenções existentes do projeto. Se for necessário um rascunho de constituição para esta feature, mantenha-o em memória e salve-o como documento da feature.
2. Gere em memória os artefatos necessários, usando as skills `speckit-specify`, `speckit-plan` e `speckit-tasks` como orientação. Considere `spec.md`, `plan.md`, `tasks.md`, `research.md`, `data-model.md`, `quickstart.md`, `checklists/requirements.md` e cada contrato. Não crie placeholders para artefatos que não se aplicam.
3. Salve cada artefato como documento da feature com nome estável que preserve o caminho lógico, por exemplo `checklists/requirements.md` e `contracts/api-access-routes-catalog.yaml.md`. O MCP exige nomes terminados em `.md`; para YAML, JSON ou outro conteúdo não Markdown, mantenha o conteúdo original em um bloco de código com a linguagem correta e indique o caminho/nome original no título.
4. Cada documento aceita até 100 KiB. Divida artefatos maiores em partes nomeadas e referenciadas entre si. Antes de criar, confira os nomes já existentes. Para atualizar, leia o conteúdo e a revisão atual com `get_markdown` (pagine por `line`/`limit` quando necessário) e use `update_markdown` com `baseRevision`; em conflito, releia e resolva antes de tentar novamente. Não crie duplicatas. Se uma gravação falhar após outras terem sido salvas, informe exatamente quais documentos foram salvos e quais falharam; não afirme conclusão nem volte a gravar esses conteúdos em arquivos locais.
5. Leia a revisão persistida de `tasks.md` e compare seus itens com os registros MCP da feature. Uma solicitação clara para criar uma tarefa autoriza essa tarefa; antes de criar ou alterar várias tarefas remotas, mostre um resumo e obtenha autorização. Salve/atualize todos os documentos SDD aplicáveis antes de qualquer `create_task`, vincule a tarefa à feature e aplique o gate de anexo acima. Preserve IDs e dependências; reporte falhas parciais sem afirmar sincronização completa.
6. Para implementar, leia no MCP os documentos da feature relevantes e execute as tarefas na ordem das dependências. Grave no checkout apenas arquivos de implementação, testes e mudanças de código solicitadas; atualize o documento `tasks.md` no MCP e os registros de tarefa após obter evidência. Não marque trabalho incompleto como concluído.
7. Execute validações apropriadas quando autorizadas e disponíveis; não declare sucesso sem evidências.

## Regras de autonomia
- Execute fases sequenciais sem pedir que o usuário invoque cada comando.
- Evite perguntas desnecessárias, mas solicite confirmação para ações destrutivas, mudanças sensíveis e operações remotas em massa.
- A solicitação explícita de especificar uma feature autoriza salvar os artefatos dessa feature no MCP. Isso não autoriza criar tarefas remotas em massa, nem commits, push, deploy ou apagar documentos/arquivos existentes.
- Não crie commits, faça push ou deploy sem pedido explícito.
- Não use nomes fictícios de ferramentas do MCP.
- Ao terminar, informe arquivos alterados, tarefas sincronizadas, validações e pendências.
