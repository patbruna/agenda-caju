-- =================================================================
-- Gestão de Colaboradores — Grupo Caju
-- Rode DEPOIS do 01-estrutura.sql e do 02-seguranca.sql.
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- Pode rodar mais de uma vez: nada é apagado nem duplicado.
--
-- COMO A SEGURANÇA FUNCIONA AQUI (leia antes de mexer)
-- Este módulo guarda CPF, nome da mãe e data de nascimento — dado
-- pessoal sensível, bem mais delicado que a agenda de candidatos.
-- Por isso a proteção NÃO depende da tela:
--
--   1. A tabela `colaboradores` só pode ser LIDA direto por admin e RH.
--   2. Todo mundo (inclusive admin) lê pela view `vw_colaboradores`,
--      que MASCARA o CPF e ESCONDE o nome da mãe de quem não é RH,
--      e ainda filtra as linhas pela unidade do gestor.
--   3. NINGUÉM escreve direto na tabela. Toda gravação passa por uma
--      função `colab_*` que confere perfil e unidade no servidor.
--      Assim um gestor não consegue, nem pela API, alterar CPF.
--   4. Um gatilho grava toda alteração em `colab_auditoria`. Não há
--      como driblar pelo navegador.
--
-- Quem não estiver em `colab_perfis` não vê absolutamente nada.
-- =================================================================


-- -----------------------------------------------------------------
-- 0) Pré-requisito, recriado aqui para este arquivo poder ser instalado
--    SOZINHO em outro projeto Supabase.
--
--    Esta função também existe no 01-estrutura.sql. Recriá-la é inofensivo
--    (o corpo é idêntico), e é o que permite levar o módulo de colaboradores
--    para outro aplicativo levando só este arquivo.
-- -----------------------------------------------------------------
create or replace function public.marcar_alteracao()
returns trigger
language plpgsql
as $$
begin
  new.alterado_em = now();
  return new;
end;
$$;


-- -----------------------------------------------------------------
-- 1) Perfis de acesso do módulo
-- -----------------------------------------------------------------
create table if not exists public.colab_perfis (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  email      text,
  perfil     text not null,
  unidade    text,               -- só para 'gestor'/'consulta': limita o que enxerga
  criado_em  timestamptz not null default now(),

  constraint colab_perfis_perfil_valido
    check (perfil in ('admin','rh','gestor','consulta'))
);

comment on column public.colab_perfis.unidade is
  'Nulo = vê todas as unidades. Preenchido = vê somente aquela unidade.';

-- Igual ao acessos_permitidos: sem policy nenhuma de propósito.
-- Só o SQL Editor do painel (que roda como administrador) mexe nesta
-- tabela, então ninguém se promove a admin pelo navegador.
alter table public.colab_perfis enable row level security;

-- >>> EDITE A LISTA ABAIXO <<<
-- Os usuários já precisam existir em Authentication -> Users.
--
-- A comparação é por `lower(trim(...))` de propósito: com igualdade exata,
-- qualquer diferença de caixa ou espaço no e-mail gravado em auth.users faz o
-- insert não achar ninguém e falhar EM SILÊNCIO — a pessoa então entra no site
-- e leva "sem acesso ao módulo" sem nenhuma pista do motivo.
--
-- E `do update` em vez de `do nothing`: rodar o arquivo de novo conserta um
-- perfil que ficou errado, em vez de ignorar.
insert into public.colab_perfis (user_id, email, perfil, unidade)
select u.id, u.email, 'admin', null
from auth.users u
where lower(trim(u.email)) in ('brunapatricio@cajupar.com')
on conflict (user_id) do update
  set perfil = excluded.perfil, unidade = excluded.unidade, email = excluded.email;

insert into public.colab_perfis (user_id, email, perfil, unidade)
select u.id, u.email, 'rh', null
from auth.users u
where lower(trim(u.email)) in ('victorgutierres@cajupar.com')
on conflict (user_id) do update
  set perfil = excluded.perfil, unidade = excluded.unidade, email = excluded.email;

-- Aviso alto se ninguém foi liberado: sem isto o arquivo roda "com sucesso"
-- e o módulo fica inacessível para todos, sem explicação.
do $$
declare n int;
begin
  select count(*) into n from public.colab_perfis;
  if n = 0 then
    raise warning 'NENHUM PERFIL FOI CRIADO. Os e-mails da lista acima não batem com nenhum usuário em Authentication -> Users. Rode a consulta de conferência do item 17(b) para ver os e-mails existentes.';
  else
    raise notice 'Perfis liberados no módulo de colaboradores: %', n;
  end if;
end $$;


-- -----------------------------------------------------------------
-- 2) Funções de contexto — respondem "quem está pedindo?"
--    security definer porque colab_perfis é fechada para o site.
-- -----------------------------------------------------------------
create or replace function public.colab_perfil()
returns text language sql stable security definer set search_path = public as $$
  select p.perfil from public.colab_perfis p where p.user_id = auth.uid();
$$;

create or replace function public.colab_unidade()
returns text language sql stable security definer set search_path = public as $$
  select p.unidade from public.colab_perfis p where p.user_id = auth.uid();
$$;

-- RH e admin veem CPF inteiro e nome da mãe. Os outros, não.
create or replace function public.colab_ve_sensivel()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.colab_perfil() in ('admin','rh'), false);
$$;

-- Quem pode importar, criar, excluir, configurar e exportar.
create or replace function public.colab_e_rh()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.colab_perfil() in ('admin','rh'), false);
$$;

-- Quem pode registrar decisões, folgas e atualizar contato:
-- RH, admin e o gestor da unidade do colaborador.
create or replace function public.colab_pode_operar(p_unidade text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when public.colab_perfil() in ('admin','rh') then true
    when public.colab_perfil() = 'gestor' then
      public.colab_unidade() is null
      or p_unidade is not distinct from public.colab_unidade()
    else false
  end;
$$;

create or replace function public.colab_email_atual()
returns text language sql stable as $$
  select coalesce(auth.jwt() ->> 'email', 'sistema');
$$;


-- -----------------------------------------------------------------
-- 3) CPF: validação de verdade (dígitos verificadores) no banco.
--    A tela valida igual, em JS. Ter nos dois lados evita que uma
--    importação mal feita entre por baixo da tela.
-- -----------------------------------------------------------------
create or replace function public.colab_cpf_valido(p_cpf text)
returns boolean language plpgsql immutable as $$
declare
  d text; s int := 0; i int; d1 int; d2 int;
begin
  if p_cpf is null then return true; end if;         -- nulo = "ainda não informado"
  d := regexp_replace(p_cpf, '\D', '', 'g');
  if length(d) <> 11 then return false; end if;
  if d ~ '^(\d)\1{10}$' then return false; end if;    -- 111.111.111-11 e afins
  for i in 1..9 loop
    s := s + substr(d, i, 1)::int * (11 - i);
  end loop;
  d1 := 11 - (s % 11);
  if d1 >= 10 then d1 := 0; end if;
  if d1 <> substr(d, 10, 1)::int then return false; end if;
  s := 0;
  for i in 1..10 loop
    s := s + substr(d, i, 1)::int * (12 - i);
  end loop;
  d2 := 11 - (s % 11);
  if d2 >= 10 then d2 := 0; end if;
  return d2 = substr(d, 11, 1)::int;
