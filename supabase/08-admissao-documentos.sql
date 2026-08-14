-- Grupo Caju — Módulo de Colaboradores
-- CONFERÊNCIA DE DOCUMENTOS DE ADMISSÃO. Rode depois do 07-colaboradores.sql.
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- Pode rodar mais de uma vez sem problema: nada é apagado ou duplicado.
--
-- O QUE É
-- Os 22 documentos obrigatórios da admissão, conferidos um a um, com o
-- arquivo anexado de cada um. O colaborador é o MESMO da tabela que já
-- existe: ninguém é cadastrado duas vezes.
--
-- POR QUE NÃO SEGUIU O ENUNCIADO À RISCA
-- O enunciado original criava uma tabela "colaboradores" própria, com
-- "status" e "conferidos", e liberava tudo por política aberta
-- (using (true)). Aqui isso teria dois efeitos ruins:
--   1. A tabela colaboradores JÁ EXISTE, com outro formato. O
--      "create table if not exists" não faria nada, e o cadastro
--      inicial falharia por falta da coluna status.
--   2. Pior: a política aberta cairia sobre a tabela existente e
--      deixaria CPF, nome da mãe e telefone de todo mundo legíveis e
--      graváveis por quem tivesse a chave publicável — que está no
--      código-fonte do site, aberto na internet.
-- Estes documentos são RG, CPF, papéis de dependentes e certidão de
-- nascimento. Seguem, portanto, a mesma regra do resto do módulo:
-- leitura só para RH e admin, gravação só por função que confere
-- perfil no banco, e arquivo em balde privado.

-- -----------------------------------------------------------------
-- 1) Em que ponto da admissão o colaborador está
--
--    Em tabela própria, e não como coluna em "colaboradores", de
--    propósito: a tela lê pela view vw_colaboradores, que lista as
--    colunas uma a uma. Uma coluna nova exigiria recriar a view aqui
--    dentro — e bastaria alguém rodar o 07-colaboradores.sql de novo
--    para ela sumir. Assim os dois arquivos não se pisam.
--
--    Quem não tem linha aqui está "em conferência". É o padrão, e é
--    também o que faz a tela não quebrar antes deste SQL rodar.
-- -----------------------------------------------------------------
create table if not exists public.colab_admissao (
  colaborador_id uuid primary key references public.colaboradores(id) on delete cascade,
  status         text not null default 'conferencia'
                 check (status in ('conferencia','admitido')),
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);

alter table public.colab_admissao enable row level security;

drop policy if exists "rh le admissao" on public.colab_admissao;
create policy "rh le admissao"
  on public.colab_admissao
  for select
  to authenticated
  using (public.colab_e_rh());

-- -----------------------------------------------------------------
-- 2) Um registro por documento por colaborador
--    A mesma linha guarda a conferência e o anexo: são a mesma
--    pergunta ("este documento está resolvido?") vista de dois
--    ângulos, e separar em duas tabelas só criaria divergência.
-- -----------------------------------------------------------------
create table if not exists public.colab_admissao_docs (
  id             uuid primary key default gen_random_uuid(),
  colaborador_id uuid not null references public.colaboradores(id) on delete cascade,
  doc_index      int  not null check (doc_index between 0 and 21),
  conferido      boolean not null default false,
  conferido_em   timestamptz,
  conferido_por  text,
  arquivo_path   text,
  arquivo_nome   text,
  anexado_em     timestamptz,
  anexado_por    text,
  criado_em      timestamptz not null default now(),
  unique (colaborador_id, doc_index)
);

create index if not exists colab_admissao_docs_colab_idx
  on public.colab_admissao_docs (colaborador_id, doc_index);

-- -----------------------------------------------------------------
-- 3) Leitura: só RH e admin.
--    Gestor cuida de contrato e folga; papel de admissão, não.
-- -----------------------------------------------------------------
alter table public.colab_admissao_docs enable row level security;

drop policy if exists "rh le admissao docs" on public.colab_admissao_docs;
create policy "rh le admissao docs"
  on public.colab_admissao_docs
  for select
  to authenticated
  using (public.colab_e_rh());

-- Gravação nenhuma direto na tabela: só pelas funções abaixo.

-- -----------------------------------------------------------------
-- 4) Registro na auditoria, no mesmo formato do resto do módulo
-- -----------------------------------------------------------------
create or replace function public.colab_admissao_auditar(
  p_id uuid, p_acao text, p_campo text, p_ant text, p_novo text, p_detalhe text)
