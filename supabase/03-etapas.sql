-- Agenda de Entrevistas — Grupo Caju
-- ETAPAS DO PROCESSO SELETIVO. Rode depois do 02-seguranca.sql.
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- Pode rodar mais de uma vez sem problema: nada é apagado ou duplicado.
--
-- O QUE MUDA
-- Até aqui "Aprovado" era fim de linha. O processo, na prática, tem três
-- etapas: entrevista, avaliação técnica e entrevista final com os sócios.
--
-- A coluna "status" passa a valer DENTRO da etapa. A mesma pessoa pode ter
-- sido Aprovada na entrevista e estar Pendente na avaliação técnica. Quem é
-- Reprovado ou Recusa fica parado na etapa em que estava — assim dá para
-- saber ONDE cada candidato saiu, não apenas que saiu.
--
-- Nada aqui apaga dado existente. Todos os candidatos de hoje continuam na
-- etapa "entrevista", que é exatamente onde estão.

-- ---------------------------------------------------------------
-- 1) Em que etapa cada candidato está
-- ---------------------------------------------------------------
alter table public.candidatos
  add column if not exists etapa text not null default 'entrevista';

do $$
begin
  alter table public.candidatos
    add constraint candidatos_etapa_valida
    check (etapa in ('entrevista','tecnica','final','contratado'));
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------------
-- 2) Campos da avaliação técnica
--    "nota" fica sem limite de propósito: o formato da avaliação
--    ainda não está definido, e um teto gravado aqui só poderia ser
--    mudado por SQL depois. A tela sugere 0 a 10, mas aceita outra
--    escala se você decidir usar.
-- ---------------------------------------------------------------
alter table public.candidatos
  add column if not exists nota numeric(6,2),
  add column if not exists link text not null default '',
  add column if not exists obs  text not null default '';

-- ---------------------------------------------------------------
-- 3) Mensagens de WhatsApp por etapa
--    Cada etapa tem convite próprio: chamar alguém para uma avaliação
--    técnica com o texto de convite de entrevista sai errado.
--    As duas que já existiam continuam valendo:
--      msg_aprovacao  -> aprovado na ENTREVISTA
--      msg_reprovacao -> reprovado em QUALQUER etapa
-- ---------------------------------------------------------------
alter table public.configuracoes
  add column if not exists msg_convite_entrevista text not null default '',
  add column if not exists msg_convite_tecnica    text not null default '',
  add column if not exists msg_convite_final      text not null default '',
  add column if not exists msg_aprov_tecnica      text not null default '',
  add column if not exists msg_contratado         text not null default '';

-- ---------------------------------------------------------------
-- Conferência: deve listar as colunas novas e a contagem por etapa.
-- ---------------------------------------------------------------
select column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and table_name = 'candidatos'
  and column_name in ('etapa','nota','link','obs')
order by column_name;

select etapa, count(*) as candidatos
from public.candidatos
group by etapa
order by etapa;
