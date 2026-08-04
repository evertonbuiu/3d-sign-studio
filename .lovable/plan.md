# 3D Sign Maker PRO

Editor paramétrico de letras e placas 3D, inspirado no Letra Maker: escolher um estilo em card, digitar o texto, ajustar medidas e exportar STL. Interface clara industrial (cinza-azulado claro + azul #3b82f6), toda em português do Brasil.

## Tela principal (uma única área de trabalho)

```text
+--------------------------------------------------------------+
| Novo  Abrir  Salvar  Exportar  Orçamento            [usuário] |
+-------------+-----------------------------+------------------+
| Biblioteca  |                             | Propriedades     |
| de estilos  |     Visualização 3D         | - Texto/Fonte    |
| (cards com  |     (tempo real)            | - Altura/Larg.   |
| miniatura)  |                             | - Profundidade   |
|             |                             | - Espessuras     |
|             |                             | - Cores/LED      |
+-------------+-----------------------------+------------------+
| Medidas  |  Peso  |  Filamento (m/g)  |  Custo estimado      |
+--------------------------------------------------------------+
```

- Biblioteca lateral esquerda com os 26 estilos pedidos, agrupados por família (Acrílico/Impresso, Iluminação, Letras, Placas/Totem, Logotipo), cada um em card com miniatura ilustrada e busca por nome.
- Clicar em um card carrega um preset completo de parâmetros; o painel direito permite ajuste fino sem precisar reconfigurar nada.
- Painel inferior recalcula em tempo real: medidas totais, volume, peso, consumo de filamento e custo (material + energia + mão de obra + margem, com valores configuráveis).

## Geometria e visualização 3D

- Visualização com Three.js (react-three-fiber) carregada apenas no navegador, com órbita, grade de referência, sombras suaves e alternância entre vista sólida / explodida / wireframe.
- O texto é convertido em contornos vetoriais a partir de uma fonte e extrudado; a partir desses contornos o gerador cria as peças conforme o estilo:
  frente, fundo, laterais (com offset de parede), difusor, tampa, canal de LED (rebaixo interno seguindo o contorno), encaixes/travas, furos de fixação e guias de montagem.
- Cada estilo define quais peças existem e com quais parâmetros (espessura de parede, folga de encaixe, altura do canal, recuo do difusor, camadas para dupla/tripla camada, etc.). Tudo paramétrico: alterar qualquer campo regenera a cena imediatamente.
- Lista de peças com visibilidade individual e destaque ao passar o mouse.

## Exportar

- Exportação STL (binário) das peças geradas: peça única, todas separadas em um .zip, ou todas mescladas.
- Orçamento abre um resumo com medidas, peso, filamento e custo, imprimível pelo navegador.

## Contas e projetos salvos (Lovable Cloud)

- Login por e-mail/senha e Google, página `/auth` pública; editor protegido.
- Tabela `projects` com nome, estilo, parâmetros (JSON), data de atualização, protegida por RLS por usuário.
- "Salvar" grava/atualiza o projeto atual; "Abrir" lista os projetos do usuário; "Novo" limpa para o preset padrão.

## Detalhes técnicos

- Rotas: `/` (landing curta + entrar), `/auth`, `/_authenticated/editor`. Metadados `head()` próprios por rota.
- Estado do editor em um store React (contexto + reducer) com o modelo paramétrico como fonte única da verdade; geração de geometria memoizada e com debounce leve.
- Three.js/react-three-fiber importados dinamicamente atrás de `ClientOnly` para não quebrar o SSR; exportador STL rodando no cliente.
- Tokens de cor/tipografia definidos em `src/styles.css` (paleta clara industrial, azul de destaque), sem cores fixas nos componentes.
- Miniaturas dos cards geradas como ilustrações SVG paramétricas (leves, sem depender de imagens externas).

## Fora do escopo desta versão

- Corte 2D (SVG/DXF), PDF de orçamento e exportação de imagem do preview — podem entrar depois.
