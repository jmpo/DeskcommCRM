---
impacto: capacidade_nova
secao: adicionado
titulo: A tela de Dados externos passa a conectar bancos MySQL
---
Ao criar uma conexão em Dados externos, agora você escolhe na tela se o banco é PostgreSQL ou MySQL, e ao escolher MySQL a porta já vem como 3306. Quando o teste da conexão encontra algo a saber sobre o usuário do banco (que ele pode escrever, ou que lê o banco inteiro), o aviso aparece em amarelo, separado do erro, no cartão da conexão. Com MySQL escolhido, a janela traz um guia rápido com os comandos prontos para copiar: criar um usuário só de leitura e liberar somente uma view com o que o assistente deve ver. O tipo do banco não muda depois de criado; para trocar, apague a conexão e crie outra. Nada a fazer na atualização.

Desenho e código de @paulolimajr77 (Spec 23, a tela, #2639).
