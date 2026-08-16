-- Agenda de Entrevistas — Grupo Caju
-- VAGAS: cada candidato passa a pertencer a um cargo.
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- Pode rodar mais de uma vez sem problema: nada é apagado ou duplicado.
-- Não mexe em nada do módulo de colaboradores.
--
-- POR QUÊ
-- Até aqui o processo era de uma vaga só, e "Executivo de Back" estava
-- escrito fixo no título da página e dentro dos modelos de mensagem.
-- Com três vagas abertas ao mesmo tempo isso não se sustenta: o cargo
-- vira campo do candidato, e os modelos passam a usar {CARGO}.

-- -----------------------------------------------------------------
-- 1) O cargo de cada candidato
-- -----------------------------------------------------------------
alter table public.candidatos
  add column if not exists cargo text not null default '';

create index if not exists candidatos_cargo_idx on public.candidatos (cargo);

-- Quem já estava no processo veio da vaga anterior. Só preenche quem
-- está vazio, então rodar de novo não sobrescreve nada.
update public.candidatos
   set cargo = 'Executivo de Back'
 where coalesce(cargo, '') = '';

-- -----------------------------------------------------------------
-- 2) A lista de vagas abertas, editável pela tela
--    Fica em configuracoes, junto dos modelos de mensagem, porque é
--    da equipe inteira e não de cada máquina.
-- -----------------------------------------------------------------
alter table public.configuracoes
  add column if not exists cargos jsonb not null default '[]'::jsonb;

-- Semente das três vagas de agora. Só entra se a lista estiver vazia:
-- depois que você editar pela tela, este arquivo não te atrapalha mais.
update public.configuracoes
   set cargos = '["Chefe de APV","Chefe de Cozinha","Chefe de Sushi"]'::jsonb
 where id = 1
   and (cargos is null or jsonb_array_length(cargos) = 0);

-- -----------------------------------------------------------------
-- Conferência
--   1ª: a coluna nova e quantos candidatos há por cargo
--   2ª: a lista de vagas abertas
-- -----------------------------------------------------------------
select coalesce(nullif(cargo,''), '(sem cargo)') as cargo, count(*) as candidatos
  from public.candidatos
 group by 1
 order by 1;

select cargos from public.configuracoes where id = 1;
