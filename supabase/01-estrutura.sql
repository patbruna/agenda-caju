-- Agenda de Entrevistas — Grupo Caju
-- Estrutura do banco. Rode este arquivo inteiro no Supabase:
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- Pode rodar mais de uma vez sem problema: nada é apagado ou duplicado.

-- ---------------------------------------------------------------
-- 1) Tabela de candidatos
-- ---------------------------------------------------------------
create table if not exists public.candidatos (
  id          uuid primary key default gen_random_uuid(),
  nome        text not null,
  cat         text not null default 'agendado',
  fone        text not null default '',
  data        date,          -- nulo = sem data definida
  hora        time,          -- nulo = sem horário definido
  status      text not null default 'Pendente',
  criado_em   timestamptz not null default now(),
  alterado_em timestamptz not null default now(),

  constraint candidatos_cat_valida
    check (cat in ('bom','analisar','agendado')),
  constraint candidatos_status_valido
    check (status in ('Pendente','Convidado','Confirmado','Realizada',
                      'Aprovado','Reprovado','Recusou'))
);

-- Ordenação por dia/horário é a consulta mais usada pela tela.
create index if not exists candidatos_ordem_idx
  on public.candidatos (data nulls last, hora nulls last);

-- ---------------------------------------------------------------
-- 2) Mensagens de aprovação / reprovação (compartilhadas)
--    Uma única linha, id fixo = 1.
-- ---------------------------------------------------------------
create table if not exists public.configuracoes (
  id             int primary key default 1,
  msg_aprovacao  text not null default '',
  msg_reprovacao text not null default '',
  alterado_em    timestamptz not null default now(),

  constraint configuracoes_linha_unica check (id = 1)
);

insert into public.configuracoes (id) values (1)
  on conflict (id) do nothing;

-- ---------------------------------------------------------------
-- 3) Carimbo automático de "alterado_em"
--    Serve para saber quem mexeu por último quando duas pessoas
--    editam a agenda ao mesmo tempo.
-- ---------------------------------------------------------------
create or replace function public.marcar_alteracao()
returns trigger
language plpgsql
as $$
begin
  new.alterado_em = now();
  return new;
end;
$$;

drop trigger if exists candidatos_alterado on public.candidatos;
create trigger candidatos_alterado
  before update on public.candidatos
  for each row execute function public.marcar_alteracao();

drop trigger if exists configuracoes_alterado on public.configuracoes;
create trigger configuracoes_alterado
  before update on public.configuracoes
  for each row execute function public.marcar_alteracao();

-- ---------------------------------------------------------------
-- 4) SEGURANÇA (RLS) — a parte que realmente protege os dados
--    Sem login, ninguém lê nem escreve nada. Nem com a chave
--    pública que fica no código do site.
-- ---------------------------------------------------------------
alter table public.candidatos    enable row level security;
alter table public.configuracoes enable row level security;

-- Qualquer usuário LOGADO (você e o colaborador) tem acesso total.
-- Visitante anônimo: nada.
drop policy if exists "logados acessam candidatos" on public.candidatos;
create policy "logados acessam candidatos"
  on public.candidatos
  for all
  to authenticated
  using (true)
  with check (true);

drop policy if exists "logados acessam configuracoes" on public.configuracoes;
create policy "logados acessam configuracoes"
  on public.configuracoes
  for all
  to authenticated
  using (true)
  with check (true);

-- ---------------------------------------------------------------
-- 5) Tempo real — as duas telas se atualizam sozinhas
-- ---------------------------------------------------------------
do $$
begin
  begin
    alter publication supabase_realtime add table public.candidatos;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.configuracoes;
  exception when duplicate_object then null;
  end;
end $$;

-- ---------------------------------------------------------------
-- Conferência: deve listar as duas tabelas com rowsecurity = true
-- ---------------------------------------------------------------
select tablename, rowsecurity as rls_ativo
from pg_tables
where schemaname = 'public'
  and tablename in ('candidatos','configuracoes');
