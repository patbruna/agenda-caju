# Módulo de Gestão de Colaboradores

Acrescentado à aplicação existente (agenda de entrevistas) sem alterar nada do que
já funcionava: a agenda continua em `index.html`, com o mesmo banco, o mesmo login e
o mesmo comportamento. A única mudança nela foram dois links de navegação.

## Arquivos

| Arquivo | O que é |
|---|---|
| `colaboradores.html` | A tela do módulo. Mesmos tokens visuais da agenda. |
| `colaboradores.js` | Tela e integração com o Supabase. Não contém regra de negócio. |
| `colaboradores-core.js` | **As regras.** Datas, contrato de experiência, CPF, telefone, aniversário, folga, leitura de planilha, notificações. Não toca no DOM nem no banco. |
| `colaboradores-testes.html` | Suíte de testes das regras. Abre no navegador, sem banco e sem login. |
| `supabase/07-colaboradores.sql` | Tabelas, políticas de acesso, funções de gravação e auditoria. |

A separação entre `core` e o resto não é enfeite: é o que permite conferir as contas de
dia sem subir banco. Se mudar uma regra, mude em `colaboradores-core.js` e rode os testes.

## Instalação

1. **Banco.** No painel do Supabase → SQL Editor → New query → cole todo o
   `supabase/07-colaboradores.sql` → Run. Pode rodar mais de uma vez.
   Rode depois do `01-estrutura.sql` e do `02-seguranca.sql`.

2. **Liberar acesso.** Ninguém entra no módulo sem perfil, nem quem já usa a agenda.
   O arquivo já libera `brunapatricio@cajupar.com` como administrador e
   `victorgutierres@cajupar.com` como RH. Para os demais:

   ```sql
   insert into public.colab_perfis (user_id, email, perfil, unidade)
   select id, email, 'gestor', 'NAZO SUL'
   from auth.users where email = 'pessoa@cajupar.com'
   on conflict (user_id) do update
     set perfil = excluded.perfil, unidade = excluded.unidade;
   ```

3. **Publicar.** Os arquivos são estáticos: subir para o repositório já publica no Vercel.

4. **Configurar.** Na aba **Configurações**, preencher nome da empresa, cidade,
   responsável e cargo. Sem isso o Termo de Encerramento sai com lacunas.

5. **Importar.** Aba **Importar** → escolher a planilha → conferir → gravar.

## Perfis

| Perfil | Vê | Pode |
|---|---|---|
| **admin** | tudo, CPF completo e nome da mãe | tudo, inclusive excluir e configurar |
| **rh** | tudo, CPF completo e nome da mãe | importar, cadastrar, decidir, gerar documentos, exportar |
| **gestor** | só a sua unidade; **CPF mascarado, nome da mãe oculto** | decidir contrato, tratar folga, atualizar telefone e e-mail |
| **consulta** | só a sua unidade; **CPF mascarado, nome da mãe oculto** | apenas consultar |

## Como a proteção dos dados funciona

O módulo guarda CPF, nome da mãe e data de nascimento. A proteção **não depende da tela**:

1. A tabela `colaboradores` só pode ser lida direto por admin e RH.
2. Todo mundo lê pela view `vw_colaboradores`, que mascara o CPF, esconde o nome da mãe
   de quem não é RH e filtra as linhas pela unidade do gestor. Esconder um botão não
   protege nada — quem não tem permissão **recebe o dado já mascarado do servidor**.
3. **Nenhuma gravação vai direto na tabela.** Toda alteração passa por uma função
   `colab_*` que confere perfil e unidade no banco. É por isso que um gestor não
   consegue alterar CPF nem chamando a API na mão.
4. Um gatilho grava toda inclusão, alteração e exclusão em `colab_auditoria`, com campo,
   valor anterior, valor novo, autor e horário. Importação, exportação e emissão de
   documento também ficam registradas.
5. A tabela de perfis não é acessível pelo site: perfil só se concede pelo SQL Editor.
   Assim ninguém se promove a administrador pelo navegador.

> **Atenção — não existe banco de teste.** Preview e produção do Vercel apontam para o
> mesmo projeto Supabase. Qualquer dado criado testando numa preview entra na base real.
> Teste com registro descartável e apague depois.

