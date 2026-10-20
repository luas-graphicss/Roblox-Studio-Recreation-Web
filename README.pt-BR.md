# Roblox Studio Web

[Read in English](README.md)

O Roblox Studio Web é uma recriação do Roblox Studio que roda no navegador. Tem o explorer, o painel de propriedades, o viewport 3D, o editor de scripts e a saída, e a ideia é que qualquer pessoa que já usou o Studio de verdade se sinta em casa, sem precisar instalar nada.

O projeto vai bem além da interface. Tem um modelo de dados com serviços e instâncias, uma máquina virtual de Luau que executa os scripts dentro da página, motor de física, terreno, avatares, animação, áudio e um sistema de iluminação grande, com materiais em camadas, suporte a muitas luzes dinâmicas e pós processamento cinematográfico. O editor de scripts usa o Monaco e o viewport usa o three.js. Em volta disso tem depurador, console de desenvolvedor, plugins, pacotes, colaboração no estilo Team Create com rascunhos e histórico de versões, publicação pelo Open Cloud e um assistente de IA para código que guarda as chaves de API num cofre local e remove segredos antes de enviar qualquer coisa.

É um projeto independente e não tem nenhuma ligação com a Roblox Corporation.

## Como usar

Você precisa do Node.js 18 ou mais novo. Clone o repositório, rode npm install e depois npm run dev, e abra o endereço que o Vite mostrar no terminal, normalmente localhost na porta 5173. Para gerar a versão de produção rode npm run build, e o npm run preview serve essa versão localmente. O arquivo index.html também pode ser aberto sozinho como uma página estática.

Também existem alguns scripts de segurança. O npm run security:integrity recalcula os hashes de integridade dos arquivos de terceiros e o npm run security:audit verifica as dependências.

## Tempo de desenvolvimento

O projeto levou cerca de seis meses até aqui e ainda está em desenvolvimento, então algumas funções ainda faltam e as mudanças são frequentes.

## Licença

GNU General Public License versão 3. O texto completo está no arquivo LICENSE.
