# 3D Sign Studio

Crie um aplicativo chamado "3D Sign Maker PRO" inspirado na experiência de uso do Letra Maker.

O aplicativo deve possuir uma interface semelhante ao Letra Maker, com fluxo simples e intuitivo, utilizando uma biblioteca visual de estilos onde o usuário escolhe um modelo através de miniaturas (cards) em vez de configurar tudo manualmente.

Ao selecionar um estilo, todas as configurações técnicas devem ser carregadas automaticamente, permitindo apenas ajustes finos.

Cada estilo deve possuir uma pré-visualização 3D em tempo real.

A experiência deve ser focada em poucos cliques: selecionar o estilo, digitar o texto, ajustar medidas e exportar o projeto.

A interface deve conter:

- Biblioteca de estilos em cards com miniaturas.

- Barra lateral de propriedades.

- Visualização 3D central em tempo real.

- Barra superior com Novo, Abrir, Salvar, Exportar e Orçamento.

- Painel inferior com medidas, peso, consumo de filamento e custo estimado.

- Interface moderna inspirada em softwares CAD, porém muito mais simples e amigável.

## Biblioteca de estilos (como o Letra Maker)

Cada estilo deve aparecer como um card ilustrado.

Exemplos:

• Fundo Impresso + Tampa Acrílica

• Fundo Impresso + Frente Acrílica

• Fundo Acrílico + Frente Acrílica

• Fundo Acrílico + Frente Impressa

• Frente PETG

• Frente Acrílico Leitoso

• Face Lit

• Halo Light

• Back Light

• Front Light

• Front + Back Light

• Edge Lit

• Caixa sem iluminação

• Caixa iluminada

• Letras Maciças

• Letras Ocas

• Letras Vazadas

• Letras Dupla Camada

• Letras Tripla Camada

• Neon Flex

• Neon LED

• Placa Decorativa

• Placa ACM

• Totem

• Logotipo 3D

• Logo Multicamadas

Ao clicar em qualquer card, o software deve gerar automaticamente todas as peças necessárias:

- Frente

- Fundo

- Laterais

- Difusor

- Tampa

- Canal para LED

- Encaixes

- Furos

- Travas

- Guias de montagem

Tudo deve ser paramétrico e editável.

A visualização 3D deve atualizar instantaneamente a cada alteração.

O aplicativo deve ter aparência profissional, semelhante ao Letra Maker, mas oferecendo muito mais recursos para empresas de comunicação visual e impressão 3D.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/ef71fff6-2c07-45fa-af40-f0bc17fc860b).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