end $$;

-- Exibição parcial. Um só lugar para mudar se a política mudar.
create or replace function public.colab_mascara_cpf(p_cpf text)
returns text language sql immutable as $$
  select case
    when p_cpf is null or length(regexp_replace(p_cpf,'\D','','g')) <> 11 then null
    else '***.***.' || substr(regexp_replace(p_cpf,'\D','','g'), 7, 3)
                    || '-' || substr(regexp_replace(p_cpf,'\D','','g'), 10, 2)
  end;
$$;


-- -----------------------------------------------------------------
-- 4) Tabela principal
--
-- Sobre o contrato de experiência: guardamos os FATOS (admissão e as
-- decisões tomadas) e nunca o status calculado. O status "aguardando
-- decisão" depende do dia de hoje — se ficasse gravado, envelheceria
-- sozinho e a tela mostraria mentira. Ele é derivado na hora, na tela
-- e na função colab_contrato_status() abaixo.
--
-- As datas-fim são colunas geradas: o banco calcula, então filtro e
-- ordenação por vencimento saem numa consulta só.
--   1º período: admissão é o dia 1  ->  fim = admissão + 29
--   2º período: começa no dia 31, +60 dias -> fim = admissão + 89 (90º dia)
-- -----------------------------------------------------------------
create table if not exists public.colaboradores (
  id                 uuid primary key default gen_random_uuid(),

  -- cadastro
  nome               text not null,
  nome_mae           text,
  cpf                text,                    -- só dígitos; nulo = pendente de correção
  data_admissao      date,
  data_nascimento    date,
  email              text,
  telefone           text,                    -- só dígitos, padrão WhatsApp: 55 + DDD + número
  unidade            text,
  situacao           text not null default 'Ativo',
  data_desligamento  date,

  -- decisão do 1º período
  p1_decisao         text,                    -- 'aprovado' | 'reprovado' | nulo (pendente)
  p1_decidido_em     timestamptz,
  p1_por             text,
  p1_obs             text,                    -- observação interna do gestor

  -- renovação (o 2º período só corre depois de confirmada)
  renovacao_confirmada_em timestamptz,
  renovacao_por      text,

  -- decisão final
  p2_decisao         text,                    -- 'efetivado' | 'encerrado' | nulo (pendente)
  p2_decidido_em     timestamptz,
  p2_por             text,
  p2_obs             text,

  -- encerramento (reprovação em qualquer período ou saída avulsa)
  data_encerramento  date,
  encerramento_motivo text,

  -- folga de aniversário (por ano, para zerar a cada aniversário)
  folga_status       text not null default 'nao_analisada',
  folga_ano          int,
  folga_data         date,
  folga_obs          text,
  folga_aprovada_por text,
  folga_aprovada_em  timestamptz,
  folga_excepcional  boolean not null default false,

  -- mensagem de aniversário (por ano, mesmo motivo)
  aniv_msg_ano       int,
  aniv_msg_em        timestamptz,
  aniv_msg_por       text,

  origem             text,                    -- 'importacao' | 'manual'
  criado_em          timestamptz not null default now(),
  criado_por         text,
  alterado_em        timestamptz not null default now(),

  -- datas calculadas pelo banco
  exp_fim_p1 date generated always as (data_admissao + 29) stored,
  exp_fim_p2 date generated always as (data_admissao + 89) stored,

  constraint colaboradores_cpf_valido      check (public.colab_cpf_valido(cpf)),
  constraint colaboradores_situacao_valida check (situacao in ('Ativo','Inativo')),
  constraint colaboradores_p1_valida       check (p1_decisao is null or p1_decisao in ('aprovado','reprovado')),
  constraint colaboradores_p2_valida       check (p2_decisao is null or p2_decisao in ('efetivado','encerrado')),
  constraint colaboradores_folga_valida    check (folga_status in (
    'nao_analisada','aguardando_aprovacao','aprovada','agendada',
    'realizada','recusada','nao_se_aplica','reagendada_excepcional')),
  -- Só faz sentido ter decisão do 2º período depois de renovar.
  constraint colaboradores_p2_exige_renovacao check (
    p2_decisao is null or renovacao_confirmada_em is not null)
);

-- CPF é o identificador único — mas só quando existe. Registros
-- importados sem CPF entram como pendência, não como duplicata.
create unique index if not exists colaboradores_cpf_unico
  on public.colaboradores (cpf) where cpf is not null;

-- Rede de segurança para quem chega sem CPF: evita a mesma pessoa
-- entrar duas vezes numa reimportação.
create unique index if not exists colaboradores_sem_cpf_unico
  on public.colaboradores (lower(nome), data_admissao) where cpf is null;

create index if not exists colaboradores_venc_p1_idx on public.colaboradores (exp_fim_p1);
create index if not exists colaboradores_venc_p2_idx on public.colaboradores (exp_fim_p2);
create index if not exists colaboradores_unidade_idx on public.colaboradores (unidade);
create index if not exists colaboradores_aniv_idx
  on public.colaboradores (extract(month from data_nascimento), extract(day from data_nascimento));


-- -----------------------------------------------------------------
-- 5) Histórico de decisões do contrato
-- -----------------------------------------------------------------
create table if not exists public.colab_decisoes (
  id             uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  periodo        int  not null,               -- 1, 2 ou 0 (avulso)
  decisao        text not null,               -- aprovado|reprovado|renovacao_confirmada|efetivado|encerrado|pendente
  observacao     text,
  usuario_email  text not null,
  usuario_id     uuid,
  criado_em      timestamptz not null default now(),

  constraint colab_decisoes_periodo_valido check (periodo in (0,1,2))
);
create index if not exists colab_decisoes_colab_idx
  on public.colab_decisoes (colaborador_id, criado_em desc);


-- -----------------------------------------------------------------
-- 6) Auditoria
--    Sem chave estrangeira de propósito: se um colaborador for
--    excluído, o rastro de quem mexeu no que continua existindo.
-- -----------------------------------------------------------------
create table if not exists public.colab_auditoria (
  id                uuid primary key default gen_random_uuid(),
  colaborador_id    uuid,
  colaborador_nome  text,
  acao              text not null,   -- criacao|alteracao|exclusao|importacao|exportacao|documento
  campo             text,
  valor_anterior    text,
  valor_novo        text,
  detalhe           text,
  usuario_email     text not null,
  usuario_id        uuid,
  criado_em         timestamptz not null default now()
);
create index if not exists colab_auditoria_colab_idx
  on public.colab_auditoria (colaborador_id, criado_em desc);
create index if not exists colab_auditoria_data_idx
  on public.colab_auditoria (criado_em desc);


-- -----------------------------------------------------------------
-- 7) Estado das notificações
--    As notificações em si são CALCULADAS a partir dos dados (não há
--    fila para desandar). Aqui guardamos só o que o usuário fez com
--    elas: leu, adiou, resolveu. A `referencia` amarra ao ciclo
--    ('2026' para aniversário, 'p1' para o período) para a mesma
--    pendência não voltar como lida no ano seguinte.
-- -----------------------------------------------------------------
create table if not exists public.colab_notificacoes (
  id             uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  tipo           text not null,
  referencia     text not null default '-',
  lida_em        timestamptz,
  adiada_para    timestamptz,
  resolvida_em   timestamptz,
  resolucao      text,
  usuario_email  text,
  alterado_em    timestamptz not null default now(),
  unique (colaborador_id, tipo, referencia)
);