returns void language sql volatile security definer set search_path = public as $$
  insert into public.colab_auditoria
    (colaborador_id, colaborador_nome, acao, campo, valor_anterior,
     valor_novo, detalhe, usuario_email, usuario_id)
  select p_id, c.nome, p_acao, p_campo, p_ant, p_novo, p_detalhe,
         public.colab_email_atual(), auth.uid()
    from public.colaboradores c
   where c.id = p_id;
$$;

-- -----------------------------------------------------------------
-- 5) Marcar e desmarcar um documento
-- -----------------------------------------------------------------
create or replace function public.colab_admissao_marcar(
  p_id uuid, p_doc int, p_conferido boolean)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_antes boolean;
begin
  perform public.colab_exigir(public.colab_e_rh(),
    'Só RH e administrador conferem documentos de admissão.');
  perform public.colab_exigir(p_doc between 0 and 21, 'Documento inválido.');

  select conferido into v_antes
    from public.colab_admissao_docs
   where colaborador_id = p_id and doc_index = p_doc;

  insert into public.colab_admissao_docs
    (colaborador_id, doc_index, conferido, conferido_em, conferido_por)
  values
    (p_id, p_doc, coalesce(p_conferido, false),
     case when p_conferido then now() end,
     case when p_conferido then public.colab_email_atual() end)
  on conflict (colaborador_id, doc_index) do update set
    conferido     = excluded.conferido,
    conferido_em  = case when excluded.conferido then now() else null end,
    conferido_por = case when excluded.conferido then public.colab_email_atual() else null end;

  if coalesce(v_antes, false) is distinct from coalesce(p_conferido, false) then
    perform public.colab_admissao_auditar(
      p_id, 'alteracao', 'admissao_doc_' || lpad((p_doc + 1)::text, 2, '0'),
      case when coalesce(v_antes,false) then 'conferido' else 'pendente' end,
      case when coalesce(p_conferido,false) then 'conferido' else 'pendente' end,
      null);
  end if;
end $$;

-- -----------------------------------------------------------------
-- 6) Registrar o anexo. O arquivo em si vai para o balde pela tela;
--    aqui fica o vínculo. Devolve o caminho do arquivo ANTERIOR, para
--    a tela apagar o que foi substituído e não deixar órfão no balde.
-- -----------------------------------------------------------------
create or replace function public.colab_admissao_anexo(
  p_id uuid, p_doc int, p_path text, p_nome text)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_antigo text;
begin
  perform public.colab_exigir(public.colab_e_rh(),
    'Só RH e administrador anexam documentos de admissão.');
  perform public.colab_exigir(p_doc between 0 and 21, 'Documento inválido.');
  perform public.colab_exigir(coalesce(p_path,'') <> '', 'Caminho do arquivo vazio.');

  select arquivo_path into v_antigo
    from public.colab_admissao_docs
   where colaborador_id = p_id and doc_index = p_doc;

  insert into public.colab_admissao_docs
    (colaborador_id, doc_index, arquivo_path, arquivo_nome, anexado_em, anexado_por)
  values (p_id, p_doc, p_path, p_nome, now(), public.colab_email_atual())
  on conflict (colaborador_id, doc_index) do update set
    arquivo_path = excluded.arquivo_path,
    arquivo_nome = excluded.arquivo_nome,
    anexado_em   = now(),
    anexado_por  = public.colab_email_atual();

  perform public.colab_admissao_auditar(
    p_id, 'documento', 'admissao_doc_' || lpad((p_doc + 1)::text, 2, '0'),
    v_antigo, p_nome, 'anexo de documento de admissão');

  return v_antigo;
end $$;

-- Remove o vínculo e devolve o caminho, para a tela apagar o arquivo.
create or replace function public.colab_admissao_anexo_remover(p_id uuid, p_doc int)
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  v_antigo text;
  v_nome   text;
