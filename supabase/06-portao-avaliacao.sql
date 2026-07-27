-- Agenda de Entrevistas — Grupo Caju
-- PORTÃO DA AVALIAÇÃO. Rode depois do 05-email-etapas.sql.
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- Pode rodar mais de uma vez sem problema: nada é apagado ou duplicado.
--
-- O QUE É
-- Uma página pública (avaliacao.html) onde o candidato acompanha a
-- contagem regressiva e recebe o link do formulário no horário DELE.
-- Cada pessoa tem um horário diferente, então a janela é individual:
-- abre no compromisso marcado e fecha 60 minutos depois.
--
-- POR QUE ISTO EXISTE COMO FUNÇÃO, E NÃO COMO PERMISSÃO DE LEITURA
-- O candidato não tem login. Se a tabela de candidatos fosse aberta
-- para anônimo, qualquer pessoa leria a lista inteira. Em vez disso as
-- tabelas continuam trancadas e o site público só enxerga as duas
-- funções abaixo, que rodam como dono (security definer) e devolvem
-- apenas o primeiro nome de UM candidato, o horário dele e o estado da
-- janela.
--
-- Três consequências de propósito:
--   1. A hora é conferida com now() do banco. Mexer no relógio do
--      computador não abre nada antes.
--   2. O endereço do formulário só entra na resposta quando a janela
--      está aberta. Antes disso não há o que espiar no navegador.
--   3. O código do link é um UUID. Trocar um dígito não leva a outro
--      candidato, leva a lugar nenhum.

-- ---------------------------------------------------------------
-- 1) Código do link e registro de abertura
-- ---------------------------------------------------------------
alter table public.candidatos
  add column if not exists token uuid not null default gen_random_uuid(),
  add column if not exists avaliacao_abertura timestamptz;

create unique index if not exists candidatos_token_idx on public.candidatos (token);

-- ---------------------------------------------------------------
-- 2) Onde fica o endereço do formulário de cada etapa
-- ---------------------------------------------------------------
alter table public.configuracoes
  add column if not exists form_tecnica_url text not null default '',
  add column if not exists form_final_url   text not null default '';

-- ---------------------------------------------------------------
-- 3) Estado da janela, para a página pública
-- ---------------------------------------------------------------
create or replace function public.avaliacao_status(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c      record;
  cfg    record;
  inicio timestamptz;
  fim    timestamptz;
  url    text;
  base   jsonb;
begin
  select * into c from public.candidatos where token = p_token;
  if not found then
    return jsonb_build_object('estado','desconhecido');
  end if;

  -- Só o primeiro nome sai daqui. Sobrenome, telefone e e-mail, não.
  base := jsonb_build_object(
    'nome',  split_part(c.nome,' ',1),
    'etapa', c.etapa,
    'agora', now()
  );

  if c.status in ('Reprovado','Recusou') then
    return base || jsonb_build_object('estado','encerrado_processo');
  end if;

  select * into cfg from public.configuracoes where id = 1;
  url := case c.etapa
           when 'tecnica' then cfg.form_tecnica_url
           when 'final'   then cfg.form_final_url
           else '' end;

  if coalesce(url,'') = '' then
    return base || jsonb_build_object('estado','sem_formulario');
  end if;

  if c.data is null or c.hora is null then
    return base || jsonb_build_object('estado','sem_horario');
  end if;

  -- O horário marcado é horário de Brasília, não do relógio de quem abre.
  inicio := (c.data + c.hora) at time zone 'America/Sao_Paulo';
  fim    := inicio + interval '60 minutes';

  base := base || jsonb_build_object('abre_em', inicio, 'fecha_em', fim);

  if now() < inicio then return base || jsonb_build_object('estado','aguardando'); end if;
  if now() > fim    then return base || jsonb_build_object('estado','encerrado');  end if;

  -- O endereço só aparece com a janela aberta.
  return base || jsonb_build_object('estado','aberto','url',url);
end $$;

-- ---------------------------------------------------------------
-- 4) Marca a hora em que o candidato abriu o formulário
--    Grava só a primeira vez, para responder "ele apareceu?".
-- ---------------------------------------------------------------
create or replace function public.avaliacao_registrar_abertura(p_token uuid)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  update public.candidatos
     set avaliacao_abertura = coalesce(avaliacao_abertura, now())
   where token = p_token
     and data is not null and hora is not null
     and now() between (data + hora) at time zone 'America/Sao_Paulo'
                   and ((data + hora) at time zone 'America/Sao_Paulo') + interval '60 minutes';
end $$;

-- ---------------------------------------------------------------
-- 5) Quem pode chamar
--    Anônimo alcança as funções e nada além delas.
-- ---------------------------------------------------------------
revoke all on function public.avaliacao_status(uuid) from public;
revoke all on function public.avaliacao_registrar_abertura(uuid) from public;
grant execute on function public.avaliacao_status(uuid) to anon, authenticated;
grant execute on function public.avaliacao_registrar_abertura(uuid) to anon, authenticated;

-- ---------------------------------------------------------------
-- Conferência
--   1ª: as colunas novas
--   2ª: as duas funções, que precisam vir com security_type = DEFINER
--   3ª: teste real do portão com um candidato existente — o estado
--       esperado é "sem_formulario" enquanto você não colar o endereço
--       do Google Forms na tela de mensagens do app.
-- ---------------------------------------------------------------
select column_name from information_schema.columns
where table_schema='public' and table_name='candidatos'
  and column_name in ('token','avaliacao_abertura')
order by column_name;

select routine_name, security_type
from information_schema.routines
where routine_schema='public'
  and routine_name in ('avaliacao_status','avaliacao_registrar_abertura');

select public.avaliacao_status((select token from public.candidatos limit 1));