-- -----------------------------------------------------------------
-- 8) Configuração do módulo (linha única, id = 1)
-- -----------------------------------------------------------------
create table if not exists public.colab_config (
  id                   int primary key default 1,

  -- dados que entram no termo de encerramento
  empresa_nome         text not null default '',
  empresa_cidade       text not null default '',
  resp_nome            text not null default '',
  resp_cargo           text not null default '',

  -- antecedência das notificações, em dias
  dias_aviso_p1        int  not null default 7,
  dias_aviso_p2        int  not null default 7,
  dias_aviso_aniv      int  not null default 7,

  politica_folga_ativa boolean not null default true,
  msg_aniversario      text not null default '',
  termo_modelo         text not null default '',
  alterado_em          timestamptz not null default now(),

  constraint colab_config_linha_unica check (id = 1),
  constraint colab_config_dias_p1   check (dias_aviso_p1   between 0 and 29),
  constraint colab_config_dias_p2   check (dias_aviso_p2   between 0 and 59),
  constraint colab_config_dias_aniv check (dias_aviso_aniv between 0 and 60)
);

insert into public.colab_config (id, msg_aniversario, termo_modelo)
values (
  1,
  'Olá, {PRIMEIRO_NOME}! Em nome de toda a equipe, desejamos a você um feliz aniversário! '
  || 'Que este novo ciclo seja marcado por muitas conquistas, saúde, felicidade e sucesso. '
  || 'Agradecemos por fazer parte do nosso time. Aproveite muito o seu dia! 🎉🎂',
  ''
) on conflict (id) do nothing;


-- -----------------------------------------------------------------
-- 9) Carimbo de alteração
-- -----------------------------------------------------------------
drop trigger if exists colaboradores_alterado on public.colaboradores;
create trigger colaboradores_alterado
  before update on public.colaboradores
  for each row execute function public.marcar_alteracao();

drop trigger if exists colab_config_alterado on public.colab_config;
create trigger colab_config_alterado
  before update on public.colab_config
  for each row execute function public.marcar_alteracao();

drop trigger if exists colab_notificacoes_alterado on public.colab_notificacoes;
create trigger colab_notificacoes_alterado
  before update on public.colab_notificacoes
  for each row execute function public.marcar_alteracao();


-- -----------------------------------------------------------------
-- 10) Auditoria automática
--     No banco, não na tela: nenhuma alteração escapa.
-- -----------------------------------------------------------------
create or replace function public.colab_auditar()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  campos text[] := array[
    'nome','nome_mae','cpf','data_admissao','data_nascimento','email','telefone',
    'unidade','situacao','data_desligamento',
    'p1_decisao','p1_obs','renovacao_confirmada_em',
    'p2_decisao','p2_obs','data_encerramento','encerramento_motivo',
    'folga_status','folga_data','folga_obs','folga_excepcional',
    'aniv_msg_ano','aniv_msg_em'];
  campo  text;
  velho  jsonb;
  novo   jsonb;
  quem   text := public.colab_email_atual();
begin
  if tg_op = 'INSERT' then
    insert into public.colab_auditoria
      (colaborador_id, colaborador_nome, acao, detalhe, usuario_email, usuario_id)
    values (new.id, new.nome, 'criacao', coalesce(new.origem,'manual'), quem, auth.uid());
    return new;
  end if;

  if tg_op = 'DELETE' then
    insert into public.colab_auditoria
      (colaborador_id, colaborador_nome, acao, detalhe, usuario_email, usuario_id)
    values (old.id, old.nome, 'exclusao', public.colab_mascara_cpf(old.cpf), quem, auth.uid());
    return old;
  end if;

  velho := to_jsonb(old);
  novo  := to_jsonb(new);
  foreach campo in array campos loop
    if (velho -> campo) is distinct from (novo -> campo) then
      insert into public.colab_auditoria
        (colaborador_id, colaborador_nome, acao, campo,
         valor_anterior, valor_novo, usuario_email, usuario_id)
      values (new.id, new.nome, 'alteracao', campo,
              velho ->> campo, novo ->> campo, quem, auth.uid());
    end if;
  end loop;
  return new;
end $$;

drop trigger if exists colaboradores_auditoria_ins on public.colaboradores;
create trigger colaboradores_auditoria_ins
  after insert on public.colaboradores
  for each row execute function public.colab_auditar();

drop trigger if exists colaboradores_auditoria_upd on public.colaboradores;
create trigger colaboradores_auditoria_upd
  after update on public.colaboradores
  for each row execute function public.colab_auditar();

drop trigger if exists colaboradores_auditoria_del on public.colaboradores;
create trigger colaboradores_auditoria_del
  after delete on public.colaboradores
  for each row execute function public.colab_auditar();


-- -----------------------------------------------------------------
-- 11) Status do contrato, calculado
--     Mesma regra que roda na tela (colaboradores-core.js). Aqui
--     existe para relatório e para conferência direta no SQL Editor.
-- -----------------------------------------------------------------
create or replace function public.colab_contrato_status(
  p_admissao date,
  p_p1 text, p_renov timestamptz, p_p2 text,
  p_encerramento date,
  p_aviso_p1 int default 7, p_aviso_p2 int default 7,
  p_hoje date default current_date
) returns text language plpgsql immutable as $$
declare fim1 date; fim2 date;
begin
  if p_p2 = 'efetivado' then return 'efetivado'; end if;
  if p_p2 = 'encerrado' then return 'reprovado_p2'; end if;
  if p_p1 = 'reprovado' then return 'reprovado_p1'; end if;
  if p_encerramento is not null then return 'encerrado'; end if;
  if p_admissao is null then return 'sem_admissao'; end if;

  fim1 := p_admissao + 29;
  fim2 := p_admissao + 89;

  if p_p1 = 'aprovado' then
    if p_renov is null then return 'renovacao_aprovada'; end if;
    if p_hoje < fim2 - p_aviso_p2 then return 'p2_andamento'; end if;
    return 'p2_aguardando';
  end if;

  if p_hoje < fim1 - p_aviso_p1 then return 'p1_andamento'; end if;
  return 'p1_aguardando';
end $$;


