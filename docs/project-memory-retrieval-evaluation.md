# Avaliação da busca de memórias de projeto

## Como reproduzir

Execute os dois testes focados:

```powershell
yarn node --import tsx --test test/project-memory-context-evaluation.test.ts test/project-memory-evaluation.test.ts
```

Os testes iniciam um replica set MongoDB temporário e usam fixtures sintéticas. O teste comparativo cria uma coleção com o índice legado `mongo-text-v1` e mede as mesmas consultas contra ele e contra `searchProjectMemories`. Também inicia a aplicação com um índice legado na coleção principal para conferir a migração para o índice novo. Nenhum provedor externo de IA é chamado e nenhuma resposta é gerada.

O conjunto original [project-memory-evaluation.v1.ts](../test/fixtures/project-memory-evaluation.v1.ts), versão `1.0.0`, contém 20 consultas diretas em cinco áreas. Seu resultado histórico de `mongo-text-v1` foi 20/20 em Hit@5. Esse conjunto simples continua útil para detectar regressão, mas não mede cobertura de buscas por título de fonte ou paráfrases.

O conjunto comparativo [project-memory-evaluation.v2.ts](../test/fixtures/project-memory-evaluation.v2.ts), versão `2.0.0`, contém 50 consultas: 20 diretas, 20 que citam o título da tarefa-fonte, 8 paráfrases, uma consulta ambígua por categoria e uma consulta sem correspondência. Cada consulta positiva aponta para a memória relevante e sua fonte/revisão esperadas. O conteúdo é sintético, seguro para testes e não contém conversas ou dados privados.

## Comparação local

Medida em 2026-10-10 no mesmo processo MongoDB temporário. O legado indexa título (peso 5) e conteúdo (peso 1). `mongo-text-context-v2` indexa título (5), categoria (2), títulos de fontes verificadas (2) e conteúdo (1). Ambas as versões usam somente memórias ativas e limite de cinco resultados.

| Métrica | `mongo-text-v1` | `mongo-text-context-v2` |
| --- | ---: | ---: |
| Hit@5 geral, entre 49 consultas positivas | 37/49 (75,5%) | 48/49 (98,0%) |
| MRR geral | 0,5969 | 0,9354 |
| Hit@5 em fonte + paráfrase | 17/28 (60,7%) | 27/28 (96,4%) |
| MRR em fonte + paráfrase | 0,3482 | 0,9048 |
| Consultas pelo título da fonte | 13/20 (65%) | 20/20 (100%) |
| Paráfrases | 4/8 (50%) | 7/8 (87,5%) |
| Referências esperadas cobertas | 37/49 (75,5%) | 48/49 (98,0%) |
| Falsos positivos na consulta sem correspondência | 0/1 | 0/1 |
| Bytes médios da resposta de busca, todas as consultas | 1.582 | 1.984 |
| Latência média / p95 | 2,55 / 3,45 ms | 2,80 / 3,63 ms |

A melhora de MRR no conjunto de fonte + paráfrase foi de 0,3482 para 0,9048; o Hit@5 geral subiu 22,4 pontos percentuais. A resposta ficou, em média, cerca de 402 bytes maior e a latência local aumentou cerca de 0,25 ms. O maior resultado observado foi 2.505 bytes, bem abaixo do orçamento de contexto da tarefa.

## Interpretação e limites

Hit@5 mede se alguma memória rotulada como relevante aparece entre os cinco primeiros resultados; MRR também considera a posição. Cobertura de fonte verifica se a memória recuperada carrega a referência e a revisão esperadas. O tamanho é o JSON da resposta de busca, não o prompt inteiro do modelo.

Esta mudança melhora recuperação lexical contextualizada; não adiciona busca por embeddings. As consultas pelo título usam o título da fonte verificada como contexto, e as paráfrases são um conjunto pequeno escrito para o teste. Uma paráfrase, `paraphrase-markdown`, continua sem resultado esperado. A avaliação não mede verdade nem qualidade de respostas geradas, e seus resultados sintéticos não garantem a mesma qualidade em dados de produção. Uma próxima etapa semântica deve começar com consultas reais anonimizadas e uma comparação independente antes de introduzir um provedor de embeddings.

O índice textual do MongoDB não pode ser alterado em lugar: a inicialização identifica a configuração legada, remove apenas o índice `project_memory_text` incompatível e deixa o Mongoose recriar a definição versionada. Dados e demais índices permanecem intactos. Latência varia com hardware e versão do MongoDB e não é uma meta de produção. `rank` expressa ordem de relevância, nunca probabilidade de verdade; ausência de resultado também não prova que uma informação inexiste.
