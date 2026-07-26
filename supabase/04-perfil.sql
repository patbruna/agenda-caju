-- Agenda de Entrevistas — Grupo Caju
-- PERFIL DO CANDIDATO. Rode depois do 03-etapas.sql.
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- Pode rodar mais de uma vez sem problema: nada é apagado ou duplicado.
--
-- O QUE MUDA
-- 1. O candidato deixa de ser uma linha de agenda e passa a ter ficha:
--    contato, endereço, origem da candidatura, experiência e currículo.
-- 2. As observações saem de um campo único e viram um histórico: cada
--    anotação fica carimbada com quem escreveu, quando, e em que etapa.
--    Nada mais é sobrescrito.
-- 3. O currículo passa a ser arquivo de verdade, guardado num bucket
--    PRIVADO. Sem login ninguém alcança, nem com a chave pública do site.

-- ---------------------------------------------------------------
-- 1) Campos da ficha
-- ---------------------------------------------------------------
alter table public.candidatos
  -- contato
  add column if not exists email    text not null default '',
  add column if not exists fone_alt text not null default '',
  -- onde mora (bairro importa: é o que diz se o deslocamento é viável)
  add column if not exists endereco text not null default '',
  add column if not exists bairro   text not null default '',
  add column if not exists cidade   text not null default '',
  -- candidatura
  add column if not exists origem          text not null default '',
  add column if not exists pretensao       numeric(10,2),
  add column if not exists disponibilidade text not null default '',
  -- experiência
  add column if not exists cargo_atual   text not null default '',
  add column if not exists empresa_atual text not null default '',
  add column if not exists experiencia   text not null default '',
  -- pessoais
  add column if not exists nascimento date,
  add column if not exists cpf        text not null default '',
  -- caminho do arquivo dentro do bucket "curriculos"
  add column if not exists curriculo text not null default '';

-- ---------------------------------------------------------------
-- 2) Histórico de anotações
--    Uma linha por observação. Como vocês dois anotam, guardar o autor
--    é o que permite saber de quem é cada leitura do candidato.
-- ---------------------------------------------------------------
create table if not exists public.anotacoes (
  id           uuid primary key default gen_random_uuid(),
  candidato_id uuid not null references public.candidatos(id) on delete cascade,
  etapa        text not null default 'entrevista',
  texto        text not null,
  autor_id     uuid references auth.users(id) on delete set null,
  autor_nome   text not null default '',
  criado_em    timestamptz not null default now()
);

create index if not exists anotacoes_candidato_idx
  on public.anotacoes (candidato_id, criado_em desc);

alter table public.anotacoes enable row level security;

drop policy if exists "rh acessa anotacoes" on public.anotacoes;
create policy "rh acessa anotacoes"
  on public.anotacoes
  for all
  to authenticated
  using (public.tem_acesso())
  with check (public.tem_acesso());

-- Traz para o histórico o que já estava escrito no campo antigo "obs".
-- O "not exists" impede duplicar se este arquivo rodar de novo.
insert into public.anotacoes (candidato_id, etapa, texto, autor_nome, criado_em)
select c.id, c.etapa, c.obs, 'anotação anterior', c.alterado_em
from public.candidatos c
where coalesce(c.obs,'') <> ''
  and not exists (select 1 from public.anotacoes a where a.candidato_id = c.id);

-- A coluna "obs" fica onde está, sem uso. Apagar não traria ganho nenhum
-- e destruiria o texto original caso a importação acima precise ser revista.

-- ---------------------------------------------------------------
-- 3) Currículos — bucket PRIVADO
--    10 MB por arquivo, só PDF, Word e imagem.
-- ---------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('curriculos','curriculos', false, 10485760, array[
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg','image/png','image/webp'
])
on conflict (id) do update set
  public             = false,
  file_size_limit    = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Mesma regra das outras tabelas: só quem está em acessos_permitidos.
drop policy if exists "rh le curriculos"       on storage.objects;
drop policy if exists "rh envia curriculos"    on storage.objects;
drop policy if exists "rh atualiza curriculos" on storage.objects;
drop policy if exists "rh apaga curriculos"    on storage.objects;

create policy "rh le curriculos" on storage.objects
  for select to authenticated
  using (bucket_id = 'curriculos' and public.tem_acesso());

create policy "rh envia curriculos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'curriculos' and public.tem_acesso());

create policy "rh atualiza curriculos" on storage.objects
  for update to authenticated
  using (bucket_id = 'curriculos' and public.tem_acesso())
  with check (bucket_id = 'curriculos' and public.tem_acesso());

create policy "rh apaga curriculos" on storage.objects
  for delete to authenticated
  using (bucket_id = 'curriculos' and public.tem_acesso());

-- ---------------------------------------------------------------
-- 4) Tempo real para o histórico
-- ---------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.anotacoes;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------
-- Conferência
--   1ª tabela: as colunas novas do candidato
--   2ª: o bucket, que precisa vir com public = false
--   3ª: quantas anotações foram trazidas do campo antigo
-- ---------------------------------------------------------------
select column_name, data_type
from information_schema.columns
where table_schema='public' and table_name='candidatos'
  and column_name in ('email','fone_alt','endereco','bairro','cidade','origem',
                      'pretensao','disponibilidade','cargo_atual','empresa_atual',
                      'experiencia','nascimento','cpf','curriculo')
order by column_name;

select id, public, file_size_limit from storage.buckets where id='curriculos';

select count(*) as anotacoes_no_historico from public.anotacoes;