-- -----------------------------------------------------------------
-- 12) A view que a tela lê
--     Roda com o dono da view (security_invoker = false) porque é ela
--     quem faz o mascaramento e o filtro por unidade. A tabela crua
--     fica trancada logo abaixo.
-- -----------------------------------------------------------------
drop view if exists public.vw_colaboradores;
create view public.vw_colaboradores
with (security_invoker = false) as
select
  c.id,
  c.nome,
  case when public.colab_ve_sensivel() then c.nome_mae end          as nome_mae,
  case when public.colab_ve_sensivel() then c.cpf
       else public.colab_mascara_cpf(c.cpf) end                     as cpf,
  public.colab_mascara_cpf(c.cpf)                                   as cpf_mascarado,
  c.cpf is not null                                                 as tem_cpf,
  public.colab_ve_sensivel()                                        as ve_sensivel,
  c.data_admissao, c.data_nascimento, c.email, c.telefone,
  c.unidade, c.situacao, c.data_desligamento,
  c.exp_fim_p1, c.exp_fim_p2,
  c.p1_decisao, c.p1_decidido_em, c.p1_por,
  case when public.colab_ve_sensivel()
         or public.colab_perfil() = 'gestor' then c.p1_obs end      as p1_obs,
  c.renovacao_confirmada_em, c.renovacao_por,
  c.p2_decisao, c.p2_decidido_em, c.p2_por,
  case when public.colab_ve_sensivel()
         or public.colab_perfil() = 'gestor' then c.p2_obs end      as p2_obs,
  c.data_encerramento, c.encerramento_motivo,
  c.folga_status, c.folga_ano, c.folga_data, c.folga_obs,
  c.folga_aprovada_por, c.folga_aprovada_em, c.folga_excepcional,
  c.aniv_msg_ano, c.aniv_msg_em, c.aniv_msg_por,
  c.origem, c.criado_em, c.alterado_em
from public.colaboradores c
where public.colab_perfil() is not null
  and (
    public.colab_perfil() in ('admin','rh')
    or public.colab_unidade() is null
    or c.unidade is not distinct from public.colab_unidade()
  );

comment on view public.vw_colaboradores is
  'Única porta de leitura da tela. Mascara CPF e esconde nome da mãe de quem não é RH/admin, e limita as linhas à unidade do gestor.';


-- -----------------------------------------------------------------
-- 13) RLS
--     Tabela crua: leitura só de RH/admin. Escrita: ninguém pela API.
--     Toda gravação entra pelas funções colab_* do item 14.
-- -----------------------------------------------------------------
alter table public.colaboradores      enable row level security;
alter table public.colab_decisoes     enable row level security;
alter table public.colab_auditoria    enable row level security;
alter table public.colab_notificacoes enable row level security;
alter table public.colab_config       enable row level security;

drop policy if exists "rh le colaboradores" on public.colaboradores;
create policy "rh le colaboradores"
  on public.colaboradores for select to authenticated
  using (public.colab_e_rh());
-- Nenhuma policy de insert/update/delete: bloqueado pela API REST.

-- Histórico de decisões: quem opera o colaborador pode ler.
drop policy if exists "le decisoes" on public.colab_decisoes;
create policy "le decisoes"
  on public.colab_decisoes for select to authenticated
  using (exists (
    select 1 from public.colaboradores c
    where c.id = colab_decisoes.colaborador_id
      and public.colab_pode_operar(c.unidade)
  ));

-- Auditoria guarda valores antigos de CPF e nome da mãe: só RH/admin.
drop policy if exists "rh le auditoria" on public.colab_auditoria;
create policy "rh le auditoria"
  on public.colab_auditoria for select to authenticated
  using (public.colab_e_rh());

drop policy if exists "le notificacoes" on public.colab_notificacoes;
create policy "le notificacoes"
  on public.colab_notificacoes for select to authenticated
  using (exists (
    select 1 from public.colaboradores c
    where c.id = colab_notificacoes.colaborador_id
      and public.colab_pode_operar(c.unidade)
  ));

drop policy if exists "todos leem config" on public.colab_config;
create policy "todos leem config"
  on public.colab_config for select to authenticated
  using (public.colab_perfil() is not null);
-- Gravação da config: só pela função colab_config_salvar (admin).

grant select on public.vw_colaboradores to authenticated;
revoke all on public.vw_colaboradores from anon;


-- =================================================================
-- 14) Funções de gravação
--     Cada uma confere o perfil no servidor antes de tocar no dado.
--     É aqui que "gestor não altera CPF" deixa de ser promessa da
--     tela e passa a ser regra do banco.
-- =================================================================

-- Contexto para a tela montar os botões certos.
create or replace function public.colab_meu_contexto()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'email',         public.colab_email_atual(),
    'perfil',        public.colab_perfil(),
    'unidade',       public.colab_unidade(),
    've_sensivel',   public.colab_ve_sensivel(),
    'pode_importar', public.colab_e_rh(),
    'pode_criar',    public.colab_e_rh(),
    'pode_exportar', public.colab_e_rh(),
    'pode_excluir',  coalesce(public.colab_perfil() = 'admin', false),
    'pode_config',   coalesce(public.colab_perfil() = 'admin', false),
    'pode_operar',   coalesce(public.colab_perfil() in ('admin','rh','gestor'), false)
  );
$$;

create or replace function public.colab_exigir(p_ok boolean, p_msg text)
returns void language plpgsql immutable as $$
begin
  if not coalesce(p_ok, false) then
    raise exception '%', p_msg using errcode = '42501';
  end if;
end $$;

-- Normaliza telefone para o padrão WhatsApp: 55 + DDD + número.
create or replace function public.colab_norm_fone(p text)
returns text language plpgsql immutable as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  if d = '' then return null; end if;
  d := regexp_replace(d, '^0+', '');
  if length(d) in (10, 11) then d := '55' || d; end if;
  return d;
end $$;

create or replace function public.colab_norm_cpf(p text)
returns text language plpgsql immutable as $$
declare d text;
begin
  if p is null then return null; end if;
  d := regexp_replace(p, '\D', '', 'g');
  if d = '' then return null; end if;
  return d;
end $$;


-- ---- cadastro completo (criar / editar) — RH e admin ------------
create or replace function public.colab_salvar(p jsonb)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid := nullif(p->>'id','')::uuid;
begin
  perform public.colab_exigir(public.colab_e_rh(),
    'Somente RH ou administrador pode criar ou editar o cadastro completo.');

  if v_id is null then
    insert into public.colaboradores
      (nome, nome_mae, cpf, data_admissao, data_nascimento, email, telefone,
       unidade, situacao, origem, criado_por)
    values (
      trim(p->>'nome'),
      nullif(trim(coalesce(p->>'nome_mae','')),''),
      public.colab_norm_cpf(p->>'cpf'),
      nullif(p->>'data_admissao','')::date,
      nullif(p->>'data_nascimento','')::date,
      nullif(trim(coalesce(p->>'email','')),''),
      public.colab_norm_fone(p->>'telefone'),
      nullif(trim(coalesce(p->>'unidade','')),''),
      coalesce(nullif(p->>'situacao',''),'Ativo'),
      coalesce(nullif(p->>'origem',''),'manual'),
      public.colab_email_atual()
    )
    returning id into v_id;
    return v_id;
  end if;

  update public.colaboradores set
    nome            = coalesce(trim(p->>'nome'), nome),
    nome_mae        = case when p ? 'nome_mae' then nullif(trim(coalesce(p->>'nome_mae','')),'') else nome_mae end,
    cpf             = case when p ? 'cpf' then public.colab_norm_cpf(p->>'cpf') else cpf end,
    data_admissao   = case when p ? 'data_admissao' then nullif(p->>'data_admissao','')::date else data_admissao end,
    data_nascimento = case when p ? 'data_nascimento' then nullif(p->>'data_nascimento','')::date else data_nascimento end,
    email           = case when p ? 'email' then nullif(trim(coalesce(p->>'email','')),'') else email end,
    telefone        = case when p ? 'telefone' then public.colab_norm_fone(p->>'telefone') else telefone end,
    unidade         = case when p ? 'unidade' then nullif(trim(coalesce(p->>'unidade','')),'') else unidade end,
    situacao        = case when p ? 'situacao' then coalesce(nullif(p->>'situacao',''), situacao) else situacao end
  where id = v_id;

  if not found then raise exception 'Colaborador não encontrado.'; end if;
  return v_id;