> **Confira também** se o cadastro público continua desligado em
> Authentication → Sign In / Providers → Email → *Allow new users to sign up*. A chave
> `sb_publishable_` fica no código do site; com cadastro aberto, qualquer pessoa criaria
> conta. As políticas acima seguram, mas não convém depender de uma trava só.

## A conta dos 30 e dos 90 dias

- A **admissão é o dia 1** do contrato.
- 1º período: 30 dias corridos → termina em `admissão + 29`.
- 2º período: começa no **31º dia**, soma 60 dias corridos → termina em `admissão + 89`,
  que é o **90º dia** contado da admissão.
- "Dias corridos" é soma de dias no calendário. Fevereiro de 28 ou 29, meses de 30 ou 31
  e virada de ano saem certos porque a soma é feita em número de dias, não em mês.

Exemplo conferido nos testes: admitida em 31/01/2026 → 30º dia em 01/03/2026,
90º dia em 30/04/2026.

O status do contrato **nunca é gravado**, é calculado. "Aguardando decisão" depende do dia
de hoje: se ficasse gravado, envelheceria sozinho e a tela mostraria mentira. O que se
grava são os fatos — a admissão e as decisões tomadas.

### Regularização de histórico

Ao importar o cadastro que já existia, entra gente admitida há anos e sem nenhuma decisão
registrada. A regra classifica essas pessoas — corretamente — como "aguardando decisão do
1º período", e a central de notificações abriria com dezenas de cobranças de um contrato
que terminou muito antes, encobrindo os contratos que estão de fato em jogo.

Na planilha `nazo sul.xls` isso são **53 dos 87** cadastros.

O módulo **não deduz a decisão sozinho** — isso esconderia pendência real. Em vez disso, a
aba **Experiência** mostra um painel que efetiva esses casos em lote, mediante confirmação,
gravando a decisão com autor, data, horário e observação. Quem venceu nos últimos 30 dias
**não** entra no lote: é pendência de verdade e continua sendo cobrada.

## Importação de planilha

Dois formatos são reconhecidos sozinhos:

**a) Planilha em tabela** — uma linha de cabeçalho e uma linha por pessoa. O de-para das
colunas é montado automaticamente (reconhece `NOME`, `CPF`, `NOME DA MAE`,
`DATA DE ADMISSÃO`, `DDD CELULAR` + `TEL CELULAR`, e variações abreviadas ou com acento) e
pode ser corrigido na tela, coluna por coluna.

**b) Relatório de listagem de funcionários** (Rel090, o que sai do sistema de folha) — não é
tabela: cada pessoa ocupa duas linhas, e telefone, e-mail e nome da mãe vêm dentro de um
texto corrido junto com o endereço. A unidade vem da linha `Empresa:`. O módulo extrai os
campos e trata os defeitos que esse relatório traz de fábrica: campo de telefone vazio, só
o DDD, parêntese sem fechar (`(61987654321`) e celular antigo de 8 dígitos.

Regras da importação:

- CPF é o identificador único. Sem CPF, a duplicata é procurada por nome + data de admissão.
- **Nada é sobrescrito automaticamente.** Diferenças em cadastro existente viram propostas;
  telefone e e-mail vêm pré-marcados (é o alvo declarado do escopo), os outros campos vêm
  desmarcados. Só o que estiver marcado é gravado.
- Campo vazio na planilha **não apaga** o que já está cadastrado.
- Celular de 8 dígitos não é "consertado" no escuro: vira sugestão para alguém confirmar.
- O resumo informa lidos, a inserir, a atualizar, já cadastrados sem mudança, duplicados na
  planilha, inválidos e os que exigem correção manual.
- Reimportar o mesmo arquivo não duplica ninguém e não propõe alteração nenhuma.

Resultado medido com `nazo sul.xls`: 87 pessoas, 87 CPFs válidos e distintos, todas com
admissão, nascimento, nome da mãe e e-mail; 46 telefones prontos para WhatsApp, 9 com 8
dígitos (sugestão de nono dígito) e 32 sem telefone — os 41 últimos entram e ficam na aba
**Cadastro** para completar.

