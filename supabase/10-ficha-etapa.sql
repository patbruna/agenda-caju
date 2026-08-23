-- Agenda de Entrevistas — Grupo Caju
-- FICHA DA ETAPA: registro estruturado da conversa.
--   painel do Supabase -> SQL Editor -> New query -> colar tudo -> Run
--
-- Pode rodar mais de uma vez sem problema: nada é apagado ou duplicado.
-- Não mexe em nada do módulo de colaboradores.
--
-- POR QUÊ
-- O histórico de anotações é texto livre: bom para guardar uma frase do
-- candidato, ruim para comparar cinco pessoas no mesmo dia. Os guias de
-- entrevista já traziam uma ficha de 9 critérios com nota de 0 a 3 e uma
-- evidência curta, mais um fechamento. Isto traz essa ficha para dentro
-- do app, com os critérios variando por cargo — porque técnica de sushi
-- não serve para avaliar chefe de APV.

-- -----------------------------------------------------------------
-- 1) Os critérios, por cargo e por etapa
-- -----------------------------------------------------------------
create table if not exists public.criterios (
  id        uuid primary key default gen_random_uuid(),
  cargo     text not null,
  etapa     text not null default 'entrevista',
  ordem     int  not null default 0,
  nome      text not null,
  evidencia text not null default '',
  criado_em timestamptz not null default now(),
  unique (cargo, etapa, nome)
);

create index if not exists criterios_cargo_idx
  on public.criterios (cargo, etapa, ordem);

alter table public.criterios enable row level security;
drop policy if exists "rh acessa criterios" on public.criterios;
create policy "rh acessa criterios" on public.criterios
  for all to authenticated
  using (public.tem_acesso()) with check (public.tem_acesso());

-- -----------------------------------------------------------------
-- 2) A ficha preenchida: uma por candidato por etapa.
--    As notas ficam em jsonb com a chave sendo o nome do critério, e a
--    ficha inteira grava numa linha só. Renomear um critério pela tela
--    não apaga a nota antiga: ela fica órfã e visível, em vez de sumir.
--    Valores de decisao: vazio, avanca, ressalva, nao_avanca.
-- -----------------------------------------------------------------
create table if not exists public.fichas (
  id            uuid primary key default gen_random_uuid(),
  candidato_id  uuid not null references public.candidatos(id) on delete cascade,
  etapa         text not null default 'entrevista',
  notas         jsonb not null default '{}'::jsonb,
  evidencias    text not null default '',
  atencao       text not null default '',
  testar        text not null default '',
  aberto        text not null default '',
  decisao       text not null default '',
  autor         text not null default '',
  atualizado_em timestamptz not null default now(),
  unique (candidato_id, etapa)
);

alter table public.fichas enable row level security;
drop policy if exists "rh acessa fichas" on public.fichas;
create policy "rh acessa fichas" on public.fichas
  for all to authenticated
  using (public.tem_acesso()) with check (public.tem_acesso());

-- -----------------------------------------------------------------
-- 3) Os critérios dos quatro guias da etapa 1.
--    Texto igual ao dos documentos. O "do nothing" faz com que uma
--    edição sua pela tela não seja desfeita ao rodar este arquivo
--    de novo.
-- -----------------------------------------------------------------

-- Chefe de Sushi
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Sushi', 'entrevista', 1, 'Técnica de sushi e padrão de produto', '')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Sushi', 'entrevista', 2, 'Organização de praça e mise en place', '')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Sushi', 'entrevista', 3, 'Liderança de equipe / treinamento', '')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Sushi', 'entrevista', 4, 'Controle de insumos, perdas e validade', '')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Sushi', 'entrevista', 5, 'Higiene e segurança alimentar', '')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Sushi', 'entrevista', 6, 'Resposta em pico e sob pressão', '')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Sushi', 'entrevista', 7, 'Comunicação e integração com a operação', '')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Sushi', 'entrevista', 8, 'Postura, maturidade e aderência cultural', '')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Sushi', 'entrevista', 9, 'Prontidão para a cadeira de chefe de sushi', '')
  on conflict (cargo, etapa, nome) do nothing;