end $$;


-- ---- atualização cadastral rápida (telefone / e-mail) -----------
-- Liberada também para o gestor da unidade: é o item 9 do escopo.
create or replace function public.colab_atualizar_contato(
  p_id uuid, p_email text, p_telefone text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare c public.colaboradores;
begin
  select * into c from public.colaboradores where id = p_id;
  if not found then raise exception 'Colaborador não encontrado.'; end if;
  perform public.colab_exigir(public.colab_pode_operar(c.unidade),
    'Sem permissão para atualizar o contato deste colaborador.');

  update public.colaboradores set
    email    = nullif(trim(coalesce(p_email,'')),''),
    telefone = public.colab_norm_fone(p_telefone)
  where id = p_id;

  return jsonb_build_object(
    'email_anterior', c.email, 'telefone_anterior', c.telefone,
    'email_novo', nullif(trim(coalesce(p_email,'')),''),
    'telefone_novo', public.colab_norm_fone(p_telefone));
end $$;


-- ---- importação em lote ----------------------------------------
-- A tela já validou e já perguntou o que atualizar. Aqui só entra o
-- que o usuário confirmou: em 'atualizar', apenas os campos listados
-- em `campos` são tocados. Nada é sobrescrito por conta própria.
create or replace function public.colab_importar(p_registros jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r jsonb; campos text[]; v_id uuid;
  n_ins int := 0; n_upd int := 0; n_erro int := 0;
  erros jsonb := '[]'::jsonb;
begin
  perform public.colab_exigir(public.colab_e_rh(),
    'Somente RH ou administrador pode importar planilha.');

  for r in select * from jsonb_array_elements(p_registros) loop
    begin
      if coalesce(r->>'acao','inserir') = 'atualizar' then
        v_id := (r->>'id')::uuid;
        campos := coalesce(
          (select array_agg(value::text) from jsonb_array_elements_text(r->'campos') as t(value)),
          array[]::text[]);

        update public.colaboradores c set
          nome            = case when 'nome'            = any(campos) then trim(r->>'nome') else c.nome end,
          nome_mae        = case when 'nome_mae'        = any(campos) then nullif(trim(coalesce(r->>'nome_mae','')),'') else c.nome_mae end,
          cpf             = case when 'cpf'             = any(campos) then public.colab_norm_cpf(r->>'cpf') else c.cpf end,
          data_admissao   = case when 'data_admissao'   = any(campos) then nullif(r->>'data_admissao','')::date else c.data_admissao end,
          data_nascimento = case when 'data_nascimento' = any(campos) then nullif(r->>'data_nascimento','')::date else c.data_nascimento end,
          email           = case when 'email'           = any(campos) then nullif(trim(coalesce(r->>'email','')),'') else c.email end,
          telefone        = case when 'telefone'        = any(campos) then public.colab_norm_fone(r->>'telefone') else c.telefone end,
          unidade         = case when 'unidade'         = any(campos) then nullif(trim(coalesce(r->>'unidade','')),'') else c.unidade end
        where c.id = v_id;

        if found then n_upd := n_upd + 1; end if;
      else
        insert into public.colaboradores
          (nome, nome_mae, cpf, data_admissao, data_nascimento, email, telefone,
           unidade, situacao, origem, criado_por)
        values (
          trim(r->>'nome'),
          nullif(trim(coalesce(r->>'nome_mae','')),''),
          public.colab_norm_cpf(r->>'cpf'),
          nullif(r->>'data_admissao','')::date,
          nullif(r->>'data_nascimento','')::date,
          nullif(trim(coalesce(r->>'email','')),''),
          public.colab_norm_fone(r->>'telefone'),
          nullif(trim(coalesce(r->>'unidade','')),''),
          coalesce(nullif(r->>'situacao',''),'Ativo'),
          'importacao',
          public.colab_email_atual()
        );
        n_ins := n_ins + 1;
      end if;
    exception when others then
      n_erro := n_erro + 1;
      erros := erros || jsonb_build_object(
        'linha', r->>'linha', 'nome', r->>'nome', 'erro', sqlerrm);
    end;
  end loop;

  insert into public.colab_auditoria (acao, detalhe, usuario_email, usuario_id)
  values ('importacao',
          format('inseridos=%s atualizados=%s recusados=%s', n_ins, n_upd, n_erro),
          public.colab_email_atual(), auth.uid());

  return jsonb_build_object('inseridos', n_ins, 'atualizados', n_upd,
                            'recusados', n_erro, 'erros', erros);
end $$;


-- ---- decisões do contrato de experiência -----------------------
create or replace function public.colab_decisao_p1(
  p_id uuid, p_decisao text, p_obs text
) returns text language plpgsql security definer set search_path = public as $$
declare c public.colaboradores;
begin
  select * into c from public.colaboradores where id = p_id;
  if not found then raise exception 'Colaborador não encontrado.'; end if;
  perform public.colab_exigir(public.colab_pode_operar(c.unidade),
    'Sem permissão para decidir sobre este colaborador.');
  if p_decisao not in ('aprovado','reprovado','pendente') then
    raise exception 'Decisão inválida: %', p_decisao;
  end if;
  if c.renovacao_confirmada_em is not null and p_decisao <> 'aprovado' then
    raise exception 'A renovação já foi confirmada. Para encerrar agora, use o encerramento de contrato.';
  end if;

  if p_decisao = 'pendente' then
    update public.colaboradores set
      p1_decisao = null, p1_decidido_em = null, p1_por = null,
      p1_obs = nullif(trim(coalesce(p_obs,'')),'')
    where id = p_id;
  elsif p_decisao = 'reprovado' then
    update public.colaboradores set
      p1_decisao = 'reprovado', p1_decidido_em = now(),
      p1_por = public.colab_email_atual(),
      p1_obs = nullif(trim(coalesce(p_obs,'')),''),
      data_encerramento = coalesce(data_encerramento, c.exp_fim_p1),
      encerramento_motivo = 'Reprovado no 1º período de experiência',
      situacao = 'Inativo',
      data_desligamento = coalesce(data_desligamento, c.exp_fim_p1)
    where id = p_id;
  else
    update public.colaboradores set
      p1_decisao = 'aprovado', p1_decidido_em = now(),
      p1_por = public.colab_email_atual(),
      p1_obs = nullif(trim(coalesce(p_obs,'')),'')
    where id = p_id;
  end if;

  insert into public.colab_decisoes
    (colaborador_id, periodo, decisao, observacao, usuario_email, usuario_id)
  values (p_id, 1, p_decisao, nullif(trim(coalesce(p_obs,'')),''),
          public.colab_email_atual(), auth.uid());

  return p_decisao;
end $$;


create or replace function public.colab_confirmar_renovacao(p_id uuid, p_obs text)
returns date language plpgsql security definer set search_path = public as $$
declare c public.colaboradores;
begin
  select * into c from public.colaboradores where id = p_id;
  if not found then raise exception 'Colaborador não encontrado.'; end if;
  perform public.colab_exigir(public.colab_pode_operar(c.unidade),
    'Sem permissão para confirmar a renovação deste colaborador.');
  if c.p1_decisao <> 'aprovado' then
    raise exception 'A renovação só pode ser confirmada depois da aprovação no 1º período.';
  end if;
  if c.renovacao_confirmada_em is not null then
    raise exception 'A renovação já estava confirmada.';
  end if;

  update public.colaboradores set
    renovacao_confirmada_em = now(),
    renovacao_por = public.colab_email_atual()
  where id = p_id;

  insert into public.colab_decisoes
    (colaborador_id, periodo, decisao, observacao, usuario_email, usuario_id)
  values (p_id, 1, 'renovacao_confirmada', nullif(trim(coalesce(p_obs,'')),''),
          public.colab_email_atual(), auth.uid());

  return c.exp_fim_p2;   -- 90º dia contado da admissão
end $$;


create or replace function public.colab_decisao_p2(
  p_id uuid, p_decisao text, p_obs text, p_data_encerramento date default null
) returns text language plpgsql security definer set search_path = public as $$
declare c public.colaboradores;
begin
  select * into c from public.colaboradores where id = p_id;
  if not found then raise exception 'Colaborador não encontrado.'; end if;
  perform public.colab_exigir(public.colab_pode_operar(c.unidade),
    'Sem permissão para decidir sobre este colaborador.');
  if p_decisao not in ('efetivado','encerrado','pendente') then
    raise exception 'Decisão inválida: %', p_decisao;
  end if;
  if p_decisao <> 'pendente' and c.renovacao_confirmada_em is null then
    raise exception 'Confirme a renovação do período de experiência antes da decisão final.';
  end if;

  if p_decisao = 'pendente' then
    update public.colaboradores set
      p2_decisao = null, p2_decidido_em = null, p2_por = null,
      p2_obs = nullif(trim(coalesce(p_obs,'')),'')
    where id = p_id;
  elsif p_decisao = 'efetivado' then
    update public.colaboradores set
      p2_decisao = 'efetivado', p2_decidido_em = now(),
      p2_por = public.colab_email_atual(),
      p2_obs = nullif(trim(coalesce(p_obs,'')),''),
      situacao = 'Ativo'
    where id = p_id;
  else
    update public.colaboradores set
      p2_decisao = 'encerrado', p2_decidido_em = now(),
      p2_por = public.colab_email_atual(),
      p2_obs = nullif(trim(coalesce(p_obs,'')),''),
      data_encerramento = coalesce(p_data_encerramento, c.exp_fim_p2),
      encerramento_motivo = 'Reprovado no 2º período de experiência',
      situacao = 'Inativo',
      data_desligamento = coalesce(p_data_encerramento, c.exp_fim_p2)
    where id = p_id;
  end if;

  insert into public.colab_decisoes
    (colaborador_id, periodo, decisao, observacao, usuario_email, usuario_id)
  values (p_id, 2, p_decisao, nullif(trim(coalesce(p_obs,'')),''),
          public.colab_email_atual(), auth.uid());

  return p_decisao;
end $$;


-- Encerramento avulso (fora dos dois pontos de decisão).
create or replace function public.colab_encerrar(
  p_id uuid, p_data date, p_motivo text, p_obs text
) returns date language plpgsql security definer set search_path = public as $$
declare c public.colaboradores;
begin
  select * into c from public.colaboradores where id = p_id;
  if not found then raise exception 'Colaborador não encontrado.'; end if;
  perform public.colab_exigir(public.colab_e_rh(),
    'Somente RH ou administrador pode encerrar contrato fora das decisões de experiência.');

  update public.colaboradores set
    data_encerramento = coalesce(p_data, current_date),
    data_desligamento = coalesce(p_data, current_date),
    encerramento_motivo = nullif(trim(coalesce(p_motivo,'')),''),
    situacao = 'Inativo'
  where id = p_id;

  insert into public.colab_decisoes
    (colaborador_id, periodo, decisao, observacao, usuario_email, usuario_id)
  values (p_id, 0, 'encerrado', nullif(trim(coalesce(p_obs,'')),''),
          public.colab_email_atual(), auth.uid());

  return coalesce(p_data, current_date);
end $$;


-- ---- regularização do histórico na implantação ------------------
-- Importar o cadastro antigo traz gente admitida há anos, sem nenhuma
-- decisão registrada. Elas ficariam para sempre como "aguardando
-- decisão do 1º período". Esta função efetiva em lote, mas só quem já
-- passou do 90º dia com folga (p_dias_margem) — e grava a decisão com
-- autor, data e observação, como qualquer outra. Nada é deduzido pelo
-- sistema por conta própria: alguém do RH tem de mandar.
create or replace function public.colab_regularizar_historico(
  p_ids uuid[], p_obs text, p_dias_margem int default 30
) returns jsonb language plpgsql security definer set search_path = public as $$
declare v_id uuid; n int := 0; ignorados int := 0; c public.colaboradores;
begin
  perform public.colab_exigir(public.colab_e_rh(),
    'Somente RH ou administrador pode regularizar o histórico.');

  foreach v_id in array coalesce(p_ids, array[]::uuid[]) loop
    select * into c from public.colaboradores where id = v_id;
    if not found
       or c.p1_decisao is not null
       or c.p2_decisao is not null
       or c.data_encerramento is not null
       or c.situacao <> 'Ativo'
       or c.exp_fim_p2 is null
       or c.exp_fim_p2 >= current_date - coalesce(p_dias_margem, 30) then
      ignorados := ignorados + 1;
      continue;
    end if;

    update public.colaboradores set
      p1_decisao = 'aprovado',
      p1_decidido_em = now(),
      p1_por = public.colab_email_atual(),
      renovacao_confirmada_em = now(),
      renovacao_por = public.colab_email_atual(),
      p2_decisao = 'efetivado',
      p2_decidido_em = now(),
      p2_por = public.colab_email_atual(),
      p2_obs = nullif(trim(coalesce(p_obs,'')),'')
    where id = v_id;

    insert into public.colab_decisoes
      (colaborador_id, periodo, decisao, observacao, usuario_email, usuario_id)
    values
      (v_id, 1, 'aprovado',
       'Regularização de histórico na implantação do módulo. ' || coalesce(p_obs,''),
       public.colab_email_atual(), auth.uid()),
      (v_id, 1, 'renovacao_confirmada',
       'Regularização de histórico na implantação do módulo.',
       public.colab_email_atual(), auth.uid()),
      (v_id, 2, 'efetivado',
       'Regularização de histórico na implantação do módulo. Contrato de experiência '
       || 'encerrado em ' || to_char(c.exp_fim_p2, 'DD/MM/YYYY')
       || ', antes da adoção deste controle. ' || coalesce(p_obs,''),
       public.colab_email_atual(), auth.uid());

    n := n + 1;
  end loop;

  insert into public.colab_auditoria (acao, detalhe, usuario_email, usuario_id)
  values ('alteracao',
          format('regularizacao de historico: %s efetivado(s), %s ignorado(s)', n, ignorados),
          public.colab_email_atual(), auth.uid());

  return jsonb_build_object('efetivados', n, 'ignorados', ignorados);
end $$;


-- ---- folga de aniversário --------------------------------------
create or replace function public.colab_folga(
  p_id uuid, p_status text, p_data date, p_obs text,
  p_ano int, p_excepcional boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c public.colaboradores; mes_aniv int; conflitos int := 0;
begin
  select * into c from public.colaboradores where id = p_id;
  if not found then raise exception 'Colaborador não encontrado.'; end if;
  perform public.colab_exigir(public.colab_pode_operar(c.unidade),
    'Sem permissão para tratar a folga deste colaborador.');
  if p_status not in ('nao_analisada','aguardando_aprovacao','aprovada','agendada',
                      'realizada','recusada','nao_se_aplica','reagendada_excepcional') then
    raise exception 'Status de folga inválido: %', p_status;
  end if;

  -- A folga tem de cair no mês do aniversário. Fora dele, só com a
  -- marca de exceção — que fica registrada, não some.
  if p_data is not null and c.data_nascimento is not null then
    mes_aniv := extract(month from c.data_nascimento);
    if extract(month from p_data) <> mes_aniv then
      if not coalesce(p_excepcional, false) then
        raise exception 'A folga precisa acontecer no mês do aniversário (mês %). Para outra data, marque como exceção autorizada.', mes_aniv;
      end if;
    end if;
  end if;

  if p_data is not null then
    select count(*) into conflitos
    from public.colaboradores o
    where o.id <> p_id
      and o.folga_data = p_data
      and o.unidade is not distinct from c.unidade
      and o.folga_status in ('aprovada','agendada','realizada','reagendada_excepcional');
  end if;

  update public.colaboradores set
    folga_status = case when coalesce(p_excepcional,false) and p_status = 'agendada'
                        then 'reagendada_excepcional' else p_status end,
    folga_data   = p_data,
    folga_ano    = coalesce(p_ano, extract(year from coalesce(p_data, current_date))::int),
    folga_obs    = nullif(trim(coalesce(p_obs,'')),''),
    folga_excepcional = coalesce(p_excepcional, false),
    folga_aprovada_por = case when p_status in ('aprovada','agendada','realizada','reagendada_excepcional')
                              then public.colab_email_atual() else folga_aprovada_por end,
    folga_aprovada_em  = case when p_status in ('aprovada','agendada','realizada','reagendada_excepcional')
                              then now() else folga_aprovada_em end
  where id = p_id;

  return jsonb_build_object('conflitos_mesma_data_unidade', conflitos);
end $$;


-- ---- mensagem de aniversário -----------------------------------
create or replace function public.colab_msg_aniv(p_id uuid, p_ano int)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare c public.colaboradores;
begin
  select * into c from public.colaboradores where id = p_id;
  if not found then raise exception 'Colaborador não encontrado.'; end if;
  perform public.colab_exigir(public.colab_pode_operar(c.unidade),
    'Sem permissão para registrar o envio da mensagem deste colaborador.');

  update public.colaboradores set
    aniv_msg_ano = coalesce(p_ano, extract(year from current_date)::int),
    aniv_msg_em  = now(),
    aniv_msg_por = public.colab_email_atual()
  where id = p_id;

  return now();
end $$;


-- ---- notificações ----------------------------------------------
create or replace function public.colab_notificar(
  p_id uuid, p_tipo text, p_ref text, p_acao text,
  p_ate timestamptz default null, p_resolucao text default null
) returns void language plpgsql security definer set search_path = public as $$
declare c public.colaboradores;
begin
  select * into c from public.colaboradores where id = p_id;
  if not found then raise exception 'Colaborador não encontrado.'; end if;
  perform public.colab_exigir(public.colab_pode_operar(c.unidade),
    'Sem permissão sobre as notificações deste colaborador.');

  insert into public.colab_notificacoes
    (colaborador_id, tipo, referencia, usuario_email,
     lida_em, adiada_para, resolvida_em, resolucao)
  values (p_id, p_tipo, coalesce(nullif(p_ref,''),'-'), public.colab_email_atual(),
     case when p_acao in ('ler','resolver') then now() end,
     case when p_acao = 'adiar' then p_ate end,
     case when p_acao = 'resolver' then now() end,
     case when p_acao = 'resolver' then nullif(trim(coalesce(p_resolucao,'')),'') end)
  on conflict (colaborador_id, tipo, referencia) do update set
     usuario_email = public.colab_email_atual(),
     lida_em      = case when p_acao in ('ler','resolver') then now()
                         when p_acao = 'reabrir' then null
                         else public.colab_notificacoes.lida_em end,
     adiada_para  = case when p_acao = 'adiar' then p_ate
                         when p_acao in ('reabrir','resolver') then null
                         else public.colab_notificacoes.adiada_para end,
     resolvida_em = case when p_acao = 'resolver' then now()
                         when p_acao = 'reabrir' then null
                         else public.colab_notificacoes.resolvida_em end,
     resolucao    = case when p_acao = 'resolver' then nullif(trim(coalesce(p_resolucao,'')),'')
                         when p_acao = 'reabrir' then null
                         else public.colab_notificacoes.resolucao end;
end $$;


-- ---- exclusão (só admin) ---------------------------------------
create or replace function public.colab_excluir(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.colab_exigir(coalesce(public.colab_perfil() = 'admin', false),
    'Somente o administrador pode excluir um colaborador.');
  delete from public.colaboradores where id = p_id;
end $$;


-- ---- configuração (só admin) -----------------------------------
create or replace function public.colab_config_salvar(p jsonb)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.colab_exigir(coalesce(public.colab_perfil() = 'admin', false),
    'Somente o administrador pode alterar a configuração do módulo.');

  update public.colab_config set
    empresa_nome   = coalesce(p->>'empresa_nome', empresa_nome),
    empresa_cidade = coalesce(p->>'empresa_cidade', empresa_cidade),
    resp_nome      = coalesce(p->>'resp_nome', resp_nome),
    resp_cargo     = coalesce(p->>'resp_cargo', resp_cargo),
    dias_aviso_p1  = coalesce((p->>'dias_aviso_p1')::int, dias_aviso_p1),
    dias_aviso_p2  = coalesce((p->>'dias_aviso_p2')::int, dias_aviso_p2),
    dias_aviso_aniv= coalesce((p->>'dias_aviso_aniv')::int, dias_aviso_aniv),
    politica_folga_ativa = coalesce((p->>'politica_folga_ativa')::boolean, politica_folga_ativa),
    msg_aniversario = coalesce(p->>'msg_aniversario', msg_aniversario),
    termo_modelo    = coalesce(p->>'termo_modelo', termo_modelo)
  where id = 1;
end $$;


-- ---- registro de exportação e de documento gerado --------------
-- O escopo pede confirmação antes de exportar; aqui fica o rastro.
create or replace function public.colab_registrar_exportacao(p_qtd int, p_escopo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.colab_exigir(public.colab_e_rh(),
    'Somente RH ou administrador pode exportar dados de colaboradores.');
  insert into public.colab_auditoria (acao, detalhe, usuario_email, usuario_id)
  values ('exportacao', format('%s registro(s) — %s', coalesce(p_qtd,0), coalesce(p_escopo,'-')),
          public.colab_email_atual(), auth.uid());
end $$;

create or replace function public.colab_registrar_documento(p_id uuid, p_tipo text)
returns void language plpgsql security definer set search_path = public as $$
declare c public.colaboradores;
begin
  select * into c from public.colaboradores where id = p_id;
  if not found then raise exception 'Colaborador não encontrado.'; end if;
  perform public.colab_exigir(public.colab_e_rh(),
    'Somente RH ou administrador pode gerar documentos.');
  insert into public.colab_auditoria
    (colaborador_id, colaborador_nome, acao, detalhe, usuario_email, usuario_id)
  values (p_id, c.nome, 'documento', p_tipo, public.colab_email_atual(), auth.uid());
end $$;


-- ---- histórico de um colaborador (auditoria + decisões) --------
-- Gestor recebe o histórico sem os valores de CPF e nome da mãe.
create or replace function public.colab_historico(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.colaboradores; sensivel boolean := public.colab_ve_sensivel();
begin
  select * into c from public.colaboradores where id = p_id;
  if not found then raise exception 'Colaborador não encontrado.'; end if;
  perform public.colab_exigir(public.colab_pode_operar(c.unidade),
    'Sem permissão para ver o histórico deste colaborador.');

  return jsonb_build_object(
    'decisoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'periodo', d.periodo, 'decisao', d.decisao, 'observacao', d.observacao,
        'usuario', d.usuario_email, 'em', d.criado_em) order by d.criado_em desc)
      from public.colab_decisoes d where d.colaborador_id = p_id), '[]'::jsonb),
    'alteracoes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'acao', a.acao, 'campo', a.campo,
        'de', case when sensivel or a.campo not in ('cpf','nome_mae')
                   then a.valor_anterior else '(oculto)' end,
        'para', case when sensivel or a.campo not in ('cpf','nome_mae')
                     then a.valor_novo else '(oculto)' end,
        'detalhe', a.detalhe, 'usuario', a.usuario_email, 'em', a.criado_em)
        order by a.criado_em desc)
      from public.colab_auditoria a where a.colaborador_id = p_id), '[]'::jsonb)
  );
