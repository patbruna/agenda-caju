-- Agenda de Entrevistas — Grupo Caju
-- DIVULGAÇÃO: a biblioteca de posts de vaga.
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- Pode rodar mais de uma vez sem problema: nada é apagado ou duplicado.
-- Não mexe em nada do módulo de colaboradores.
--
-- POR QUÊ
-- Hoje a legenda de cada vaga é reescrita toda vez que o anúncio volta
-- para o ar, e a versão boa se perde no meio das conversas. Aqui o post
-- é cadastrado uma vez: legenda-base, arte e, se precisar, uma versão
-- própria para cada canal. Na hora de divulgar é só copiar.

-- -----------------------------------------------------------------
-- 1) O post
--    A legenda-base é a fonte da verdade. txt_email, txt_whats e
--    txt_linkedin ficam NULOS enquanto a base servir para os três —
--    só ganham conteúdo quando você edita aquele canal em particular.
--    Nulo e string vazia querem dizer coisas diferentes aqui:
--    nulo = "usa a base", vazio = "este canal fica em branco".
--
--    cargo e unidade são o que {CARGO} e {UNIDADE} viram na cópia.
--    São apenas o valor padrão: na tela dá para trocar antes de copiar,
--    que é como um mesmo post serve BH e Asa Sul sem virar dois.
-- -----------------------------------------------------------------
create table if not exists public.posts_divulgacao (
  id            uuid primary key default gen_random_uuid(),
  titulo        text not null default '',
  cargo         text not null default '',
  unidade       text not null default '',
  legenda       text not null default '',
  assunto_email text not null default '',
  hashtags      text not null default '',
  txt_email     text,
  txt_whats     text,
  txt_linkedin  text,
  arquivado     boolean not null default false,
  criado_em     timestamptz not null default now(),
  autor         text not null default ''
);

create index if not exists posts_div_cargo_idx on public.posts_divulgacao (cargo);

alter table public.posts_divulgacao enable row level security;
drop policy if exists "rh acessa posts" on public.posts_divulgacao;
create policy "rh acessa posts" on public.posts_divulgacao
  for all to authenticated
  using (public.tem_acesso()) with check (public.tem_acesso());

-- -----------------------------------------------------------------
-- 2) As artes
--    Um post pode ter mais de uma imagem (feed, stories, a versão do
--    mês passado). Cada linha é OU um arquivo no bucket (caminho) OU
--    um endereço de fora, do Drive ou do Canva (url).
-- -----------------------------------------------------------------
create table if not exists public.posts_imagens (
  id        uuid primary key default gen_random_uuid(),
  post_id   uuid not null references public.posts_divulgacao(id) on delete cascade,
  caminho   text not null default '',
  url       text not null default '',
  ordem     int  not null default 1,
  criado_em timestamptz not null default now()
);

create index if not exists posts_img_post_idx on public.posts_imagens (post_id, ordem);

alter table public.posts_imagens enable row level security;
drop policy if exists "rh acessa imagens de post" on public.posts_imagens;
create policy "rh acessa imagens de post" on public.posts_imagens
  for all to authenticated
  using (public.tem_acesso()) with check (public.tem_acesso());

-- -----------------------------------------------------------------
-- 3) Onde e quando já foi publicado
--    Serve para responder "o LinkedIn desse cargo está velho?" sem
--    depender da memória de ninguém.
-- -----------------------------------------------------------------
create table if not exists public.posts_publicacoes (
  id           uuid primary key default gen_random_uuid(),
  post_id      uuid not null references public.posts_divulgacao(id) on delete cascade,
  canal        text not null,
  publicado_em timestamptz not null default now(),
  autor        text not null default ''
);

create index if not exists posts_pub_post_idx
  on public.posts_publicacoes (post_id, canal, publicado_em desc);

alter table public.posts_publicacoes enable row level security;
drop policy if exists "rh acessa publicacoes" on public.posts_publicacoes;
create policy "rh acessa publicacoes" on public.posts_publicacoes
  for all to authenticated
  using (public.tem_acesso()) with check (public.tem_acesso());

-- -----------------------------------------------------------------
-- 4) O bucket das artes — PÚBLICO, e de propósito
--    Aqui só entra peça de divulgação, que é feita para circular. Ser
--    público é o que permite copiar o endereço da arte e mandar para
--    alguém de fora publicar.
--
--    >>> Nunca suba currículo, documento ou qualquer papel de candidato
--    >>> neste bucket. Esses continuam em 'curriculos' e
--    >>> 'documentos-admissao', que são privados e assim devem ficar.
--
--    Escrever e apagar continua sendo só de quem tem acesso.
-- -----------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('divulgacao','divulgacao', true, 15728640,
        array['image/png','image/jpeg','image/webp','image/gif'])
on conflict (id) do update
  set public = true,
      file_size_limit = 15728640,
      allowed_mime_types = array['image/png','image/jpeg','image/webp','image/gif'];

drop policy if exists "todos leem divulgacao"   on storage.objects;
drop policy if exists "rh envia divulgacao"     on storage.objects;
drop policy if exists "rh atualiza divulgacao"  on storage.objects;
drop policy if exists "rh apaga divulgacao"     on storage.objects;

create policy "todos leem divulgacao" on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'divulgacao');

create policy "rh envia divulgacao" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'divulgacao' and public.tem_acesso());

create policy "rh atualiza divulgacao" on storage.objects
  for update to authenticated
  using (bucket_id = 'divulgacao' and public.tem_acesso())
  with check (bucket_id = 'divulgacao' and public.tem_acesso());

create policy "rh apaga divulgacao" on storage.objects
  for delete to authenticated
  using (bucket_id = 'divulgacao' and public.tem_acesso());

-- -----------------------------------------------------------------
-- 5) Tempo real, para a Bruna ver o post que você acabou de cadastrar
--    sem precisar recarregar. Se já estiver na publicação, segue o jogo.
-- -----------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.posts_divulgacao;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.posts_imagens;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.posts_publicacoes;
  exception when duplicate_object then null; end;
end $$;

-- -----------------------------------------------------------------
-- Conferência
--   1ª: as três tabelas novas nasceram
--   2ª: o bucket, que precisa vir com public = true
-- -----------------------------------------------------------------
select table_name
  from information_schema.tables
 where table_schema = 'public'
   and table_name in ('posts_divulgacao','posts_imagens','posts_publicacoes')
 order by 1;

select id, public, file_size_limit from storage.buckets where id = 'divulgacao';
