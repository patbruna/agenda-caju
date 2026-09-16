-- Agenda de Entrevistas — Grupo Caju
-- FORMATOS DA ARTE: cada imagem sabe para onde foi feita.
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- Pode rodar mais de uma vez sem problema: nada é apagado ou duplicado.
-- Não mexe em nada do módulo de colaboradores.
--
-- POR QUÊ
-- A mesma vaga tem três artes diferentes: a do WhatsApp (que serve
-- também no LinkedIn), a do story em pé e a do feed do Instagram, que
-- é quadrada. Sem separar, todas ficavam no mesmo monte e na hora de
-- postar era preciso abrir uma por uma para achar a certa.

-- -----------------------------------------------------------------
-- 1) O formato
--    'whats' é o padrão porque é a arte que serve em mais lugar.
--    'outro' existe para o que não se encaixa, e para não travar
--    ninguém que queira guardar uma peça fora de padrão.
-- -----------------------------------------------------------------
alter table public.posts_imagens
  add column if not exists formato text not null default 'whats';

alter table public.posts_imagens
  drop constraint if exists posts_imagens_formato_ck;

alter table public.posts_imagens
  add constraint posts_imagens_formato_ck
  check (formato in ('whats','story','feed','outro'));

create index if not exists posts_img_formato_idx
  on public.posts_imagens (post_id, formato, ordem);

-- -----------------------------------------------------------------
-- 2) As medidas
--    Guardadas no envio para a tela poder avisar "essa aqui não é
--    quadrada, o Instagram vai cortar" sem ter que baixar a imagem
--    de novo toda vez que a página abre.
-- -----------------------------------------------------------------
alter table public.posts_imagens
  add column if not exists largura int;

alter table public.posts_imagens
  add column if not exists altura int;

-- -----------------------------------------------------------------
-- Conferência
--   As colunas novas, e como as artes de hoje estão distribuídas.
-- -----------------------------------------------------------------
select column_name, data_type, column_default
  from information_schema.columns
 where table_schema = 'public'
   and table_name = 'posts_imagens'
   and column_name in ('formato','largura','altura')
 order by column_name;

select formato, count(*) as artes
  from public.posts_imagens
 group by 1
 order by 1;