end $$;


-- -----------------------------------------------------------------
-- 15) Permissões de execução
-- -----------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'colab_meu_contexto()',
    'colab_salvar(jsonb)',
    'colab_atualizar_contato(uuid,text,text)',
    'colab_importar(jsonb)',
    'colab_decisao_p1(uuid,text,text)',
    'colab_confirmar_renovacao(uuid,text)',
    'colab_decisao_p2(uuid,text,text,date)',
    'colab_encerrar(uuid,date,text,text)',
    'colab_regularizar_historico(uuid[],text,int)',
    'colab_folga(uuid,text,date,text,int,boolean)',
    'colab_msg_aniv(uuid,int)',
    'colab_notificar(uuid,text,text,text,timestamptz,text)',
    'colab_excluir(uuid)',
    'colab_config_salvar(jsonb)',
    'colab_registrar_exportacao(int,text)',
    'colab_registrar_documento(uuid,text)',
    'colab_historico(uuid)',
    'colab_perfil()','colab_unidade()','colab_ve_sensivel()','colab_e_rh()',
    'colab_pode_operar(text)','colab_contrato_status(date,text,timestamptz,text,date,int,int,date)',
    'colab_cpf_valido(text)','colab_mascara_cpf(text)',
    'colab_norm_fone(text)','colab_norm_cpf(text)'
  ] loop
    execute format('revoke all on function public.%s from anon, public', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;


-- -----------------------------------------------------------------
-- 16) Tempo real (só chega para quem pode ler a tabela: RH/admin)
-- -----------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.colaboradores;
  exception when duplicate_object then null;
  end;
