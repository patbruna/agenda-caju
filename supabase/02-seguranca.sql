-- Agenda de Entrevistas — Grupo Caju
-- CORREÇÃO DE SEGURANÇA. Rode depois do 01-estrutura.sql.
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- POR QUÊ:
-- O 01-estrutura.sql liberou acesso para "qualquer usuário autenticado".
-- Isso só seria seguro se o cadastro de novos usuários estivesse fechado —
-- e neste projeto ele está ABERTO (disable_signup = false). Ou seja: com a
-- chave pública que fica no código do site, qualquer pessoa poderia criar
-- uma conta e ler os dados dos candidatos.
--
-- Este arquivo troca "qualquer logado" por uma LISTA EXPLÍCITA de pessoas.
-- Mesmo que o cadastro aberto volte a ser ligado por acidente, quem não
-- estiver na lista não vê nada.
--
-- IMPORTANTE: fechar o cadastro no painel continua sendo necessário.
-- Ver instruções no final do arquivo.

-- ---------------------------------------------------------------
-- 1) Quem pode usar a agenda
-- ---------------------------------------------------------------
create table if not exists public.acessos_permitidos (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  nome       text,
  liberado_em timestamptz not null default now()
);

-- Esta tabela NÃO é acessível pelo site. Só pelo SQL Editor do painel
-- (que roda como administrador e passa por cima do RLS). Assim ninguém
-- consegue se auto-adicionar à lista pelo navegador.
alter table public.acessos_permitidos enable row level security;
-- (nenhuma policy criada de propósito = ninguém acessa pelo site)

-- ---------------------------------------------------------------
-- 2) Liberar as pessoas do RH
--    >>> EDITE A LISTA DE E-MAILS ABAIXO <<<
--    Os usuários já precisam existir em Authentication -> Users.
-- ---------------------------------------------------------------
insert into public.acessos_permitidos (user_id, nome)
select u.id, u.email
from auth.users u
where u.email in (
  'brunapatricio@cajupar.com',
  'victorgutierres@cajupar.com'
)
on conflict (user_id) do nothing;

-- ---------------------------------------------------------------
-- 3) Função de checagem
-- ---------------------------------------------------------------
create or replace function public.tem_acesso()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.acessos_permitidos
    where user_id = auth.uid()
  );
$$;

-- ---------------------------------------------------------------
-- 4) Substituir as políticas largas pelas restritas
-- ---------------------------------------------------------------
drop policy if exists "logados acessam candidatos"   on public.candidatos;
drop policy if exists "logados acessam configuracoes" on public.configuracoes;

drop policy if exists "rh acessa candidatos" on public.candidatos;
create policy "rh acessa candidatos"
  on public.candidatos
  for all
  to authenticated
  using (public.tem_acesso())
  with check (public.tem_acesso());

drop policy if exists "rh acessa configuracoes" on public.configuracoes;
create policy "rh acessa configuracoes"
  on public.configuracoes
  for all
  to authenticated
  using (public.tem_acesso())
  with check (public.tem_acesso());

-- ---------------------------------------------------------------
-- 5) Conferência — deve listar as pessoas liberadas.
--    Se vier vazio, os e-mails do passo 2 não batem com os usuários
--    cadastrados em Authentication -> Users. Corrija e rode de novo.
-- ---------------------------------------------------------------
select a.nome, a.user_id, a.liberado_em
from public.acessos_permitidos a
order by a.liberado_em;

-- ---------------------------------------------------------------
-- FALTA FAZER NO PAINEL (não dá para fazer por SQL):
--
-- 1. Fechar o cadastro público:
--    Authentication -> Sign In / Providers -> Email
--    -> desligar "Allow new users to sign up"
--
-- 2. Conferir que o login anônimo está desligado:
--    mesma tela, "Allow anonymous sign-ins" -> desligado
--    (checado em 24/07/2026: já estava desligado)
--
-- 3. Para adicionar alguém no futuro:
--    a) criar em Authentication -> Users -> Add user
--    b) rodar aqui:
--       insert into public.acessos_permitidos (user_id, nome)
--       select id, email from auth.users where email = 'pessoa@cajupar.com'
--       on conflict (user_id) do nothing;
--
-- 4. Para remover o acesso de alguém (sem apagar o usuário):
--       delete from public.acessos_permitidos
--       where user_id = (select id from auth.users where email = 'pessoa@cajupar.com');
-- ---------------------------------------------------------------
