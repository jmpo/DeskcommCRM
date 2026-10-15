---
impacto: nada_mudou
secao: corrigido
titulo: A aba vizinha recarrega uma vez só ao sair do acompanhamento
---
Ao encerrar um acompanhamento de suporte, a aba vizinha recarregava duas vezes: a recarga disparada pelo aviso entre abas abria um documento que, sem carimbo próprio, caía na comparação de relógio e recarregava de novo — uma diferença de menos de um milissegundo entre o início do documento e o carimbo não dá para separar com `Date.now()`. Agora a aba marca, em sessionStorage, qual aviso ela já tratou, e o documento seguinte nasce sabendo que a recarga já aconteceu. Quem encerra o acompanhamento continua sem recarregar a própria aba, e um acompanhamento encerrado mais tarde ainda recarrega a vizinha uma vez.