end $$;


-- =================================================================
-- 17) Conferência
-- =================================================================

-- (a) RLS ligada em todas as tabelas novas?
select tablename, rowsecurity as rls_ativo
from pg_tables
where schemaname = 'public'
  and tablename in ('colaboradores','colab_decisoes','colab_auditoria',
                    'colab_notificacoes','colab_config','colab_perfis')
order by tablename;

-- (b) Quem tem acesso ao módulo?
--     Lista TODOS os usuários e mostra quem ficou sem perfil. Se a coluna
--     `perfil` vier nula para o seu e-mail, é essa a causa do "acesso negado":
--     o módulo nega por padrão a quem não está aqui.
select
  u.email                        as email_em_auth_users,
  coalesce(p.perfil, '— SEM PERFIL: não entra no módulo —') as perfil,
  coalesce(p.unidade, '(todas)') as unidade,
  p.criado_em
from auth.users u
left join public.colab_perfis p on p.user_id = u.id
order by (p.perfil is null) desc, u.email;

-- (c) A conta de dias está certa? Devem sair 30 e 90.
select
  '2026-01-31'::date                                  as admissao,
  public.colab_contrato_status('2026-01-31', null, null, null, null, 7, 7, '2026-02-01') as status_em_01_02,
  '2026-01-31'::date + 29                             as fim_1o_periodo,
  ('2026-01-31'::date + 29) - '2026-01-31'::date + 1   as dias_1o_periodo,
  '2026-01-31'::date + 89                             as fim_contrato,
  ('2026-01-31'::date + 89) - '2026-01-31'::date + 1   as dias_totais;

