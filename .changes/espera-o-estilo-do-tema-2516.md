---
impacto: nada_mudou
secao: corrigido
titulo: Teste da paleta da Agenda espera o estilo do tema, não só o atributo
---

O caso que confere os números de cor afirmados na vitrine da Agenda podia medir a cor do tema claro logo depois de trocar para o escuro — o atributo do tema virava antes de o estilo aplicar, e o teste ficava intermitente (uma vez em 258 rodadas). Agora ele espera o estilo medido mudar de verdade antes de medir, e confere a tela pronta após o carregamento extra. A régua não mudou: a tolerância continua a mesma.

Contribuição de @Tong-bit-art (#2859), a partir da issue #2516.