## Termo de Encerramento

Gerado a partir do modelo configurável, com campos dinâmicos. Abre em janela própria com
botão de imprimir (que é também "salvar em PDF" no navegador).

- A **observação interna do gestor não entra no documento**. Não existe campo para ela no
  modelo, e há teste conferindo que ela não aparece no texto gerado.
- A tarja avisando que se trata de **modelo operacional**, que pode precisar de validação do
  RH / Departamento Pessoal ou da assessoria jurídica, aparece na tela e **não sai na
  impressão** — o papel entregue é só o termo.
- Faltando dado da empresa, o termo sai com linhas para preencher à mão e a tela diz o que
  falta, em vez de imprimir espaço em branco silenciosamente.

## Folga de aniversário

Não precisa cair no dia do aniversário, mas precisa acontecer **no mês do aniversário**
(competência mensal). Data fora do mês só com **exceção autorizada**, que fica registrada.
Ao agendar, o módulo confere se já há folga na mesma data e unidade: se houver, avisa do
impacto operacional e **permite prosseguir** — a decisão é do gestor autorizado.

Oito status, conforme o escopo: não analisada, aguardando aprovação, aprovada, agendada,
realizada, recusada, não se aplica, reagendada excepcionalmente. O controle é **por ano**:
a folga zera a cada aniversário.

O filtro padrão da aba é "precisam de atenção agora" — quem já está na competência ou
passou dela, mais as aprovadas sem data. Pela regra anual, quem faz aniversário em dezembro
está com a folga "não analisada" desde janeiro; verdade, mas inútil como painel de trabalho.

## Mensagem de aniversário

Montada com o primeiro nome, editável antes do envio, com botões para copiar e para abrir a
conversa no WhatsApp com o texto pronto. **O envio nunca acontece sozinho** — não há
integração com a API oficial do WhatsApp; o módulo abre a conversa e quem envia é a pessoa.
Depois, "Registrar envio" grava data, horário e usuário. O controle é por ano.

Quem nasceu em **29 de fevereiro** aparece em fevereiro todos os anos: nos anos comuns a
data considerada é 28/02, e a tela informa o ajuste. Sem isso a pessoa desapareceria da
lista em três de cada quatro anos.

## Notificações

Não há fila gravada no banco: as pendências são **calculadas** a partir do estado atual.
Assim não existe aviso fantasma de algo já resolvido, nem pendência sem aviso porque uma
rotina não rodou. O banco guarda só o que o usuário fez com cada aviso — leu, adiou,
resolveu — e a chave inclui o ciclo (o ano, o período), para a mesma pendência não voltar
marcada como lida no ano seguinte.

Tipos: fim do 1º período, decisão do 1º período em atraso, renovação aprovada e não
confirmada, fim do contrato, decisão final em atraso, aniversário chegando, mensagem não
enviada, folga sem análise, folga aprovada sem data, telefone ou e-mail ausente ou inválido.

A antecedência é configurável por tipo (padrão 7 dias).

## Testes

Abra `colaboradores-testes.html` no navegador. São **474 verificações** sobre
`colaboradores-core.js`, sem banco e sem login.

Cobrem o que o escopo pediu para conferir: admissão no fim do mês, meses de 28, 29, 30 e 31
dias, virada de ano, admissões antigas, aniversário em 29 de fevereiro, colaborador sem
telefone ou e-mail, CPF duplicado, reprovação no 1º e no 2º período, renovação não
confirmada, folga fora da competência e atualização por nova importação.

A aritmética de datas é conferida contra um somador que anda **um dia por vez** pela tabela
de dias do mês — devagar, mas obviamente certo — em 528 combinações entre 2019 e 2029,
usando as pontas de todos os meses.

A página aceita também uma planilha de verdade (botão no topo): o arquivo é lido **dentro do
navegador**, nada é enviado a servidor nenhum, e os testes recontam CPFs, telefones,
e-mails, duplicidade e reimportação sobre os dados reais.

## Levar o módulo para outro aplicativo

O módulo foi feito em camadas com portabilidade medida. Não copie o HTML completo:
é a camada menos reaproveitável, e você ficaria com duas cópias da regra para manter.

