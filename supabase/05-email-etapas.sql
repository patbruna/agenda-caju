-- Agenda de Entrevistas — Grupo Caju
-- MODELOS DE E-MAIL POR ETAPA. Rode depois do 04-perfil.sql.
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- Pode rodar mais de uma vez sem problema: nada é apagado ou duplicado.
--
-- POR QUÊ
-- As mensagens que já existiam são de WhatsApp, e link de WhatsApp não
-- carrega texto longo: o convite da avaliação técnica passa de 4.500
-- caracteres e quebraria. Instruções longas passam a ser e-mail, com
-- assunto próprio. O convite curto de WhatsApp continua valendo como
-- aviso de que o e-mail chegou.
--
-- Duas etapas ganham modelo: a avaliação técnica e a entrevista final.
-- O botão de e-mail só aparece na tela quando o modelo tem texto, então
-- a final fica vazia aqui sem atrapalhar nada até você escrever a dela.

alter table public.configuracoes
  add column if not exists email_tecnica         text not null default '',
  add column if not exists email_tecnica_assunto text not null default '',
  add column if not exists email_final           text not null default '',
  add column if not exists email_final_assunto   text not null default '';

-- ---------------------------------------------------------------
-- Conferência: devem aparecer as quatro colunas.
-- ---------------------------------------------------------------
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='configuracoes'
  and column_name like 'email_%'
order by column_name;
