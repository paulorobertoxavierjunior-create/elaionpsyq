
# Elayon PSI-Q

Escuta simbólica assistida, sigilosa e orientada por ética — coleta local, revisão do psicólogo e metadados para gestão quando necessário.

Uma ferramenta simples e prática para **escuta simbólica** com foco humanitário, preservando o **sigilo** e a **responsabilidade técnica**.

## Como funciona (fluxo)
1) **Coleta (Facilitador / Responsável Técnico local)**
- Abre o app, lê as regras de sigilo com a pessoa.
- Inicia uma sessão breve (até 2 minutos).
- O app mostra barras de presença durante a fala (treino de estabilidade e continuidade).
- Ao finalizar, o app salva a sessão **com áudio** no próprio dispositivo.

2) **Revisão (Psicólogo Responsável)**
- Acessa a página do psicólogo.
- Vê a lista de sessões coletadas, pode **ouvir o áudio**, registrar observações e decidir a conduta.
- Se julgar necessário, gera um **relatório anonimizador (somente metadados)** para apoio institucional.

3) **Acompanhamento (Secretaria / Equipe)**
- Recebe apenas o relatório anonimizador (JSON).
- Visualiza indicadores gerais sem identificar pessoa e sem áudio.

## Sigilo e ética
- O app foi projetado para **minimizar exposição**: a coleta fica local; o envio externo é decisão do psicólogo.
- O relatório para secretaria **não contém nome, não contém áudio**, apenas metadados.

## GitHub Pages
Ative em: Settings → Pages → Deploy from branch → **main** / **root**.

Arquivos:
- `index.html` (coleta)
- `psicologo.html` (revisão + export anon.)
- `secretaria.html` (visualização de relatório anon.)