begin
  perform public.colab_exigir(public.colab_e_rh(),
    'Só RH e administrador removem documentos de admissão.');

  select arquivo_path, arquivo_nome into v_antigo, v_nome
    from public.colab_admissao_docs
   where colaborador_id = p_id and doc_index = p_doc;

  update public.colab_admissao_docs
     set arquivo_path = null, arquivo_nome = null,
         anexado_em = null, anexado_por = null
   where colaborador_id = p_id and doc_index = p_doc;

  if v_antigo is not null then
    perform public.colab_admissao_auditar(
      p_id, 'documento', 'admissao_doc_' || lpad((p_doc + 1)::text, 2, '0'),
      v_nome, null, 'remoção de documento de admissão');
  end if;

  return v_antigo;
end $$;

-- -----------------------------------------------------------------
-- 7) Mover entre "Em conferência" e "Admitidos"
-- -----------------------------------------------------------------
create or replace function public.colab_admissao_status(p_id uuid, p_status text)
returns void language plpgsql volatile security definer set search_path = public as $$
declare
  v_antes text;
begin
  perform public.colab_exigir(public.colab_e_rh(),
    'Só RH e administrador concluem a admissão.');
  perform public.colab_exigir(p_status in ('conferencia','admitido'),
    'Situação de admissão inválida.');

  perform public.colab_exigir(
    exists (select 1 from public.colaboradores where id = p_id),
    'Colaborador não encontrado.');

  select status into v_antes from public.colab_admissao where colaborador_id = p_id;

  insert into public.colab_admissao (colaborador_id, status, atualizado_em, atualizado_por)
  values (p_id, p_status, now(), public.colab_email_atual())
  on conflict (colaborador_id) do update set
    status         = excluded.status,
    atualizado_em  = now(),
    atualizado_por = public.colab_email_atual();

  if coalesce(v_antes,'conferencia') is distinct from p_status then
    perform public.colab_admissao_auditar(
      p_id, 'alteracao', 'admissao_status', v_antes, p_status, null);
  end if;
end $$;

-- -----------------------------------------------------------------
-- 8) Todos os caminhos de arquivo de um colaborador.
--    Usado antes de excluir, para limpar o balde: o "on delete
--    cascade" apaga a linha, mas não apaga o arquivo.
-- -----------------------------------------------------------------
create or replace function public.colab_admissao_arquivos(p_id uuid)
returns setof text language sql stable security definer set search_path = public as $$
  select arquivo_path from public.colab_admissao_docs
   where colaborador_id = p_id and arquivo_path is not null;
$$;

-- -----------------------------------------------------------------
-- 9) Balde privado dos arquivos
--    15 MB por arquivo. Acesso só para quem é RH ou admin: mesma
--    regra da tabela, aplicada também ao arquivo.
-- -----------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit)
values ('documentos-admissao','documentos-admissao', false, 15728640)
on conflict (id) do update set
  public = false, file_size_limit = excluded.file_size_limit;

drop policy if exists "admissao_docs_select" on storage.objects;
create policy "admissao_docs_select" on storage.objects
  for select to authenticated
  using (bucket_id = 'documentos-admissao' and public.colab_e_rh());

drop policy if exists "admissao_docs_insert" on storage.objects;
create policy "admissao_docs_insert" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'documentos-admissao' and public.colab_e_rh());

drop policy if exists "admissao_docs_update" on storage.objects;
create policy "admissao_docs_update" on storage.objects
  for update to authenticated
  using (bucket_id = 'documentos-admissao' and public.colab_e_rh())
  with check (bucket_id = 'documentos-admissao' and public.colab_e_rh());

drop policy if exists "admissao_docs_delete" on storage.objects;
create policy "admissao_docs_delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'documentos-admissao' and public.colab_e_rh());

-- -----------------------------------------------------------------
-- 10) Realtime, tolerante a já estar publicada
-- -----------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.colab_admissao_docs;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.colab_admissao;
  exception when duplicate_object then null;
  end;
end $$;

-- -----------------------------------------------------------------
-- Conferência
--   1ª: as duas tabelas novas e as cinco funções
--   2ª: o balde, que precisa vir com public = false
--   3ª: nada muda na tabela de colaboradores — este SQL não a altera
-- -----------------------------------------------------------------
select 'tabela' as tipo, table_name as nome
  from information_schema.tables
 where table_schema='public'
   and table_name in ('colab_admissao','colab_admissao_docs')
union all
select 'funcao', routine_name
  from information_schema.routines
 where routine_schema='public' and routine_name like 'colab_admissao%'
order by tipo, nome;

select id, public, file_size_limit
  from storage.buckets where id='documentos-admissao';
