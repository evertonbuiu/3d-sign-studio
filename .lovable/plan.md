# Controle de curvatura da frente Neon Flex

## Implementação
- Adicionar o parâmetro **Curvatura da frente** ao modelo do projeto, com valor padrão e validação para salvamento/carregamento.
- Exibir um controle numérico e deslizante somente no estilo **Neon Flex — Frente Impressa Curva**.
- Aplicar o valor diretamente ao arredondamento da geometria: valores baixos deixam a frente mais plana; valores altos deixam o topo mais curvo.
- Limitar automaticamente a curvatura às dimensões válidas da frente e da faixa de neon, evitando malhas inválidas.

## Verificação
- Confirmar que o controle atualiza a visualização 3D imediatamente.
- Validar os limites mínimo e máximo, o salvamento do parâmetro e a ausência de erros na prévia.