| Camada | Linhas | Portabilidade | Amarras |
|---|---|---|---|
| `supabase/07-colaboradores.sql` | 1.159 | quase total | só Supabase Auth (`auth.users`, `auth.uid()`, `auth.jwt()`) |
| `colaboradores-core.js` | 1.557 | **total** | nenhuma: zero `document`, `window`, `fetch`, `localStorage`, `supabase`, `XLSX`, `import` |
| `colaboradores-testes.html` | 1.193 | total | só o core |
| `colaboradores.js` | 2.071 | baixa | 96 ids de elemento, 39 `onclick` — colado no HTML |
| `colaboradores.html` | 614 | média | marcação + tokens CSS |

São **3.909 linhas que se movem verbatim** — e são as que concentram o risco: contas de
30/90 dias, CPF, telefone, máquina de status, leitura do Rel090, notificações. Todas
cobertas pelos 474 testes. Só as 2.685 linhas de tela podem precisar de reescrita.

**A ordem é sempre esta:**

1. **SQL primeiro.** Rode `07-colaboradores.sql` no SQL Editor do projeto Supabase de
   destino. O arquivo é autocontido: recria a função `marcar_alteracao()` de que precisa,
   então não exige o `01-estrutura.sql`. Edite a lista de e-mails do item 2 antes de rodar.
2. **Core e testes juntos, sem alterar uma linha.** Abra `colaboradores-testes.html` no
   destino: se der 474/474, as regras chegaram inteiras. Levar o core sem os testes é
   perder a única prova de que ele continua correto.
3. **Tela por último**, conforme a tecnologia do destino.

**Se o destino é HTML/JS estático** (como esta agenda): copie os três arquivos e declare a
conexão antes de carregar o `colaboradores.js` — não edite o arquivo:

```html
<script>
  window.COLAB_CONFIG = {
    url: 'https://SEU-PROJETO.supabase.co',
    key: 'sb_publishable_...'
  };
</script>
<script src="colaboradores.js"></script>
```

Se o aplicativo de destino já tem um cliente Supabase, reaproveite-o —
`window.COLAB_CONFIG = { client: meuCliente }` — porque dois clientes no mesmo navegador
mantêm duas sessões concorrentes, e o usuário é deslogado de um lado ao entrar do outro.
Depois ajuste os tokens CSS em `:root` para a identidade visual do destino.

**Se o destino tem build (React, Next, Vue):** o core já é um módulo — exporta por
`module.exports` e por `window.CoreColab`, sem `import` interno. Entra intacto
(`import Core from './colaboradores-core.js'`). Reescreva só a tela, deixando todo o
cálculo no core.

**Se o destino não usa Supabase:** o core continua servindo por inteiro. O que precisa de
tradução é o SQL — em especial as 17 funções `colab_*`, que são onde a permissão é
verificada. Não mova a verificação para o cliente: é o servidor que impede um gestor de
alterar CPF.

**Cuidado com a duplicação.** Duas cópias do core em dois aplicativos viram duas regras
diferentes no primeiro conserto feito em só um lado. Se os dois apps forem seus, prefira
servir o `colaboradores-core.js` de um lugar só, ou combine que correções entram nos dois
com os testes rodados nos dois.

## Decisões que vale saber

- **Sem tempo real.** A agenda usa realtime porque duas pessoas editam a mesma lista ao
  mesmo tempo. Aqui a leitura passa por uma view, e view não emite evento de realtime; a
  tela recarrega depois de cada gravação e tem botão **Atualizar**.
- **CPF opcional no cadastro, com ressalva.** A planilha da folha traz CPF de todos, mas
  outros relatórios da empresa (`ativos itaim.xls`, por exemplo) não têm a coluna. Quem
  entra sem CPF fica marcado como pendência de correção, em vez de ser recusado.
- **Exclusão é do administrador e pede confirmação digitada.** Em geral o certo é marcar
  como Inativo: o histórico continua consultável.
- **Exportação exige confirmação** e fica registrada em auditoria com quantidade, filtros e
  usuário. Quem não tem permissão para ver CPF exporta o CPF mascarado.