-- (d) Validação de CPF: deve dar true, false, false.
select public.colab_cpf_valido('529.982.247-25') as valido,
       public.colab_cpf_valido('529.982.247-26') as digito_errado,
       public.colab_cpf_valido('111.111.111-11') as repetido;

-- =================================================================
-- AINDA FALTA FAZER NO PAINEL
--
-- 1. Conferir que o cadastro público continua fechado:
--    Authentication -> Sign In / Providers -> Email
--    -> "Allow new users to sign up" DESLIGADO.
--    (Este módulo guarda CPF e nome da mãe. Com cadastro aberto,
--     a chave publishable que está no código do site viraria porta
--     de entrada — as policies acima seguram, mas não conte com uma
--     trava só.)
--
-- 2. Para liberar mais alguém:
--      insert into public.colab_perfis (user_id, email, perfil, unidade)
--      select id, email, 'gestor', 'CL ITAIM'
--      from auth.users where email = 'pessoa@cajupar.com'
--      on conflict (user_id) do update
--        set perfil = excluded.perfil, unidade = excluded.unidade;
--
-- 3. Para tirar o acesso de alguém (sem apagar o usuário):
--      delete from public.colab_perfis
--      where user_id = (select id from auth.users where email = 'pessoa@cajupar.com');
--
-- 4. Preencher em Configurações, na tela do módulo: nome da empresa,
--    cidade, responsável e cargo. Sem isso o termo de encerramento
--    sai com os campos em branco.
-- =================================================================