-- Chefe de Cozinha
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Cozinha', 'entrevista', 1, 'Comunicação e raciocínio', 'Explica serviço, problemas e decisões com clareza, sem se esconder atrás de jargão culinário.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Cozinha', 'entrevista', 2, 'Escopo real de liderança', 'Já respondeu por brigada, escala, cobrança e resultado - não apenas pela própria praça.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Cozinha', 'entrevista', 3, 'Execução e ritmo de serviço', 'Organiza mise en place, prioriza produção e sustenta padrão durante pico.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Cozinha', 'entrevista', 4, 'Qualidade e ficha técnica', 'Trabalha com padrão, porcionamento, apresentação e consistência, não apenas criação de pratos.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Cozinha', 'entrevista', 5, 'Higiene e segurança alimentar', 'Demonstra rotina prática de controle, organização, validade, armazenamento e correção de risco.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Cozinha', 'entrevista', 6, 'Estoque, custo e desperdício', 'Controla pedidos, perdas, aproveitamento e uso de insumos com lógica econômica.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Cozinha', 'entrevista', 7, 'Urgência e solução de problemas', 'Age rápido diante de ruptura, atraso, falta de equipe ou erro sem sacrificar segurança e qualidade.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Cozinha', 'entrevista', 8, 'Integração com a operação', 'Entende impacto da cozinha no cliente e trabalha com Front/expedição sem terceirizar culpa.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de Cozinha', 'entrevista', 9, 'Cultura e motivação', 'Sinais de autorresponsabilidade, senso de dono, Cliente é Rei, disposição e coerência com a cadeira.')
  on conflict (cargo, etapa, nome) do nothing;

-- Chefe de APV
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de APV', 'entrevista', 1, 'Comunicação e raciocínio', 'Organiza fatos, distingue contexto de ação e explica decisões sem se esconder em generalidades.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de APV', 'entrevista', 2, 'Autonomia e responsabilidade', 'Assume entregas de ponta a ponta, reconhece erros e não depende de alguém mandar cada próximo passo.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de APV', 'entrevista', 3, 'Liderança e coordenação', 'Consegue orientar, cobrar padrão, dar feedback e influenciar pessoas na execução.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de APV', 'entrevista', 4, 'Organização e processos', 'Usa rotina, checklist, prioridade e acompanhamento para garantir constância e conformidade.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de APV', 'entrevista', 5, 'Recursos, materiais e custos', 'Demonstra cuidado com estoque, compras, desperdício, patrimônio e disponibilidade de material.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de APV', 'entrevista', 6, 'Urgência e solução de problemas', 'Age rápido, contém impacto, busca causa e acompanha a correção até o fim.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de APV', 'entrevista', 7, 'Compatibilidade com APV', 'Entende que limpeza, manutenção, materiais, organização e suporte impactam diretamente venda e cliente.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de APV', 'entrevista', 8, 'Cultura Grupo Caju', 'Sinais de autorresponsabilidade, senso de dono, Cliente é Rei e Sorrisos e Disposição.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Chefe de APV', 'entrevista', 9, 'Motivação e coerência', 'A escolha pela chefia operacional faz sentido e vai além de título ou remuneração.')
  on conflict (cargo, etapa, nome) do nothing;

-- Gerente de Front
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Gerente de Front', 'entrevista', 1, 'Comunicação e raciocínio', 'Organiza fatos, explica decisões, não se perde em respostas genéricas.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Gerente de Front', 'entrevista', 2, 'Escopo real de gestão', 'Já respondeu por pessoas, rotina, decisões e resultado - não apenas executou.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Gerente de Front', 'entrevista', 3, 'Liderança de equipe', 'Cobra, desenvolve, dá consequência e forma responsáveis abaixo dele(a).')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Gerente de Front', 'entrevista', 4, 'Cliente e hospitalidade', 'Enxerga experiência do cliente como responsabilidade gerencial e sabe recuperar falhas.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Gerente de Front', 'entrevista', 5, 'Urgência e solução de problemas', 'Age, prioriza, contém impacto, corrige causa e evita recorrência.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Gerente de Front', 'entrevista', 6, 'Indicadores e recursos', 'Usa números para decidir; entende produtividade, custo, venda e controle.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Gerente de Front', 'entrevista', 7, 'Compatibilidade com Front', 'Demonstra presença de operação, leitura de pico e integração salão-cozinha/delivery.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Gerente de Front', 'entrevista', 8, 'Cultura Grupo Caju', 'Sinais de autorresponsabilidade, senso de dono, Cliente é Rei e Sorrisos e Disposição.')
  on conflict (cargo, etapa, nome) do nothing;
insert into public.criterios (cargo, etapa, ordem, nome, evidencia) values
  ('Gerente de Front', 'entrevista', 9, 'Motivação e coerência', 'A mudança de carreira/cadeira faz sentido e o interesse vai além de título/remuneração.')
  on conflict (cargo, etapa, nome) do nothing;

-- -----------------------------------------------------------------
-- 4) Tempo real
-- -----------------------------------------------------------------
do $$
begin
  begin alter publication supabase_realtime add table public.criterios;
  exception when duplicate_object then null; end;
  begin alter publication supabase_realtime add table public.fichas;
  exception when duplicate_object then null; end;
end $$;

-- -----------------------------------------------------------------
-- Conferência: 9 critérios para cada um dos quatro cargos.
-- -----------------------------------------------------------------
select cargo, etapa, count(*) as criterios
  from public.criterios group by cargo, etapa order by cargo;

select count(*) as fichas_preenchidas from public.fichas;
