/* =================================================================
   Gestão de Colaboradores — Grupo Caju
   Tela e integração com o Supabase.

   As regras não estão aqui: estão em colaboradores-core.js, que roda
   sem tela e sem banco e é conferido por colaboradores-testes.html.
   Este arquivo cuida de mostrar e de gravar.

   Sobre gravação: NADA é escrito direto nas tabelas. Toda alteração
   passa por uma função `colab_*` no banco, que confere perfil e unidade
   do lado do servidor. É por isso que um gestor não consegue alterar
   CPF nem pela API — a proibição não depende de esconder o botão.
   ================================================================= */
'use strict';

var Core = window.CoreColab;

/* CONEXÃO
   A chave publishable é feita para ficar no código do navegador. Quem
   protege os dados são as políticas de RLS e as funções `colab_*` em
   supabase/07-colaboradores.sql.

   Para instalar este módulo em OUTRO aplicativo, não edite este arquivo:
   declare a configuração antes de carregá-lo.

     <script>
       window.COLAB_CONFIG = {
         url: 'https://SEU-PROJETO.supabase.co',
         key: 'sb_publishable_...'
       };
     </script>
     <script src="colaboradores.js"></script>

   Se o aplicativo de destino JÁ tem um cliente Supabase criado, passe-o
   em vez da url/chave:

     window.COLAB_CONFIG = { client: meuClienteSupabase };

   Reaproveitar o cliente existente não é preciosismo: dois clientes no
   mesmo navegador mantêm duas sessões de login concorrentes, e o usuário
   acaba deslogado de um lado ao entrar do outro. */
var CFG_CONEXAO = window.COLAB_CONFIG || {};
var SB_URL = CFG_CONEXAO.url || 'https://usjunqrcdbmrqerpxydt.supabase.co';
var SB_KEY = CFG_CONEXAO.key || 'sb_publishable_6LDiddFi26QnQk_Ptw4sNA_docgmMG7';
var sb = CFG_CONEXAO.client || window.supabase.createClient(SB_URL, SB_KEY);

var ctx = null;          // perfil e permissões de quem entrou
var cfg = {};            // colab_config
var colabs = [];         // vw_colaboradores
var notifEstados = [];   // colab_notificacoes
var perfis = [];
var abaAtiva = 'notificacoes';
var iniciado = false;
var hoje = Core.hojeIso();
var fichaAtual = null;
var imp = null;          // estado da importação em curso

/* ============================================================
   Utilidades de tela
   ============================================================ */
function el(id) { return document.getElementById(id); }
function esc(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/[&<>"']/g, function (c) {
      return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c];
    });
}
function showToast(t, isErr) {
  var e = el('toast');
  e.textContent = t;
  e.className = 'toast show' + (isErr ? ' err' : '');
  clearTimeout(e._t);
  e._t = setTimeout(function () { e.className = 'toast'; }, isErr ? 7000 : 2600);
}
function setSync(ok, txt) {
  var e = el('sync');
  if (!e) return;
  e.classList.toggle('off', !ok);
  el('syncTxt').textContent = txt || (ok ? 'Sincronizado' : 'Erro ao salvar');
}
function fmtDataHora(iso) {
  if (!iso) return '';
  var d = new Date(iso);
  if (isNaN(d.getTime())) return String(iso).slice(0, 16).replace('T', ' ');
  var p = Core.pad2;
  return p(d.getDate()) + '/' + p(d.getMonth() + 1) + '/' + d.getFullYear() +
         ' às ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function agoraIso() { return new Date().toISOString(); }

/* Rótulo de prazo: "faltam 3 dias", "é hoje", "há 12 dias". */
function rotuloPrazo(dias) {
  if (dias === null || dias === undefined) return '<span class="prazo">—</span>';
  if (dias === 0) return '<span class="prazo perto">é hoje</span>';
  if (dias < 0) return '<span class="prazo venceu">há ' + (-dias) + ' dia' + (dias === -1 ? '' : 's') + '</span>';
  var cls = dias <= 7 ? 'prazo perto' : 'prazo';
  return '<span class="' + cls + '">em ' + dias + ' dia' + (dias === 1 ? '' : 's') + '</span>';
}

function tagContrato(res) {
  return '<span class="tag ' + res.cor + '">' + esc(res.rotulo) + '</span>' +
    (res.atrasado ? ' <span class="tag risco">em atraso</span>' : '');
}
function tagFolga(status) {
  var f = Core.FOLGA_STATUS[status] || { rotulo: status || '—', cor: 'cinza' };
  return '<span class="tag ' + f.cor + '">' + esc(f.rotulo) + '</span>';
}

/* ============================================================
   Diálogo genérico — confirmação com observação
   Existe porque o escopo pede, em várias decisões, confirmação
   explícita mais uma observação do gestor. O confirm() do navegador
   não dá conta disso.
   ============================================================ */
var dlgResolver = null, dlgCampos = [], dlgValidar = null;

function perguntar(op) {
  return new Promise(function (resolve) {
    dlgResolver = resolve;
    dlgCampos = op.campos || [];
    dlgValidar = op.validar || null;
    el('dlgTitulo').textContent = op.titulo || 'Confirmar';
    el('dlgBtnOk').textContent = op.confirmar || 'Confirmar';
    el('dlgBtnOk').className = 'btn' + (op.perigo ? ' perigo' : '');
    el('dlgBtnCancelar').style.display = op.semCancelar ? 'none' : '';

    var html = op.texto ? '<p style="margin:0 0 14px;font-size:14px;">' + op.texto + '</p>' : '';
    if (op.alerta) html += '<div class="aviso" style="margin:0 0 14px;">' + op.alerta + '</div>';
    dlgCampos.forEach(function (c) {
      // Montado campo por campo: o checkbox traz o próprio rótulo embutido,
      // os outros levam <label> em cima.
      var corpo;
      if (c.tipo === 'area') {
        corpo = '<label for="dc-' + c.id + '">' + esc(c.rotulo) + '</label>' +
          '<textarea id="dc-' + c.id + '" rows="' + (c.linhas || 3) + '" placeholder="' +
          esc(c.dica || '') + '">' + esc(c.valor || '') + '</textarea>';
      } else if (c.tipo === 'select') {
        corpo = '<label for="dc-' + c.id + '">' + esc(c.rotulo) + '</label>' +
          '<select id="dc-' + c.id + '">' + (c.opcoes || []).map(function (o) {
            return '<option value="' + esc(o.valor) + '"' +
                   (o.valor === c.valor ? ' selected' : '') + '>' + esc(o.rotulo) + '</option>';
          }).join('') + '</select>';
      } else if (c.tipo === 'chk') {
        corpo = '<label class="chk"><input type="checkbox" id="dc-' + c.id + '"' +
          (c.valor ? ' checked' : '') + '> ' + esc(c.rotulo) + '</label>';
      } else {
        corpo = '<label for="dc-' + c.id + '">' + esc(c.rotulo) + '</label>' +
          '<input type="' + (c.tipo === 'data' ? 'date' : c.tipo === 'numero' ? 'number' : 'text') +
          '" id="dc-' + c.id + '" value="' + esc(c.valor || '') + '" placeholder="' +
          esc(c.dica || '') + '">';
      }
      html += '<div class="campo" style="margin-bottom:12px;">' + corpo +
              (c.nota ? '<p class="nota">' + c.nota + '</p>' : '') + '</div>';
    });
    html += '<div class="aviso" id="dlgErro" style="display:none"></div>';
    el('dlgCorpo').innerHTML = html;
    el('dlg').classList.add('on');
    var primeiro = dlgCampos[0];
    if (primeiro) { var i = el('dc-' + primeiro.id); if (i) setTimeout(function () { i.focus(); }, 60); }
  });
}
function dlgValores() {
  var v = {};
  dlgCampos.forEach(function (c) {
    var i = el('dc-' + c.id);
    if (!i) return;
    v[c.id] = c.tipo === 'chk' ? i.checked : i.value;
  });
  return v;
}
function dlgConfirmar() {
  var v = dlgValores();
  if (dlgValidar) {
    var erro = dlgValidar(v);
    if (erro) {
      var e = el('dlgErro');
      e.innerHTML = erro;
      e.style.display = '';
      return;
    }
  }
  el('dlg').classList.remove('on');
  var r = dlgResolver; dlgResolver = null;
  if (r) r(v);
}
function dlgCancelar() {
  el('dlg').classList.remove('on');
  var r = dlgResolver; dlgResolver = null;
  if (r) r(null);
}
document.addEventListener('keydown', function (e) {
  if (e.key !== 'Escape') return;
  if (el('dlg').classList.contains('on')) dlgCancelar();
  else if (el('ficha').classList.contains('on')) fecharFicha();
});

/* ============================================================
   Login e carga
   ============================================================ */
async function doLogin(ev) {
  ev.preventDefault();
  var btn = el('gateBtn'), err = el('gateErr');
  btn.disabled = true; btn.textContent = 'Entrando…'; err.className = 'err';
  var r = await sb.auth.signInWithPassword({
    email: el('email').value.trim(), password: el('senha').value
  });
  btn.disabled = false; btn.textContent = 'Entrar';
  if (r.error) {
    err.textContent = /invalid login|invalid credentials/i.test(r.error.message)
      ? 'E-mail ou senha incorretos.'
      : /not confirmed/i.test(r.error.message)
        ? 'Este e-mail ainda não foi confirmado. Confirme o usuário no painel do Supabase.'
        : r.error.message;
    err.className = 'err show';
    return;
  }
  el('senha').value = '';
}

async function doLogout() {
  if (!confirm('Sair do módulo de colaboradores?')) return;
  await sb.auth.signOut();
  location.reload();
}

async function boot() {
  var s = await sb.auth.getSession();
  await mostrar(s.data.session);
  sb.auth.onAuthStateChange(function (_e, sess) { mostrar(sess); });
}

async function mostrar(session) {
  el('boot').style.display = 'none';
  if (!session) {
    iniciado = false;
    el('app').style.display = 'none';
    el('semacesso').style.display = 'none';
    el('gate').style.display = '';
    return;
  }
  el('gate').style.display = 'none';
  if (iniciado) return;

  // Quem entrou tem perfil no módulo?
  var r = await sb.rpc('colab_meu_contexto');
  if (r.error) {
    el('semacesso').style.display = '';
    el('semacessoQuem').textContent = session.user.email + ' — ' + r.error.message;
    return;
  }
  ctx = r.data || {};
  if (!ctx.perfil) {
    el('semacesso').style.display = '';
    el('semacessoQuem').textContent = 'Você entrou como ' + session.user.email + '.';
    return;
  }

  iniciado = true;
  el('app').style.display = '';
  el('whoami').textContent = ctx.email || session.user.email;
  el('perfilTag').textContent = rotuloPerfil(ctx.perfil) +
    (ctx.unidade ? ' · ' + ctx.unidade : '');
  aplicarPermissoes();
  montarSelects();
  await recarregar();
}

function rotuloPerfil(p) {
  return ({ admin: 'Administrador', rh: 'RH / DP', gestor: 'Gestor da unidade',
            consulta: 'Consulta' })[p] || p;
}

function aplicarPermissoes() {
  el('tab-importar').style.display = ctx.pode_importar ? '' : 'none';
  el('tab-config').style.display = ctx.pode_config ? '' : 'none';
  el('btnNovo').style.display = ctx.pode_criar ? '' : 'none';
  el('btnExportar').style.display = ctx.pode_exportar ? '' : 'none';
}

async function recarregar() {
  hoje = Core.hojeIso();
  setSync(true, 'Carregando…');

  var pedidos = [
    sb.from('vw_colaboradores').select('*'),
    sb.from('colab_config').select('*').eq('id', 1).maybeSingle(),
    sb.from('colab_notificacoes').select('*')
  ];
  var r = await Promise.all(pedidos);

  if (r[0].error) {
    setSync(false, 'Erro ao carregar');
    showToast('Não foi possível carregar os colaboradores: ' + r[0].error.message, true);
    return;
  }
  colabs = r[0].data || [];

  if (!r[1].error && r[1].data) {
    cfg = r[1].data;
    if (!cfg.msg_aniversario) cfg.msg_aniversario = Core.MSG_ANIV_PADRAO;
    if (!cfg.termo_modelo) cfg.termo_modelo = '';
  }
  notifEstados = r[2].error ? [] : (r[2].data || []);

  if (ctx.pode_config) {
    var p = await sb.from('colab_perfis').select('*');
    perfis = p.error ? [] : (p.data || []);
    preencherConfig();
  }

  setSync(true);
  atualizarUnidades();
  render();
}

/* Recarrega só a lista de pessoas, depois de uma gravação. */
async function refetchColabs() {
  var r = await sb.from('vw_colaboradores').select('*');
  if (r.error) { setSync(false, 'Erro ao recarregar'); return false; }
  colabs = r.data || [];
  var n = await sb.from('colab_notificacoes').select('*');
  notifEstados = n.error ? notifEstados : (n.data || []);
  atualizarUnidades();
  return true;
}

/* Chamada de função no banco, com aviso de erro na tela. */
async function chamar(fn, args, msgOk) {
  setSync(true, 'Salvando…');
  var r = await sb.rpc(fn, args || {});
  if (r.error) {
    setSync(false, 'Erro ao salvar');
    showToast(limparErro(r.error.message), true);
    return { ok: false, erro: r.error };
  }
  setSync(true);
  if (msgOk) showToast(msgOk);
  return { ok: true, dados: r.data };
}
function limparErro(m) {
  return String(m || 'Erro desconhecido').replace(/^.*?(?:ERROR|error):\s*/i, '');
}

/* ============================================================
   Abas e selects
   ============================================================ */
function setAba(a) {
  abaAtiva = a;
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
    t.classList.toggle('on', t.dataset.aba === a);
  });
  Array.prototype.forEach.call(document.querySelectorAll('.painel'), function (p) {
    p.classList.toggle('on', p.id === 'pn-' + a);
  });
  render();
}

function montarSelects() {
  var meses = Core.MESES.map(function (m, i) {
    return '<option value="' + (i + 1) + '">' + m.charAt(0).toUpperCase() + m.slice(1) + '</option>';
  }).join('');
  el('fMes').innerHTML = '<option value="todos">Todos</option>' + meses;
  el('fFolgaMes').innerHTML = '<option value="todos">Todos</option>' + meses;
  el('fEtapa').innerHTML = '<option value="todas">Todas</option>' +
    Object.keys(Core.STATUS_CONTRATO).filter(function (k) { return k !== 'sem_admissao'; })
      .map(function (k) {
        return '<option value="' + k + '">' + Core.STATUS_CONTRATO[k].rotulo + '</option>';
      }).join('');
}

function atualizarUnidades() {
  var us = Core.unidades(colabs);
  ['fUnidade', 'fExpUnidade', 'fAnivUnidade', 'fFolgaUnidade', 'fCadUnidade'].forEach(function (id) {
    var s = el(id);
    if (!s) return;
    var atual = s.value;
    s.innerHTML = '<option value="todas">Todas</option>' + us.map(function (u) {
      return '<option value="' + esc(u) + '">' + esc(u) + '</option>';
    }).join('');
    if (atual && (atual === 'todas' || us.indexOf(atual) >= 0)) s.value = atual;
  });
}

function limparFiltros() {
  el('fBusca').value = '';
  el('fSituacao').value = 'Ativo';
  ['fUnidade'].forEach(function (i) { el(i).value = 'todas'; });
  el('fMes').value = 'todos'; el('fEtapa').value = 'todas'; el('fFolga').value = 'todas';
  ['fVence', 'fPendente', 'fAtrasada', 'fIncompleto'].forEach(function (i) { el(i).checked = false; });
  render();
}

/* ============================================================
   Render
   ============================================================ */
function render() {
  if (!iniciado) return;
  hoje = Core.hojeIso();
  var p = Core.partes(hoje);
  el('hojeTxt').textContent = 'Hoje: ' + Core.isoParaBr(hoje) + ' · competência ' +
    Core.rotuloMes(p.ano, p.mes);

  var notifs = Core.gerarNotificacoes(colabs, cfg, hoje, notifEstados, agoraIso());
  var cont = Core.contarNotificacoes(notifs);

  var nNotif = el('n-notificacoes');
  nNotif.textContent = cont.total;
  nNotif.className = 'n' + (cont.urgente ? ' urg' : '');
  el('n-colaboradores').textContent = colabs.filter(function (c) { return c.situacao === 'Ativo'; }).length;
  el('n-experiencia').textContent = colabs.filter(function (c) {
    var r = Core.contratoResumo(c, cfg, hoje);
    return !r.encerrado && c.situacao === 'Ativo' && c.data_admissao;
  }).length;
  el('n-aniversarios').textContent = Core.aniversariantesDoMes(
    ativos(), p.ano, p.mes, hoje).length;
  el('n-folgas').textContent = folgasAtencao().length;
  el('n-cadastro').textContent = ativos().filter(function (c) {
    return Core.situacaoCadastro(c).contatoIncompleto;
  }).length;

  if (abaAtiva === 'notificacoes') renderNotificacoes(notifs, cont);
  if (abaAtiva === 'colaboradores') renderColaboradores();
  if (abaAtiva === 'experiencia') renderExperiencia();
  if (abaAtiva === 'aniversarios') renderAniversarios();
  if (abaAtiva === 'folgas') renderFolgas();
  if (abaAtiva === 'cadastro') renderCadastro();
  if (abaAtiva === 'config') renderPerfis();
  if (fichaAtual) {
    var atualizado = colabs.filter(function (c) { return c.id === fichaAtual.id; })[0];
    if (atualizado) { fichaAtual = atualizado; desenharFicha(); }
  }
}

function ativos() { return colabs.filter(function (c) { return c.situacao === 'Ativo'; }); }

/* Folga que pede providência AGORA. Pela regra anual, quem faz
   aniversário em dezembro tem a folga "não analisada" desde janeiro —
   verdade, mas inútil como painel de trabalho. Aqui entra só quem já
   está na competência (ou passou dela) e quem foi aprovado sem data. */
function folgaPedeAtencao(c, p) {
  if (c.situacao !== 'Ativo') return false;
  var pn = Core.partes(c.data_nascimento);
  if (!pn) return false;
  if (c.folga_ano === p.ano && c.folga_status === 'aprovada' && !c.folga_data) return true;
  if (pn.mes > p.mes) return false;                 // competência ainda não chegou
  return Core.folgaPendenteNoAno(c, p.ano);
}
function folgasAtencao() {
  var p = Core.partes(hoje);
  return colabs.filter(function (c) { return folgaPedeAtencao(c, p); });
}
function acharColab(id) { return colabs.filter(function (c) { return c.id === id; })[0]; }
function podeOperar(c) {
  if (!ctx.pode_operar) return false;
  if (ctx.perfil === 'admin' || ctx.perfil === 'rh') return true;
  if (!ctx.unidade) return true;
  return (c.unidade || '') === ctx.unidade;
}

/* ---------- CPF na tela ----------
   O valor já vem mascarado do banco para quem não é RH: aqui não há
   como "desmascarar". Para RH mostramos formatado e o botão só alterna
   entre completo e parcial na exibição. */
function cpfNaTela(c, completo) {
  if (!c.cpf) return '<span class="oculto">sem CPF</span>';
  if (!c.ve_sensivel) return esc(c.cpf);
  return esc(completo ? Core.cpfFormatado(c.cpf) : Core.cpfMascarado(c.cpf));
}

/* ============================================================
   ABA — Notificações
   ============================================================ */
function renderNotificacoes(notifs, cont) {
  /* Quatro cartões, não sete pastilhas. A escolha do que entra é por
     urgência de ação, não por completude: o total de pendências vira
     legenda do primeiro cartão em vez de disputar espaço com ele. */
  var nAniv = cont.porGrupo.aniversario || 0;
  var nFolga = cont.porGrupo.folga || 0;
  el('statsNotif').innerHTML =
    kpi('Exigem ação hoje', cont.urgente,
        cont.total + ' pendência' + (cont.total === 1 ? '' : 's') + ' no total',
        cont.urgente ? 'crit' : 'bom') +
    kpi('Contratos de experiência', cont.porGrupo.contrato || 0,
        'decisões de 1º e 2º período',
        (cont.porGrupo.contrato || 0) ? 'aten' : '') +
    kpi('Aniversários e folgas', nAniv + nFolga,
        nAniv + ' aniversário' + (nAniv === 1 ? '' : 's') + ' · ' + nFolga + ' folga' + (nFolga === 1 ? '' : 's')) +
    kpi('Cadastro incompleto', cont.porGrupo.cadastro || 0,
        'contatos a completar');

  var grupo = el('fNotifGrupo').value;
  var minPrio = el('fNotifPrio').value;
  var verLidas = el('fNotifLidas').checked;
  var verFechadas = el('fNotifFechadas').checked;
  var ordem = Core.PRIORIDADES;

  var lista = notifs.filter(function (n) {
    if (grupo !== 'todos' && n.grupo !== grupo) return false;
    if (ordem[n.prioridade] > ordem[minPrio]) return false;
    if ((n.resolvida || n.adiada) && !verFechadas) return false;
    if (n.lida && !n.resolvida && !n.adiada && !verLidas) return false;
    return true;
  });

  if (!lista.length) {
    el('listaNotif').innerHTML = '<div class="caixa vazio">Nenhuma pendência com esses filtros.' +
      (notifs.length ? ' Há ' + notifs.length + ' no total — experimente marcar “mostrar lidas”.' :
       ' Está tudo em ordem.') + '</div>';
    return;
  }

  el('listaNotif').innerHTML = lista.map(function (n) {
    var c = n.colaborador;
    var fechada = n.resolvida || n.adiada;
    var extra = [];
    if (n.prazo) extra.push('prazo ' + Core.isoParaBr(n.prazo));
    if (c.unidade) extra.push(esc(c.unidade));
    if (n.lida && !n.resolvida) extra.push('lida');
    if (n.adiada) extra.push('adiada até ' + fmtDataHora(n.adiada_para));
    if (n.resolvida) extra.push('resolvida em ' + fmtDataHora(n.resolvida_em) +
      (n.usuario_estado ? ' por ' + esc(n.usuario_estado) : ''));

    var bts = '<button class="btn sec mini" onclick="abrirFicha(\'' + c.id + '\')">Abrir cadastro</button>';
    if (podeOperar(c)) {
      if (!n.resolvida) {
        if (!n.lida) bts += '<button class="btn sec mini" onclick="notifAcao(\'' + n.id + '\',\'ler\')">Marcar lida</button>';
        bts += '<button class="btn sec mini" onclick="notifAdiar(\'' + n.id + '\')">Adiar</button>';
        bts += '<button class="btn sec mini" onclick="notifResolver(\'' + n.id + '\')">Resolver</button>';
      } else {
        bts += '<button class="btn sec mini" onclick="notifAcao(\'' + n.id + '\',\'reabrir\')">Reabrir</button>';
      }
    }

    return '<div class="notif p-' + n.prioridade + (n.lida ? ' lida' : '') + (fechada ? ' fechada' : '') + '">' +
      '<div class="faixa"></div>' +
      '<div><div class="tit">' + esc(n.titulo) +
        ' <span class="tag ' + corPrioridade(n.prioridade) + '">' + n.prioridade + '</span></div>' +
        '<div class="det"><b>' + esc(Core.nomeApresentavel(c.nome)) + '</b> — ' + esc(n.detalhe) + '</div>' +
        (extra.length ? '<div class="det">' + extra.join(' · ') + '</div>' : '') +
        (n.resolucao ? '<div class="det">Resolução: ' + esc(n.resolucao) + '</div>' : '') +
      '</div>' +
      '<div class="bt">' + bts + '</div></div>';
  }).join('');
}
function corPrioridade(p) {
  return ({ urgente: 'vermelho', alta: 'ambar', media: 'azul', baixa: 'cinza' })[p] || 'cinza';
}
function stat(rot, n, cls) {
  return '<span class="stat ' + (cls || '') + '">' + esc(rot) + ' <b>' + n + '</b></span>';
}

/* Cartão de indicador. Ao contrário da pastilha, carrega uma legenda que
   diz o que fazer com o número — "12" não informa nada, "12 contratos a
   decidir" informa. Cor só quando o número exige ação. */
function kpi(rot, n, detalhe, cls) {
  return '<div class="kpi ' + (cls || '') + '">' +
    '<div class="l">' + esc(rot) + '</div>' +
    '<div class="q">' + n + '</div>' +
    '<div class="d">' + esc(detalhe || '') + '</div>' +
    '</div>';
}

function partesNotif(id) {
  var p = String(id).split('|');
  return { colaborador_id: p[0], tipo: p[1], referencia: p[2] || '-' };
}
async function notifAcao(id, acao, ate, resolucao) {
  var p = partesNotif(id);
  var r = await chamar('colab_notificar', {
    p_id: p.colaborador_id, p_tipo: p.tipo, p_ref: p.referencia,
    p_acao: acao, p_ate: ate || null, p_resolucao: resolucao || null
  });
  if (!r.ok) return;
  await refetchColabs();
  render();
}
async function notifAdiar(id) {
  var v = await perguntar({
    titulo: 'Adiar o lembrete',
    texto: 'O aviso sai da lista até a data escolhida. A pendência em si continua existindo.',
    campos: [{ tipo: 'select', id: 'quando', rotulo: 'Adiar até', valor: '1', opcoes: [
      { valor: '1', rotulo: 'amanhã' }, { valor: '3', rotulo: 'daqui a 3 dias' },
      { valor: '7', rotulo: 'daqui a 7 dias' }, { valor: '15', rotulo: 'daqui a 15 dias' }] }],
    confirmar: 'Adiar'
  });
  if (!v) return;
  var d = new Date();
  d.setDate(d.getDate() + parseInt(v.quando, 10));
  await notifAcao(id, 'adiar', d.toISOString());
  showToast('Lembrete adiado para ' + Core.isoParaBr(Core.hojeIso(d)));
}
async function notifResolver(id) {
  var v = await perguntar({
    titulo: 'Registrar a resolução',
    texto: 'Anote o que foi feito. Fica no histórico e o aviso sai da lista.',
    campos: [{ tipo: 'area', id: 'obs', rotulo: 'O que foi resolvido',
               dica: 'ex.: falei com o gestor, decisão sai amanhã' }],
    validar: function (v) { return v.obs.trim() ? null : 'Escreva o que foi resolvido.'; },
    confirmar: 'Resolver'
  });
  if (!v) return;
  await notifAcao(id, 'resolver', null, v.obs.trim());
  showToast('Pendência resolvida');
}

/* ============================================================
   ABA — Colaboradores
   ============================================================ */
function filtrosColab() {
  return {
    busca: el('fBusca').value,
    situacao: el('fSituacao').value,
    unidade: el('fUnidade').value,
    mesAniversario: el('fMes').value,
    etapaContrato: el('fEtapa').value,
    folga: el('fFolga').value,
    venceEm: el('fVence').checked ? 15 : null,
    decisaoPendente: el('fPendente').checked,
    decisaoAtrasada: el('fAtrasada').checked,
    cadastroIncompleto: el('fIncompleto').checked
  };
}

function renderColaboradores() {
  var lista = Core.filtrar(colabs, filtrosColab(), cfg, hoje);
  lista.sort(function (a, b) { return Core.chaveNome(a.nome).localeCompare(Core.chaveNome(b.nome)); });

  el('statsColab').innerHTML =
    stat('Exibindo', lista.length, 'z') +
    stat('Ativos', colabs.filter(function (c) { return c.situacao === 'Ativo'; }).length, 'v') +
    stat('Inativos', colabs.filter(function (c) { return c.situacao === 'Inativo'; }).length, '') +
    stat('Cadastro incompleto', ativos().filter(function (c) {
      return Core.situacaoCadastro(c).contatoIncompleto; }).length, 'a') +
    stat('Unidades', Core.unidades(colabs).length, '');

  var mostraFolga = cfg.politica_folga_ativa !== false;
  var cab = '<tr><th>Colaborador</th><th>CPF</th><th>Unidade</th><th>Admissão</th>' +
    '<th>Contrato de experiência</th><th>Nascimento</th><th>Contato</th>' +
    (mostraFolga ? '<th>Folga</th>' : '') + '<th></th></tr>';

  if (!lista.length) {
    el('tbColab').innerHTML = cab + '<tr><td colspan="9" class="vazio">' +
      (colabs.length ? 'Nenhum colaborador com esses filtros.' :
       'Nenhum colaborador cadastrado ainda. Use a aba <b>Importar</b> para trazer a planilha.') +
      '</td></tr>';
    return;
  }

  el('tbColab').innerHTML = cab + lista.map(function (c) {
    var res = Core.contratoResumo(c, cfg, hoje);
    var sc = Core.situacaoCadastro(c);
    var anivP = Core.partes(c.data_nascimento);
    return '<tr class="clic" onclick="abrirFicha(\'' + c.id + '\')">' +
      '<td class="nome-cel">' + esc(Core.nomeApresentavel(c.nome)) +
        (c.situacao === 'Inativo' ? ' <span class="tag cinza">inativo</span>' : '') +
        (c.nome_mae ? '<div class="sub-cel">mãe: ' + esc(Core.nomeApresentavel(c.nome_mae)) + '</div>' : '') +
      '</td>' +
      '<td class="num">' + cpfNaTela(c, false) + '</td>' +
      '<td>' + esc(c.unidade || '—') + '</td>' +
      '<td class="num">' + (Core.isoParaBr(c.data_admissao) || '—') + '</td>' +
      '<td>' + tagContrato(res) +
        (res.prazo && !res.encerrado
          ? '<div class="sub-cel">' + (res.status.indexOf('p1') === 0 || res.status === 'renovacao_aprovada'
              ? '30º dia ' + Core.isoParaBr(res.fimP1) : '90º dia ' + Core.isoParaBr(res.fimP2)) +
            ' · ' + rotuloPrazo(res.status.indexOf('p2') === 0 ? res.diasParaFimP2 : res.diasParaFimP1) +
            '</div>'
          : '') +
      '</td>' +
      '<td class="num">' + (Core.isoParaBr(c.data_nascimento) || '—') +
        (anivP ? '<div class="sub-cel">' + Core.MESES_CURTO[anivP.mes - 1] + '</div>' : '') + '</td>' +
      '<td>' + celContato(c, sc) + '</td>' +
      (mostraFolga ? '<td>' + tagFolga(c.folga_status) +
        (c.folga_data ? '<div class="sub-cel">' + Core.isoParaBr(c.folga_data) + '</div>' : '') +
        '</td>' : '') +
      '<td><button class="btn sec mini" onclick="event.stopPropagation();abrirFicha(\'' + c.id + '\')">Abrir</button></td>' +
      '</tr>';
  }).join('');
}

function celContato(c, sc) {
  var out = [];
  var t = sc.telefone;
  if (t.tipo === 'vazio') out.push('<span class="tag vermelho">sem telefone</span>');
  else if (t.whatsapp) out.push('<span class="num">' + esc(t.exibicao) + '</span>');
  else if (t.tipo === 'fixo') out.push('<span class="num">' + esc(t.exibicao) + '</span> <span class="tag ambar">fixo</span>');
  else out.push('<span class="num">' + esc(c.telefone || '') + '</span> <span class="tag ambar">conferir</span>');
  if (!c.email) out.push('<span class="tag vermelho">sem e-mail</span>');
  else if (!Core.emailValido(c.email)) out.push('<span class="sub-cel">' + esc(c.email) + '</span> <span class="tag ambar">formato inválido</span>');
  else out.push('<span class="sub-cel">' + esc(c.email) + '</span>');
  return out.join('<br>');
}

/* ============================================================
   ABA — Experiência
   ============================================================ */
function renderExperiencia() {
  var busca = el('fExpBusca').value, etapa = el('fExpEtapa').value, uni = el('fExpUnidade').value;

  var base = colabs.filter(function (c) {
    if (!c.data_admissao) return false;
    if (uni !== 'todas' && (c.unidade || '') !== uni) return false;
    if (busca && Core.textoBusca(c).indexOf(Core.chaveNome(busca)) < 0 &&
        Core.cpfDigitos(c.cpf).indexOf(String(busca).replace(/\D/g, '')) < 0) return false;
    var res = Core.contratoResumo(c, cfg, hoje);
    if (etapa === 'andamento') return !res.encerrado;
    if (etapa === 'todas') return true;
    return res.status === etapa;
  });

  var porStatus = {};
  colabs.forEach(function (c) {
    if (!c.data_admissao) return;
    var s = Core.contratoResumo(c, cfg, hoje).status;
    porStatus[s] = (porStatus[s] || 0) + 1;
  });
  var atrasados = colabs.filter(function (c) {
    return c.data_admissao && Core.contratoResumo(c, cfg, hoje).atrasado;
  }).length;

  el('statsExp').innerHTML =
    stat('Exibindo', base.length, 'z') +
    stat('Aguardando 1º período', porStatus.p1_aguardando || 0, 'a') +
    stat('Renovação a confirmar', porStatus.renovacao_aprovada || 0, 'a') +
    stat('Aguardando decisão final', porStatus.p2_aguardando || 0, 'a') +
    stat('Em atraso', atrasados, 'r') +
    stat('Efetivados', porStatus.efetivado || 0, 'v') +
    stat('Reprovados', (porStatus.reprovado_p1 || 0) + (porStatus.reprovado_p2 || 0), 'r');

  renderRegularizar();

  base.sort(function (a, b) {
    var ra = Core.contratoResumo(a, cfg, hoje), rb = Core.contratoResumo(b, cfg, hoje);
    var pa = ra.prazo || '9999', pb = rb.prazo || '9999';
    return pa === pb ? Core.chaveNome(a.nome).localeCompare(Core.chaveNome(b.nome))
                     : (pa < pb ? -1 : 1);
  });

  var cab = '<tr><th>Colaborador</th><th>Admissão</th><th>Dia</th><th>30º dia</th>' +
    '<th>90º dia</th><th>Situação</th><th>Próxima providência</th><th></th></tr>';
  if (!base.length) {
    el('tbExp').innerHTML = cab + '<tr><td colspan="8" class="vazio">Nenhum contrato com esses filtros.</td></tr>';
    return;
  }

  el('tbExp').innerHTML = cab + base.map(function (c) {
    var r = Core.contratoResumo(c, cfg, hoje);
    var a = Core.acoesContrato(c, cfg, hoje);
    var bts = [];
    if (podeOperar(c)) {
      if (a.p1) bts.push('<button class="btn mini" onclick="decidirP1(\'' + c.id + '\')">Decidir 1º período</button>');
      if (a.renovar) bts.push('<button class="btn mini" onclick="confirmarRenovacao(\'' + c.id + '\')">Confirmar renovação</button>');
      if (a.p2) bts.push('<button class="btn mini" onclick="decidirP2(\'' + c.id + '\')">Decisão final</button>');
    }
    bts.push('<button class="btn sec mini" onclick="abrirFicha(\'' + c.id + '\')">Abrir</button>');

    var prazoDias = r.status.indexOf('p2') === 0 ? r.diasParaFimP2 : r.diasParaFimP1;
    return '<tr>' +
      '<td class="nome-cel">' + esc(Core.nomeApresentavel(c.nome)) +
        (c.unidade ? '<div class="sub-cel">' + esc(c.unidade) + '</div>' : '') + '</td>' +
      '<td class="num">' + Core.isoParaBr(c.data_admissao) + '</td>' +
      '<td class="num">' + (r.diaAtual || '—') + '</td>' +
      '<td class="num">' + Core.isoParaBr(r.fimP1) + '</td>' +
      '<td class="num">' + Core.isoParaBr(r.fimP2) + '</td>' +
      '<td>' + tagContrato(r) + (r.encerrado ? '' : '<div class="sub-cel">' + rotuloPrazo(prazoDias) + '</div>') + '</td>' +
      '<td class="sub-cel">' + esc(r.proximaAcao || '—') + '</td>' +
      '<td><div class="acoes">' + bts.join('') + '</div></td>' +
      '</tr>';
  }).join('');
}

/* Painel de regularização do histórico: aparece só quando há caso. */
function renderRegularizar() {
  var box = el('boxRegularizar');
  if (!ctx.pode_importar) { box.innerHTML = ''; return; }
  var alvos = Core.candidatosRegularizacao(colabs, cfg, hoje, 30);
  if (!alvos.length) { box.innerHTML = ''; return; }

  box.innerHTML = '<div class="aviso">' +
    '<b>' + alvos.length + ' colaborador(es) com contrato de experiência vencido há mais de 30 dias ' +
    'e sem nenhuma decisão registrada.</b><br>' +
    'São cadastros que já existiam antes deste módulo: o contrato terminou na prática, mas como não há ' +
    'registro, o sistema os cobra — corretamente — como decisão pendente, e isso encobre os contratos ' +
    'que estão de fato em jogo. Você pode efetivá-los de uma vez. A decisão fica registrada em nome de ' +
    'quem confirmar, com data, horário e observação, como qualquer outra.' +
    '<div class="acoes" style="margin-top:12px;">' +
    '<button class="btn" onclick="regularizarHistorico()">Regularizar ' + alvos.length + ' cadastro(s)</button>' +
    '<button class="btn sec" onclick="verRegularizar()">Ver a lista</button>' +
    '</div></div>';
}

function verRegularizar() {
  var alvos = Core.candidatosRegularizacao(colabs, cfg, hoje, 30);
  perguntar({
    titulo: 'Cadastros que seriam efetivados',
    texto: '<div class="lista-rolo">' + alvos.map(function (c) {
      var r = Core.contratoResumo(c, cfg, hoje);
      return '<div class="item"><b>' + esc(Core.nomeApresentavel(c.nome)) + '</b>' +
        '<div class="pq">admitido em ' + Core.isoParaBr(c.data_admissao) +
        ' · 90º dia em ' + Core.isoParaBr(r.fimP2) +
        ' · ' + (-r.diasParaFimP2) + ' dias atrás' +
        (c.unidade ? ' · ' + esc(c.unidade) : '') + '</div></div>';
    }).join('') + '</div>',
    confirmar: 'Fechar', semCancelar: true
  });
}

async function regularizarHistorico() {
  var alvos = Core.candidatosRegularizacao(colabs, cfg, hoje, 30);
  if (!alvos.length) return;
  var v = await perguntar({
    titulo: 'Regularizar histórico',
    texto: 'Serão marcados como <b>efetivados</b> ' + alvos.length + ' colaborador(es) cujo contrato ' +
           'de experiência terminou há mais de 30 dias sem decisão registrada.',
    alerta: 'Isto grava uma decisão em seu nome. Quem venceu recentemente <b>não</b> entra: ' +
            'esses continuam como pendência para você decidir caso a caso.',
    campos: [{ tipo: 'area', id: 'obs', rotulo: 'Observação (fica no histórico)',
      valor: 'Contrato de experiência concluído antes da adoção deste controle.', linhas: 3 }],
    confirmar: 'Efetivar ' + alvos.length + ' cadastro(s)'
  });
  if (!v) return;

  var r = await chamar('colab_regularizar_historico', {
    p_ids: alvos.map(function (c) { return c.id; }),
    p_obs: v.obs.trim(), p_dias_margem: 30
  });
  if (!r.ok) return;
  await refetchColabs();
  render();
  showToast((r.dados && r.dados.efetivados) + ' cadastro(s) regularizado(s)' +
    (r.dados && r.dados.ignorados ? ', ' + r.dados.ignorados + ' ignorado(s)' : ''));
}

/* ============================================================
   Decisões do contrato
   ============================================================ */
async function decidirP1(id) {
  var c = acharColab(id);
  if (!c) return;
  var r = Core.contratoResumo(c, cfg, hoje);
  var v = await perguntar({
    titulo: 'Decisão do 1º período — ' + Core.nomeApresentavel(c.nome),
    texto: 'Admissão em <b>' + Core.isoParaBr(c.data_admissao) + '</b>. O 1º período de 30 dias ' +
           'termina em <b>' + Core.isoParaBr(r.fimP1) + '</b> (' +
           (r.diasParaFimP1 < 0 ? 'há ' + (-r.diasParaFimP1) + ' dias' :
            r.diasParaFimP1 === 0 ? 'hoje' : 'em ' + r.diasParaFimP1 + ' dias') + ').',
    campos: [
      { tipo: 'select', id: 'decisao', rotulo: 'Decisão', valor: 'aprovado', opcoes: [
        { valor: 'aprovado', rotulo: 'Aprovado para renovação' },
        { valor: 'reprovado', rotulo: 'Reprovado — encerrar o contrato' },
        { valor: 'pendente', rotulo: 'Decisão pendente (manter cobrança)' }] },
      { tipo: 'area', id: 'obs', rotulo: 'Observação do gestor (interna)', linhas: 3,
        nota: 'Uso interno. <b>Não</b> aparece no termo entregue ao colaborador.' }
    ],
    confirmar: 'Registrar decisão'
  });
  if (!v) return;

  if (v.decisao === 'reprovado') {
    var conf = await perguntar({
      titulo: 'Confirmar a reprovação',
      texto: 'Confirma a reprovação de <b>' + esc(Core.nomeApresentavel(c.nome)) + '</b> no 1º período?',
      alerta: 'O colaborador passa a <b>Inativo</b>, o encerramento fica registrado em <b>' +
              Core.isoParaBr(r.fimP1) + '</b> e o Termo de Encerramento será gerado.',
      campos: [{ tipo: 'chk', id: 'termo', rotulo: 'Abrir o termo de encerramento em seguida', valor: true }],
      confirmar: 'Confirmar reprovação', perigo: true
    });
    if (!conf) return;
    var res = await chamar('colab_decisao_p1', { p_id: id, p_decisao: 'reprovado', p_obs: v.obs.trim() });
    if (!res.ok) return;
    await refetchColabs(); render();
    showToast('Reprovação registrada');
    if (conf.termo) abrirTermo(acharColab(id));
    return;
  }

  var res2 = await chamar('colab_decisao_p1',
    { p_id: id, p_decisao: v.decisao, p_obs: v.obs.trim() },
    v.decisao === 'aprovado' ? 'Aprovado. Confirme a renovação para o 2º período começar a contar.'
                             : 'Decisão marcada como pendente');
  if (!res2.ok) return;
  await refetchColabs(); render();
}

async function confirmarRenovacao(id) {
  var c = acharColab(id);
  if (!c) return;
  var r = Core.contratoResumo(c, cfg, hoje);
  var v = await perguntar({
    titulo: 'Confirmar a renovação — ' + Core.nomeApresentavel(c.nome),
    texto: 'Com a renovação confirmada, o 2º período começa no <b>31º dia</b> (' +
           Core.isoParaBr(r.inicioP2) + '), soma <b>60 dias corridos</b> e o contrato de experiência ' +
           'passa a terminar em <b>' + Core.isoParaBr(r.fimP2) + '</b> — o 90º dia contado da admissão.',
    campos: [{ tipo: 'area', id: 'obs', rotulo: 'Observação (opcional)', linhas: 2 }],
    confirmar: 'Confirmar renovação'
  });
  if (!v) return;
  var res = await chamar('colab_confirmar_renovacao', { p_id: id, p_obs: v.obs.trim() });
  if (!res.ok) return;
  await refetchColabs(); render();
  showToast('Renovação confirmada. Contrato até ' + Core.isoParaBr(res.dados));
}

async function decidirP2(id) {
  var c = acharColab(id);
  if (!c) return;
  var r = Core.contratoResumo(c, cfg, hoje);
  var v = await perguntar({
    titulo: 'Decisão final — ' + Core.nomeApresentavel(c.nome),
    texto: 'O contrato de experiência termina em <b>' + Core.isoParaBr(r.fimP2) + '</b>, 90º dia ' +
           'contado da admissão de ' + Core.isoParaBr(c.data_admissao) + ' (' +
           (r.diasParaFimP2 < 0 ? 'há ' + (-r.diasParaFimP2) + ' dias' :
            r.diasParaFimP2 === 0 ? 'hoje' : 'em ' + r.diasParaFimP2 + ' dias') + ').',
    campos: [
      { tipo: 'select', id: 'decisao', rotulo: 'Decisão', valor: 'efetivado', opcoes: [
        { valor: 'efetivado', rotulo: 'Efetivar colaborador' },
        { valor: 'encerrado', rotulo: 'Encerrar contrato' },
        { valor: 'pendente', rotulo: 'Decisão pendente (manter cobrança)' }] },
      { tipo: 'area', id: 'obs', rotulo: 'Observação do gestor (interna)', linhas: 3,
        nota: 'Uso interno. <b>Não</b> aparece no termo entregue ao colaborador.' }
    ],
    confirmar: 'Registrar decisão'
  });
  if (!v) return;

  if (v.decisao === 'encerrado') {
    var conf = await perguntar({
      titulo: 'Confirmar o encerramento',
      texto: 'Confirma encerrar o contrato de <b>' + esc(Core.nomeApresentavel(c.nome)) + '</b> ' +
             'ao fim do período de experiência?',
      alerta: 'O colaborador passa a <b>Inativo</b> e o Termo de Encerramento será gerado.',
      campos: [
        { tipo: 'data', id: 'data', rotulo: 'Data do encerramento', valor: r.fimP2 },
        { tipo: 'chk', id: 'termo', rotulo: 'Abrir o termo de encerramento em seguida', valor: true }
      ],
      validar: function (x) { return x.data ? null : 'Informe a data do encerramento.'; },
      confirmar: 'Confirmar encerramento', perigo: true
    });
    if (!conf) return;
    var res = await chamar('colab_decisao_p2', {
      p_id: id, p_decisao: 'encerrado', p_obs: v.obs.trim(), p_data_encerramento: conf.data });
    if (!res.ok) return;
    await refetchColabs(); render();
    showToast('Encerramento registrado');
    if (conf.termo) abrirTermo(acharColab(id));
    return;
  }

  var res2 = await chamar('colab_decisao_p2',
    { p_id: id, p_decisao: v.decisao, p_obs: v.obs.trim(), p_data_encerramento: null },
    v.decisao === 'efetivado' ? 'Colaborador efetivado' : 'Decisão marcada como pendente');
  if (!res2.ok) return;
  await refetchColabs(); render();
}

async function encerrarAvulso(id) {
  var c = acharColab(id);
  if (!c) return;
  var v = await perguntar({
    titulo: 'Encerrar contrato — ' + Core.nomeApresentavel(c.nome),
    texto: 'Use para encerramentos fora dos dois pontos de decisão do período de experiência.',
    alerta: 'O colaborador passa a <b>Inativo</b>.',
    campos: [
      { tipo: 'data', id: 'data', rotulo: 'Data do encerramento', valor: hoje },
      { tipo: 'texto', id: 'motivo', rotulo: 'Motivo (aparece no cadastro)', dica: 'ex.: pedido de demissão' },
      { tipo: 'area', id: 'obs', rotulo: 'Observação interna', linhas: 3 },
      { tipo: 'chk', id: 'termo', rotulo: 'Abrir o termo de encerramento em seguida', valor: false }
    ],
    validar: function (x) { return x.data ? null : 'Informe a data do encerramento.'; },
    confirmar: 'Encerrar contrato', perigo: true
  });
  if (!v) return;
  var res = await chamar('colab_encerrar',
    { p_id: id, p_data: v.data, p_motivo: v.motivo.trim(), p_obs: v.obs.trim() },
    'Contrato encerrado');
  if (!res.ok) return;
  await refetchColabs(); render();
  if (v.termo) abrirTermo(acharColab(id));
}

/* ============================================================
   Termo de encerramento — janela pronta para imprimir / salvar PDF
   ============================================================ */
function abrirTermo(c) {
  if (!c) return;
  if (!ctx.pode_exportar) {
    showToast('Somente RH ou administrador pode gerar documentos.', true);
    return;
  }
  var t = Core.montarTermo(c, cfg, { dataEmissao: hoje });
  var w = window.open('', '_blank');
  if (!w) {
    showToast('O navegador bloqueou a janela. Abra o cadastro e use o botão "Gerar termo".', true);
    return;
  }
  var paragrafos = t.texto.split('\n').map(function (l) {
    if (!l.trim()) return '<div style="height:12px"></div>';
    if (/^TERMO DE ENCERRAMENTO/.test(l)) return '<h1>' + esc(l) + '</h1>';
    if (/^_{8,}$/.test(l.trim())) return '<div class="linha-ass"></div>';
    return '<p>' + esc(l) + '</p>';
  }).join('');

  w.document.write('<!DOCTYPE html><html lang="pt-BR"><head><meta charset="UTF-8">' +
    '<title>Termo de Encerramento — ' + esc(Core.nomeApresentavel(c.nome)) + '</title><style>' +
    'body{font-family:Georgia,"Times New Roman",serif;max-width:760px;margin:0 auto;padding:36px 30px 60px;' +
      'color:#111;line-height:1.75;font-size:15px;}' +
    'h1{font-size:17px;text-align:center;text-transform:uppercase;letter-spacing:.04em;' +
      'margin:0 0 26px;line-height:1.4;}' +
    'p{margin:0 0 10px;text-align:justify;}' +
    '.linha-ass{border-top:1px solid #111;width:330px;margin:30px 0 4px;}' +
    '.barra{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;background:#fff3e0;' +
      'border:1px solid #f2d19a;border-left:5px solid #e07a00;border-radius:10px;padding:13px 16px;' +
      'margin-bottom:26px;font-size:13px;color:#8a4b00;line-height:1.5;}' +
    '.barra b{color:#7a4200;}' +
    '.bt{font-family:system-ui,sans-serif;margin-bottom:22px;display:flex;gap:8px;}' +
    '.bt button{font:inherit;font-size:14px;font-weight:600;padding:9px 16px;border-radius:9px;' +
      'border:none;cursor:pointer;background:#1fa855;color:#fff;}' +
    '.bt button.sec{background:#fff;color:#16211c;border:1px solid #dbe1dd;}' +
    '.falta{font-family:system-ui,sans-serif;background:#fbe9e6;border:1px solid #eec4bd;color:#b23a2b;' +
      'border-radius:10px;padding:12px 15px;margin-bottom:20px;font-size:13px;}' +
    '@media print{.barra,.bt,.falta{display:none !important;}body{padding:0;max-width:none;}}' +
    '</style></head><body>' +
    '<div class="bt"><button onclick="window.print()">Imprimir / salvar em PDF</button>' +
      '<button class="sec" onclick="window.close()">Fechar</button></div>' +
    '<div class="barra"><b>Modelo operacional.</b> Este documento foi gerado automaticamente pelo ' +
      'módulo de Gestão de Colaboradores e pode precisar de validação do RH / Departamento Pessoal ou da ' +
      'assessoria jurídica antes do uso definitivo. A observação interna do gestor não é incluída aqui. ' +
      'Gerado por ' + esc(ctx.email) + ' em ' + esc(Core.isoParaBr(hoje)) + '. ' +
      '<span style="display:block;margin-top:6px;">Esta tarja não sai na impressão.</span></div>' +
    (t.camposFaltando.length
      ? '<div class="falta"><b>Faltam dados:</b> ' + esc(t.camposFaltando.join(', ')) +
        '. Preencha em Configurações (ou no cadastro) e gere de novo — as lacunas estão marcadas com ' +
        'linhas para preenchimento à mão.</div>'
      : '') +
    paragrafos + '</body></html>');
  w.document.close();

  sb.rpc('colab_registrar_documento', { p_id: c.id, p_tipo: 'Termo de Encerramento de Contrato de Experiência' });
}

/* ============================================================
   ABA — Aniversariantes
   ============================================================ */
function renderAniversarios() {
  var p = Core.partes(hoje);
  var uni = el('fAnivUnidade').value;
  var modo = el('fAnivMes').value;
  var base = ativos().filter(function (c) {
    return uni === 'todas' || (c.unidade || '') === uni;
  });

  var meses = [];
  if (modo === 'ano') {
    for (var m = 1; m <= 12; m++) meses.push({ ano: p.ano, mes: m });
  } else {
    meses.push({ ano: p.ano, mes: p.mes });
    meses.push(Core.mesSeguinte(p.ano, p.mes));
  }

  el('listaAniv').innerHTML = meses.map(function (mm) {
    var lista = Core.aniversariantesDoMes(base, mm.ano, mm.mes, hoje);
    var atual = mm.ano === p.ano && mm.mes === p.mes;
    var cab = '<div class="caixa" style="padding:14px 16px;"><div class="bloco" style="margin:0;border:none;padding:0;">' +
      '<div class="cab"><h2 style="margin:0;">' + Core.rotuloMes(mm.ano, mm.mes) +
      (atual ? ' <span class="tag verde">mês atual</span>' : '') +
      '</h2><span class="sub">' + lista.length + ' aniversariante' + (lista.length === 1 ? '' : 's') + '</span></div>';
    if (!lista.length) {
      return cab + '<p class="vazio" style="padding:14px;">Ninguém faz aniversário neste mês.</p></div></div>';
    }
    var mostraFolga = cfg.politica_folga_ativa !== false;
    var tabela = '<div class="tabela-rolo" style="margin-top:4px;"><table><tr>' +
      '<th>Dia</th><th>Colaborador</th><th>Idade</th><th>Telefone</th><th>Unidade</th>' +
      '<th>Mensagem</th>' + (mostraFolga ? '<th>Folga</th>' : '') + '<th></th></tr>' +
      lista.map(function (a) {
        var c = a.colaborador;
        var t = Core.analisarTelefone(c.telefone);
        var enviada = Core.msgAnivEnviada(c, mm.ano);
        var bts = [];
        if (podeOperar(c)) {
          bts.push(t.whatsapp
            ? '<button class="btn mini" onclick="abrirWhatsDireto(\'' + c.id + '\',' + mm.ano + ')">WhatsApp</button>'
            : '<button class="btn mini" disabled title="' +
              esc(t.tipo === 'vazio' ? 'Sem telefone cadastrado' : t.motivo) + '">WhatsApp</button>');
          bts.push('<button class="btn sec mini" onclick="marcarMsgEnviada(\'' + c.id + '\',' + mm.ano + ')">' +
            (enviada ? 'Novo envio' : 'Registrar envio') + '</button>');
          if (mostraFolga) bts.push('<button class="btn sec mini" onclick="tratarFolga(\'' + c.id + '\',' + mm.ano + ')">Folga</button>');
        }
        bts.push('<button class="btn sec mini" onclick="abrirFicha(\'' + c.id + '\')">Abrir</button>');
        return '<tr>' +
          '<td class="num"><b>' + Core.pad2(a.dia) + '</b>' +
            (a.adiado ? '<div class="sub-cel">nasceu 29/02</div>' : '') + '</td>' +
          '<td class="nome-cel">' + esc(Core.nomeApresentavel(c.nome)) +
            (a.diasPara !== null && a.diasPara >= 0 && a.diasPara <= (cfg.dias_aviso_aniv === undefined ? 7 : cfg.dias_aviso_aniv)
              ? '<div class="sub-cel">' + (a.diasPara === 0 ? 'é hoje 🎉' : 'em ' + a.diasPara + ' dia(s)') + '</div>'
              : '') + '</td>' +
          '<td class="num">' + a.idade + '</td>' +
          '<td class="num">' + (t.whatsapp ? esc(t.exibicao)
              : '<span class="tag ' + (t.tipo === 'vazio' ? 'vermelho' : 'ambar') + '">' +
                (t.tipo === 'vazio' ? 'sem telefone' : 'conferir') + '</span>') + '</td>' +
          '<td>' + esc(c.unidade || '—') + '</td>' +
          '<td>' + (enviada
              ? '<span class="tag verde">enviada</span><div class="sub-cel">' +
                fmtDataHora(c.aniv_msg_em) + (c.aniv_msg_por ? '<br>por ' + esc(c.aniv_msg_por) : '') + '</div>'
              : '<span class="tag cinza">não enviada</span>') + '</td>' +
          (mostraFolga ? '<td>' + (c.folga_ano === mm.ano ? tagFolga(c.folga_status) : tagFolga('nao_analisada')) +
            (c.folga_ano === mm.ano && c.folga_data ? '<div class="sub-cel">' + Core.isoParaBr(c.folga_data) + '</div>' : '') +
            '</td>' : '') +
          '<td><div class="acoes">' + bts.join('') + '</div></td></tr>';
      }).join('') + '</table></div>';
    return cab + tabela + '</div></div>';
  }).join('');
}

/* Atalho da lista de aniversariantes: abre a conversa com a mensagem já
   montada. Para editar o texto antes, o caminho é a ficha do colaborador
   (botão "Abrir"), onde a mensagem fica num campo editável. */
function abrirWhatsDireto(id, ano) {
  var c = acharColab(id);
  if (!c) return;
  var t = Core.analisarTelefone(c.telefone);
  if (!t.whatsapp) {
    showToast(t.tipo === 'vazio' ? 'Sem telefone cadastrado.' : 'Telefone fora do padrão: ' + t.motivo, true);
    return;
  }
  var msg = Core.montarMsgAniversario(cfg.msg_aniversario, c, {
    idade: Core.idadeQueFaz(c.data_nascimento, ano), empresa: cfg.empresa_nome
  });
  window.open(Core.linkWhatsapp(t.digitos, msg), '_blank', 'noopener');
  showToast('Conversa aberta. Depois de enviar, registre com "Registrar envio".');
}

/* Ações da mensagem, chamadas pelos botões dentro da ficha. */
function copiarTexto(txt) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(txt).then(function () { showToast('Mensagem copiada'); },
      function () { copiarFallback(txt); });
  } else copiarFallback(txt);
}
function copiarFallback(txt) {
  var ta = document.createElement('textarea');
  ta.value = txt; ta.style.position = 'fixed'; ta.style.opacity = '0';
  document.body.appendChild(ta); ta.select();
  try { document.execCommand('copy'); showToast('Mensagem copiada'); }
  catch (e) { showToast('Não foi possível copiar. Selecione o texto e copie à mão.', true); }
  document.body.removeChild(ta);
}

async function marcarMsgEnviada(id, ano) {
  var c = acharColab(id);
  if (!c) return;
  var v = await perguntar({
    titulo: 'Registrar mensagem como enviada',
    texto: 'Confirma que a mensagem de aniversário de <b>' + esc(Core.nomeApresentavel(c.nome)) +
           '</b> foi enviada? Ficam registrados a data, o horário e o seu usuário.',
    confirmar: 'Registrar envio'
  });
  if (!v) return;
  var r = await chamar('colab_msg_aniv', { p_id: id, p_ano: ano }, 'Envio registrado');
  if (!r.ok) return;
  await refetchColabs(); render();
}

/* ============================================================
   ABA — Folgas
   ============================================================ */
function renderFolgas() {
  var box = el('folgaDesligada');
  if (cfg.politica_folga_ativa === false) {
    box.innerHTML = '<div class="aviso">A concessão de folga de aniversário está <b>desligada</b> ' +
      'em Configurações. O histórico continua visível, mas o módulo não cobra folga.</div>';
  } else box.innerHTML = '';

  var p = Core.partes(hoje);
  var st = el('fFolgaStatus').value, uni = el('fFolgaUnidade').value, mes = el('fFolgaMes').value;

  var base = ativos().filter(function (c) {
    if (!Core.partes(c.data_nascimento)) return false;
    if (uni !== 'todas' && (c.unidade || '') !== uni) return false;
    if (mes !== 'todos' && Core.partes(c.data_nascimento).mes !== +mes) return false;
    if (st === 'atencao') return folgaPedeAtencao(c, p);
    if (st === 'pendentes') {
      return Core.folgaPendenteNoAno(c, p.ano) ||
             (c.folga_ano === p.ano && c.folga_status === 'aprovada' && !c.folga_data);
    }
    if (st === 'todas') return true;
    return c.folga_status === st && c.folga_ano === p.ano;
  });

  var porStatus = {};
  ativos().forEach(function (c) {
    if (!Core.partes(c.data_nascimento)) return;
    var s = c.folga_ano === p.ano ? c.folga_status : 'nao_analisada';
    porStatus[s] = (porStatus[s] || 0) + 1;
  });
  el('statsFolga').innerHTML =
    stat('Exibindo', base.length, 'z') +
    stat('Não analisadas', porStatus.nao_analisada || 0, 'a') +
    stat('Aguardando aprovação', porStatus.aguardando_aprovacao || 0, 'a') +
    stat('Aprovadas', porStatus.aprovada || 0, 'v') +
    stat('Agendadas', porStatus.agendada || 0, 'z') +
    stat('Realizadas', porStatus.realizada || 0, 'v') +
    stat('Recusadas', porStatus.recusada || 0, 'r');

  base.sort(function (a, b) {
    var ma = Core.partes(a.data_nascimento), mb = Core.partes(b.data_nascimento);
    return ma.mes - mb.mes || ma.dia - mb.dia ||
           Core.chaveNome(a.nome).localeCompare(Core.chaveNome(b.nome));
  });

  var cab = '<tr><th>Colaborador</th><th>Aniversário</th><th>Competência</th><th>Status</th>' +
    '<th>Data da folga</th><th>Aprovação</th><th>Unidade</th><th></th></tr>';
  if (!base.length) {
    el('tbFolga').innerHTML = cab + '<tr><td colspan="8" class="vazio">Nenhuma folga com esses filtros.</td></tr>';
  } else {
    el('tbFolga').innerHTML = cab + base.map(function (c) {
      var pn = Core.partes(c.data_nascimento);
      var doAno = c.folga_ano === p.ano;
      var conflitos = c.folga_data ? Core.conflitosFolga(colabs, c, c.folga_data) : [];
      return '<tr>' +
        '<td class="nome-cel">' + esc(Core.nomeApresentavel(c.nome)) + '</td>' +
        '<td class="num">' + Core.isoParaBr(Core.aniversarioNoAno(c.data_nascimento, p.ano)) +
          (Core.ehAniversarioAdiado(c.data_nascimento, p.ano) ? '<div class="sub-cel">nasceu 29/02</div>' : '') + '</td>' +
        '<td>' + Core.MESES[pn.mes - 1] + ' / ' + p.ano + '</td>' +
        '<td>' + (doAno ? tagFolga(c.folga_status) : tagFolga('nao_analisada')) +
          (doAno && c.folga_excepcional ? ' <span class="tag ambar">exceção</span>' : '') + '</td>' +
        '<td class="num">' + (doAno && c.folga_data ? Core.isoParaBr(c.folga_data) : '—') +
          (conflitos.length ? '<div class="sub-cel"><span class="tag ambar">' + conflitos.length +
            ' na mesma data e unidade</span></div>' : '') + '</td>' +
        '<td class="sub-cel">' + (doAno && c.folga_aprovada_por
            ? esc(c.folga_aprovada_por) + '<br>' + fmtDataHora(c.folga_aprovada_em) : '—') + '</td>' +
        '<td>' + esc(c.unidade || '—') + '</td>' +
        '<td><div class="acoes">' +
          (podeOperar(c) ? '<button class="btn mini" onclick="tratarFolga(\'' + c.id + '\',' + p.ano + ')">Tratar</button>' : '') +
          '<button class="btn sec mini" onclick="abrirFicha(\'' + c.id + '\')">Abrir</button>' +
        '</div></td></tr>';
    }).join('');
  }

  // Calendário de folgas já agendadas, por unidade — o "impacto operacional".
  var agendadas = colabs.filter(function (c) {
    return c.folga_data && c.folga_ano === p.ano &&
      ['aprovada','agendada','realizada','reagendada_excepcional'].indexOf(c.folga_status) >= 0;
  }).sort(function (a, b) { return a.folga_data < b.folga_data ? -1 : 1; });

  if (!agendadas.length) {
    el('agendaFolga').innerHTML = '<h2>Folgas com data marcada</h2>' +
      '<p class="vazio" style="padding:14px;">Nenhuma folga com data neste ano.</p>';
  } else {
    var porData = {};
    agendadas.forEach(function (c) {
      var k = c.folga_data + '|' + (c.unidade || '—');
      (porData[k] = porData[k] || []).push(c);
    });
    el('agendaFolga').innerHTML = '<h2>Folgas com data marcada em ' + p.ano + '</h2>' +
      '<p class="sub">Duas ou mais pessoas da mesma unidade no mesmo dia aparecem destacadas — ' +
      'é aviso de impacto operacional, não impedimento.</p>' +
      '<div class="lista-rolo" style="margin-top:10px;">' +
      Object.keys(porData).sort().map(function (k) {
        var g = porData[k], data = k.split('|')[0], uni2 = k.split('|')[1];
        return '<div class="item' + (g.length > 1 ? ' atencao' : '') + '">' +
          '<b>' + Core.isoParaBr(data) + '</b> · ' + esc(uni2) +
          (g.length > 1 ? ' <span class="tag ambar">' + g.length + ' pessoas</span>' : '') +
          '<div class="pq">' + g.map(function (c) {
            return esc(Core.nomeApresentavel(c.nome)) + ' (' + (Core.FOLGA_STATUS[c.folga_status] || {}).rotulo + ')';
          }).join(' · ') + '</div></div>';
      }).join('') + '</div>';
  }
}

var folgaConflitoCiente = null;

async function tratarFolga(id, ano) {
  var c = acharColab(id);
  if (!c) return;
  folgaConflitoCiente = null;
  if (!Core.partes(c.data_nascimento)) {
    showToast('Sem data de nascimento não é possível tratar a folga de aniversário.', true);
    return;
  }
  var pn = Core.partes(c.data_nascimento);
  var mesNome = Core.MESES[pn.mes - 1];
  var doAno = c.folga_ano === ano;

  var v = await perguntar({
    titulo: 'Folga de aniversário — ' + Core.nomeApresentavel(c.nome),
    texto: 'Aniversário em <b>' + Core.isoParaBr(Core.aniversarioNoAno(c.data_nascimento, ano)) +
      '</b>. A folga não precisa cair no dia do aniversário, mas precisa acontecer dentro de <b>' +
      mesNome + ' de ' + ano + '</b> — a competência do mês.',
    campos: [
      { tipo: 'select', id: 'status', rotulo: 'Situação', valor: doAno ? c.folga_status : 'nao_analisada',
        opcoes: Object.keys(Core.FOLGA_STATUS).map(function (k) {
          return { valor: k, rotulo: Core.FOLGA_STATUS[k].rotulo };
        }) },
      { tipo: 'data', id: 'data', rotulo: 'Data da folga', valor: doAno ? (c.folga_data || '') : '',
        nota: 'Deixe em branco enquanto a data não estiver definida.' },
      { tipo: 'chk', id: 'exc', rotulo: 'Exceção autorizada: permitir data fora de ' + mesNome,
        valor: doAno ? !!c.folga_excepcional : false },
      { tipo: 'area', id: 'obs', rotulo: 'Observação', valor: doAno ? (c.folga_obs || '') : '', linhas: 2 }
    ],
    validar: function (x) {
      if (['aprovada','agendada','realizada','reagendada_excepcional'].indexOf(x.status) >= 0 &&
          x.status !== 'aprovada' && !x.data) {
        return 'Para marcar como <b>' + Core.FOLGA_STATUS[x.status].rotulo +
               '</b> é preciso informar a data da folga.';
      }
      if (!x.data) return null;
      var val = Core.validarFolga(c, x.data, ano, x.exc);
      if (!val.ok) return val.erros.join(' ');
      var conf = Core.conflitosFolga(colabs, c, x.data);
      // Conflito na mesma data e unidade avisa, mas não impede: o escopo
      // diz que o gestor autorizado pode prosseguir. O aviso vale para a
      // data mostrada — se a data mudar, avisa de novo.
      if (conf.length && folgaConflitoCiente !== x.data) {
        folgaConflitoCiente = x.data;
        return 'Atenção: já há ' + conf.length + ' folga(s) marcada(s) em ' +
          Core.isoParaBr(x.data) + ' na unidade ' + esc(c.unidade || '—') + ' (' +
          conf.map(function (o) { return esc(Core.nomeApresentavel(o.nome)); }).join(', ') +
          '). Isso pode ter impacto operacional. Confirme de novo para prosseguir mesmo assim.';
      }
      return null;
    },
    confirmar: 'Salvar folga'
  });
  if (!v) return;

  var r = await chamar('colab_folga', {
    p_id: id, p_status: v.status, p_data: v.data || null,
    p_obs: v.obs.trim(), p_ano: ano, p_excepcional: !!v.exc
  }, 'Folga registrada');
  if (!r.ok) return;
  await refetchColabs(); render();
}

/* ============================================================
   ABA — Cadastro (telefone e e-mail)
   ============================================================ */
function renderCadastro() {
  var busca = el('fCadBusca').value, tipo = el('fCadTipo').value, uni = el('fCadUnidade').value;

  var base = ativos().filter(function (c) {
    if (uni !== 'todas' && (c.unidade || '') !== uni) return false;
    if (busca) {
      var t = Core.textoBusca(c), d = String(busca).replace(/\D/g, '');
      if (t.indexOf(Core.chaveNome(busca)) < 0 &&
          !(d.length >= 3 && t.replace(/\D/g, '').indexOf(d) >= 0)) return false;
    }
    var sc = Core.situacaoCadastro(c);
    if (tipo === 'todos') return true;
    if (tipo === 'incompletos') return sc.contatoIncompleto;
    if (tipo === 'sem_telefone') return sc.telefone.tipo === 'vazio';
    if (tipo === 'sem_email') return !String(c.email || '').trim();
    if (tipo === 'invalidos') {
      return sc.problemas.some(function (p) {
        return (p.campo === 'telefone' || p.campo === 'email') &&
               (p.grau === 'invalido' || p.grau === 'atencao');
      });
    }
    return true;
  });

  var todos = ativos();
  el('statsCad').innerHTML =
    stat('Exibindo', base.length, 'z') +
    stat('Sem telefone', todos.filter(function (c) {
      return Core.analisarTelefone(c.telefone).tipo === 'vazio'; }).length, 'r') +
    stat('Telefone a conferir', todos.filter(function (c) {
      var t = Core.analisarTelefone(c.telefone);
      return t.tipo !== 'vazio' && !t.whatsapp; }).length, 'a') +
    stat('Sem e-mail', todos.filter(function (c) { return !String(c.email || '').trim(); }).length, 'r') +
    stat('E-mail inválido', todos.filter(function (c) {
      return String(c.email || '').trim() && !Core.emailValido(c.email); }).length, 'a') +
    stat('Prontos para WhatsApp', todos.filter(function (c) {
      return Core.analisarTelefone(c.telefone).whatsapp; }).length, 'v');

  base.sort(function (a, b) { return Core.chaveNome(a.nome).localeCompare(Core.chaveNome(b.nome)); });

  var cab = '<tr><th>Colaborador</th><th>Unidade</th><th>Telefone</th><th>E-mail</th>' +
    '<th>Pendências</th><th>Última alteração</th><th></th></tr>';
  if (!base.length) {
    el('tbCad').innerHTML = cab + '<tr><td colspan="7" class="vazio">' +
      (tipo === 'incompletos' ? 'Nenhum cadastro incompleto — telefone e e-mail estão em ordem.' :
       'Ninguém com esses filtros.') + '</td></tr>';
    return;
  }

  el('tbCad').innerHTML = cab + base.map(function (c) {
    var sc = Core.situacaoCadastro(c);
    var t = sc.telefone;
    var probs = sc.problemas.filter(function (p) {
      return p.campo === 'telefone' || p.campo === 'email'; });
    var sug = probs.filter(function (p) { return p.sugestao; })[0];
    return '<tr>' +
      '<td class="nome-cel">' + esc(Core.nomeApresentavel(c.nome)) + '</td>' +
      '<td>' + esc(c.unidade || '—') + '</td>' +
      '<td class="num">' + (t.tipo === 'vazio'
          ? '<span class="oculto">—</span>'
          : esc(t.exibicao || c.telefone)) +
        (t.whatsapp ? ' <span class="tag verde">WhatsApp</span>'
                    : t.tipo === 'fixo' ? ' <span class="tag ambar">fixo</span>' : '') + '</td>' +
      '<td>' + (c.email ? esc(c.email) : '<span class="oculto">—</span>') + '</td>' +
      '<td>' + (probs.length
          ? probs.map(function (p) {
              return '<span class="tag ' + (p.grau === 'ausente' ? 'vermelho' : 'ambar') + '">' +
                     esc(p.texto) + '</span>'; }).join('<br>')
          : '<span class="tag verde">completo</span>') + '</td>' +
      '<td class="sub-cel">' + fmtDataHora(c.alterado_em) + '</td>' +
      '<td><div class="acoes">' +
        (podeOperar(c) ? '<button class="btn mini" onclick="editarContato(\'' + c.id + '\')">Editar</button>' : '') +
        (sug && podeOperar(c) ? '<button class="btn sec mini" onclick="aplicarSugestao(\'' + c.id +
          '\',\'' + sug.sugestao + '\')">Usar ' + esc(Core.exibirTelefone(sug.sugestao)) + '</button>' : '') +
        '<button class="btn sec mini" onclick="abrirFicha(\'' + c.id + '\')">Abrir</button>' +
      '</div></td></tr>';
  }).join('');
}

async function editarContato(id) {
  var c = acharColab(id);
  if (!c) return;
  var t = Core.analisarTelefone(c.telefone);
  var v = await perguntar({
    titulo: 'Atualizar contato — ' + Core.nomeApresentavel(c.nome),
    texto: 'O valor anterior, o novo, o seu usuário e o horário ficam no histórico do colaborador.',
    campos: [
      { tipo: 'texto', id: 'tel', rotulo: 'Telefone com DDD', valor: t.exibicao || c.telefone || '',
        dica: '(61) 99999-8888',
        nota: 'Guardado no padrão do WhatsApp: 55 + DDD + número. Celular precisa dos 9 dígitos.' +
              (t.sugestao ? ' Sugestão a partir do valor atual: <b>' +
                esc(Core.exibirTelefone(t.sugestao)) + '</b>.' : '') },
      { tipo: 'texto', id: 'mail', rotulo: 'E-mail', valor: c.email || '', dica: 'nome@dominio.com' }
    ],
    validar: function (x) {
      var erros = [];
      if (x.tel.trim()) {
        var a = Core.analisarTelefone(x.tel);
        if (a.tipo === 'incompleto') erros.push('Telefone: ' + a.motivo + '. Sugestão: ' +
          Core.exibirTelefone(a.sugestao));
        else if (!a.ok) erros.push('Telefone: ' + a.motivo);
      }
      if (x.mail.trim() && !Core.emailValido(x.mail.trim())) erros.push('E-mail em formato inválido.');
      return erros.length ? erros.join('<br>') : null;
    },
    confirmar: 'Salvar'
  });
  if (!v) return;
  var r = await chamar('colab_atualizar_contato',
    { p_id: id, p_email: v.mail.trim(), p_telefone: v.tel.trim() }, 'Contato atualizado');
  if (!r.ok) return;
  await refetchColabs(); render();
}

async function aplicarSugestao(id, sugestao) {
  var c = acharColab(id);
  if (!c) return;
  var v = await perguntar({
    titulo: 'Confirmar o nono dígito',
    texto: 'O telefone de <b>' + esc(Core.nomeApresentavel(c.nome)) + '</b> está cadastrado com 8 dígitos ' +
      '(<code>' + esc(Core.exibirTelefone(c.telefone)) + '</code>), formato anterior ao nono dígito. ' +
      'Gravar como <b>' + esc(Core.exibirTelefone(sugestao)) + '</b>?',
    alerta: 'É uma <b>suposição</b>: acrescentar o 9 costuma acertar, mas não há como confirmar sem ' +
      'falar com a pessoa. Se o número estiver errado, a mensagem vai para outro contato.',
    confirmar: 'Gravar com o 9'
  });
  if (!v) return;
  var r = await chamar('colab_atualizar_contato',
    { p_id: id, p_email: c.email || '', p_telefone: sugestao }, 'Telefone atualizado');
  if (!r.ok) return;
  await refetchColabs(); render();
}

/* ============================================================
   Ficha do colaborador
   ============================================================ */
var fichaHist = null;

async function abrirFicha(id) {
  var c = acharColab(id);
  if (!c) return;
  fichaAtual = c;
  fichaHist = null;
  desenharFicha();
  el('ficha').classList.add('on');
  var r = await sb.rpc('colab_historico', { p_id: id });
  fichaHist = r.error ? { erro: r.error.message } : r.data;
  if (fichaAtual && fichaAtual.id === id) desenharFicha();
}
function fecharFicha() {
  el('ficha').classList.remove('on');
  fichaAtual = null; fichaHist = null;
}

function desenharFicha() {
  var c = fichaAtual;
  if (!c) return;
  var res = Core.contratoResumo(c, cfg, hoje);
  var acoes = Core.acoesContrato(c, cfg, hoje);
  var sc = Core.situacaoCadastro(c);
  var p = Core.partes(hoje);
  var operar = podeOperar(c);
  var mostraFolga = cfg.politica_folga_ativa !== false;

  el('fichaNome').innerHTML = esc(Core.nomeApresentavel(c.nome)) +
    (c.situacao === 'Inativo' ? ' <span class="tag cinza">inativo</span>' : '');
  el('fichaSub').innerHTML = [
    c.unidade ? esc(c.unidade) : null,
    'CPF ' + cpfNaTela(c, c.ve_sensivel),
    c.data_admissao ? 'admitido em ' + Core.isoParaBr(c.data_admissao) : 'sem data de admissão'
  ].filter(Boolean).join(' · ');

  var h = '';

  /* --- dados --- */
  h += '<div class="dados">' +
    dado('Nome completo', esc(Core.nomeApresentavel(c.nome))) +
    dado('CPF', cpfNaTela(c, c.ve_sensivel)) +
    dado('Nome da mãe', c.ve_sensivel
      ? (c.nome_mae ? esc(Core.nomeApresentavel(c.nome_mae)) : '<span class="oculto">não cadastrado</span>')
      : '<span class="oculto">restrito ao RH</span>') +
    dado('Data de nascimento', c.data_nascimento
      ? Core.isoParaBr(c.data_nascimento) + ' <span class="sub-cel">(' +
        Core.idadeQueFaz(c.data_nascimento, p.ano) + ' anos em ' + p.ano + ')</span>'
      : '<span class="oculto">não cadastrada</span>') +
    dado('Data de admissão', c.data_admissao ? Core.isoParaBr(c.data_admissao)
      : '<span class="oculto">não cadastrada</span>') +
    dado('Unidade', esc(c.unidade || '—')) +
    dado('Situação', c.situacao + (c.data_desligamento
      ? ' <span class="sub-cel">desde ' + Core.isoParaBr(c.data_desligamento) + '</span>' : '')) +
    dado('Origem do cadastro', c.origem === 'importacao' ? 'importação de planilha' : 'cadastro manual') +
    '</div>';

  /* --- contato --- */
  h += '<div class="bloco"><div class="cab"><h3>Contato</h3>' +
    (operar ? '<button class="btn sec mini" style="margin-left:auto" onclick="editarContato(\'' + c.id + '\')">Editar telefone e e-mail</button>' : '') +
    '</div>' +
    '<div class="dados">' +
      dado('Telefone', sc.telefone.tipo === 'vazio'
        ? '<span class="tag vermelho">não cadastrado</span>'
        : esc(sc.telefone.exibicao || c.telefone) +
          (sc.telefone.whatsapp ? ' <span class="tag verde">WhatsApp</span>'
            : ' <span class="tag ambar">' + esc(sc.telefone.motivo) + '</span>')) +
      dado('E-mail', c.email
        ? esc(c.email) + (Core.emailValido(c.email) ? '' : ' <span class="tag ambar">formato inválido</span>')
        : '<span class="tag vermelho">não cadastrado</span>') +
    '</div></div>';

  /* --- contrato --- */
  h += '<div class="bloco"><div class="cab"><h3>Contrato de experiência</h3>' +
    '<span style="margin-left:auto">' + tagContrato(res) + '</span></div>';
  if (!c.data_admissao) {
    h += '<p class="sub">Sem data de admissão não há período de experiência calculado.' +
      (ctx.pode_criar ? ' Informe a data no cadastro para o controle começar.' : '') + '</p>';
  } else {
    h += '<div class="dados">' +
      dado('Dia do contrato hoje', res.diaAtual + ' de 90') +
      dado('1º período (30 dias)', Core.isoParaBr(c.data_admissao) +
        ' a ' + Core.isoParaBr(res.fimP1) + '<div class="sub-cel">' +
        rotuloPrazo(res.diasParaFimP1) + '</div>') +
      dado('2º período (60 dias)', Core.isoParaBr(res.inicioP2) + ' a ' + Core.isoParaBr(res.fimP2) +
        '<div class="sub-cel">' + (c.renovacao_confirmada_em
          ? 'renovação confirmada em ' + fmtDataHora(c.renovacao_confirmada_em)
          : 'depende da confirmação da renovação') + '</div>') +
      dado('90º dia', Core.isoParaBr(res.fimP2) + '<div class="sub-cel">' +
        rotuloPrazo(res.diasParaFimP2) + '</div>') +
      '</div>';
    if (res.proximaAcao) {
      h += '<p class="nota" style="margin-top:10px;"><b>Próxima providência:</b> ' + esc(res.proximaAcao) + '</p>';
    }
    if (c.data_encerramento) {
      h += '<p class="nota"><b>Encerramento registrado em ' + Core.isoParaBr(c.data_encerramento) + '</b>' +
        (c.encerramento_motivo ? ' — ' + esc(c.encerramento_motivo) : '') + '</p>';
    }
    var bt = [];
    if (operar && acoes.p1) bt.push('<button class="btn" onclick="decidirP1(\'' + c.id + '\')">Decidir 1º período</button>');
    if (operar && acoes.renovar) bt.push('<button class="btn" onclick="confirmarRenovacao(\'' + c.id + '\')">Confirmar renovação</button>');
    if (operar && acoes.p2) bt.push('<button class="btn" onclick="decidirP2(\'' + c.id + '\')">Decisão final</button>');
    if (ctx.pode_exportar && acoes.encerrar) bt.push('<button class="btn sec" onclick="encerrarAvulso(\'' + c.id + '\')">Encerrar contrato</button>');
    if (ctx.pode_exportar) bt.push('<button class="btn sec" onclick="abrirTermo(acharColab(\'' + c.id + '\'))">Gerar termo de encerramento</button>');
    if (bt.length) h += '<div class="acoes" style="margin-top:12px;">' + bt.join('') + '</div>';
  }
  h += '</div>';

  /* --- aniversário e folga --- */
  if (c.data_nascimento) {
    var anivEste = Core.aniversarioNoAno(c.data_nascimento, p.ano);
    var prox = Core.proximoAniversario(c.data_nascimento, hoje);
    var enviada = Core.msgAnivEnviada(c, p.ano);
    var msg = Core.montarMsgAniversario(cfg.msg_aniversario, c,
      { idade: Core.idadeQueFaz(c.data_nascimento, p.ano), empresa: cfg.empresa_nome });
    var link = sc.telefone.whatsapp ? Core.linkWhatsapp(sc.telefone.digitos, msg) : null;

    h += '<div class="bloco"><div class="cab"><h3>Aniversário</h3></div>' +
      '<div class="dados">' +
        dado('Aniversário em ' + p.ano, Core.isoParaBr(anivEste) +
          (Core.ehAniversarioAdiado(c.data_nascimento, p.ano)
            ? '<div class="sub-cel">nasceu em 29/02; neste ano considerado 28/02</div>' : '')) +
        dado('Próximo', Core.isoParaBr(prox) + '<div class="sub-cel">' +
          rotuloPrazo(Core.difDias(hoje, prox)) + '</div>') +
        dado('Mensagem de ' + p.ano, enviada
          ? '<span class="tag verde">enviada</span><div class="sub-cel">' + fmtDataHora(c.aniv_msg_em) +
            (c.aniv_msg_por ? '<br>por ' + esc(c.aniv_msg_por) : '') + '</div>'
          : '<span class="tag cinza">não enviada</span>') +
      '</div>' +
      '<div class="campo" style="margin-top:12px;">' +
        '<label for="msgAniv">Mensagem de aniversário</label>' +
        '<textarea id="msgAniv" rows="5">' + esc(msg) + '</textarea>' +
        '<p class="nota">Edite se quiser. O envio nunca acontece sozinho: o módulo abre a conversa ' +
        'com o texto pronto e você decide enviar.</p>' +
      '</div>' +
      '<div class="acoes" style="margin-top:8px;">' +
        '<button class="btn sec" onclick="copiarTexto(el(\'msgAniv\').value)">Copiar mensagem</button>' +
        (link
          ? '<button class="btn" onclick="abrirWhats(\'' + sc.telefone.digitos + '\')">Abrir WhatsApp</button>'
          : '<button class="btn" disabled title="' +
            (sc.telefone.tipo === 'vazio' ? 'Sem telefone cadastrado' : esc(sc.telefone.motivo)) +
            '">Abrir WhatsApp</button>') +
        (operar ? '<button class="btn sec" onclick="marcarMsgEnviada(\'' + c.id + '\',' + p.ano + ')">' +
          (enviada ? 'Registrar novo envio' : 'Registrar como enviada') + '</button>' : '') +
      '</div>' +
      (link ? '' : '<p class="nota">' + (sc.telefone.tipo === 'vazio'
        ? 'Cadastre o telefone para abrir o WhatsApp.'
        : 'Telefone fora do padrão do WhatsApp: ' + esc(sc.telefone.motivo) + '.') + '</p>') +
      '</div>';

    if (mostraFolga) {
      var doAno = c.folga_ano === p.ano;
      var conflitos = c.folga_data && doAno ? Core.conflitosFolga(colabs, c, c.folga_data) : [];
      h += '<div class="bloco"><div class="cab"><h3>Folga de aniversário</h3>' +
        '<span style="margin-left:auto">' + (doAno ? tagFolga(c.folga_status) : tagFolga('nao_analisada')) + '</span></div>' +
        '<div class="dados">' +
          dado('Competência', Core.MESES[Core.partes(c.data_nascimento).mes - 1] + ' de ' + p.ano) +
          dado('Data da folga', doAno && c.folga_data ? Core.isoParaBr(c.folga_data)
            : '<span class="oculto">sem data</span>') +
          dado('Aprovação', doAno && c.folga_aprovada_por
            ? esc(c.folga_aprovada_por) + '<div class="sub-cel">' + fmtDataHora(c.folga_aprovada_em) + '</div>'
            : '<span class="oculto">—</span>') +
        '</div>' +
        (doAno && c.folga_excepcional
          ? '<p class="nota"><span class="tag ambar">exceção autorizada</span> folga fora do mês do aniversário.</p>' : '') +
        (doAno && c.folga_obs ? '<p class="nota">Observação: ' + esc(c.folga_obs) + '</p>' : '') +
        (conflitos.length ? '<div class="aviso" style="margin-top:10px;">Há outra(s) ' + conflitos.length +
          ' folga(s) em ' + Core.isoParaBr(c.folga_data) + ' na unidade ' + esc(c.unidade || '—') + ': ' +
          conflitos.map(function (o) { return esc(Core.nomeApresentavel(o.nome)); }).join(', ') + '.</div>' : '') +
        (operar ? '<div class="acoes" style="margin-top:12px;">' +
          '<button class="btn" onclick="tratarFolga(\'' + c.id + '\',' + p.ano + ')">Analisar / agendar folga</button>' +
          '</div>' : '') +
        '</div>';
    }
  }

  /* --- histórico --- */
  h += '<div class="bloco"><div class="cab"><h3>Histórico</h3>';
  if (ctx.pode_criar) {
    h += '<button class="btn sec mini" style="margin-left:auto" onclick="editarCadastro(\'' + c.id + '\')">Editar cadastro</button>';
  }
  if (ctx.pode_excluir) {
    h += '<button class="btn perigo mini" onclick="excluirColab(\'' + c.id + '\')">Excluir</button>';
  }
  h += '</div>';
  if (!fichaHist) h += '<p class="sub">Carregando…</p>';
  else if (fichaHist.erro) h += '<p class="sub">Não foi possível carregar: ' + esc(fichaHist.erro) + '</p>';
  else {
    var evs = [];
    (fichaHist.decisoes || []).forEach(function (d) {
      evs.push({ em: d.em, txt: rotuloDecisao(d) +
        (d.observacao ? '<div class="sub-cel">' + esc(d.observacao) + '</div>' : ''),
        quem: d.usuario });
    });
    (fichaHist.alteracoes || []).forEach(function (a) {
      evs.push({ em: a.em, txt: rotuloAlteracao(a), quem: a.usuario });
    });
    evs.sort(function (x, y) { return x.em < y.em ? 1 : -1; });
    if (!evs.length) h += '<p class="sub">Nada registrado ainda.</p>';
    else h += '<div class="linha-tempo">' + evs.map(function (e) {
      return '<div class="evento">' + e.txt +
        '<div class="quando">' + fmtDataHora(e.em) + ' · <span class="quem">' + esc(e.quem || '') + '</span></div>' +
        '</div>';
    }).join('') + '</div>';
  }
  h += '</div>';

  el('fichaCorpo').innerHTML = h;
}

function dado(rot, val) {
  return '<div class="dado"><div class="rot">' + esc(rot) + '</div><div class="val">' + val + '</div></div>';
}
function rotuloDecisao(d) {
  var m = {
    aprovado: 'Aprovado para renovação (1º período)',
    reprovado: 'Reprovado no 1º período',
    renovacao_confirmada: 'Renovação confirmada — 2º período em curso',
    efetivado: 'Colaborador efetivado',
    encerrado: 'Contrato encerrado',
    pendente: 'Decisão marcada como pendente'
  };
  return '<b>' + esc(m[d.decisao] || d.decisao) + '</b>' +
    (d.periodo ? ' <span class="tag cinza">' + d.periodo + 'º período</span>' : '');
}
function rotuloAlteracao(a) {
  var campos = {
    nome: 'nome', nome_mae: 'nome da mãe', cpf: 'CPF', data_admissao: 'data de admissão',
    data_nascimento: 'data de nascimento', email: 'e-mail', telefone: 'telefone',
    unidade: 'unidade', situacao: 'situação', data_desligamento: 'data de desligamento',
    p1_decisao: 'decisão do 1º período', p1_obs: 'observação do 1º período',
    renovacao_confirmada_em: 'confirmação da renovação', p2_decisao: 'decisão final',
    p2_obs: 'observação final', data_encerramento: 'data de encerramento',
    encerramento_motivo: 'motivo do encerramento', folga_status: 'situação da folga',
    folga_data: 'data da folga', folga_obs: 'observação da folga',
    folga_excepcional: 'exceção da folga', aniv_msg_ano: 'ano da mensagem de aniversário',
    aniv_msg_em: 'envio da mensagem de aniversário'
  };
  if (a.acao === 'criacao') return '<b>Cadastro criado</b>' +
    (a.detalhe ? ' <span class="tag cinza">' + esc(a.detalhe) + '</span>' : '');
  if (a.acao === 'exclusao') return '<b>Cadastro excluído</b>';
  if (a.acao === 'documento') return '<b>Documento gerado</b><div class="sub-cel">' + esc(a.detalhe || '') + '</div>';
  if (a.acao === 'importacao') return '<b>Importação</b><div class="sub-cel">' + esc(a.detalhe || '') + '</div>';
  if (a.acao === 'exportacao') return '<b>Exportação</b><div class="sub-cel">' + esc(a.detalhe || '') + '</div>';
  var nome = campos[a.campo] || a.campo;
  var de = a.de === null || a.de === undefined || a.de === '' ? '(vazio)' : a.de;
  var para = a.para === null || a.para === undefined || a.para === '' ? '(vazio)' : a.para;
  if (a.campo === 'telefone') {
    de = a.de ? Core.exibirTelefone(a.de) : '(vazio)';
    para = a.para ? Core.exibirTelefone(a.para) : '(vazio)';
  }
  if (a.campo === 'cpf') { de = a.de ? Core.cpfFormatado(a.de) : '(vazio)'; para = a.para ? Core.cpfFormatado(a.para) : '(vazio)'; }
  if (/^data_|_em$/.test(a.campo) && /^\d{4}-\d{2}-\d{2}$/.test(String(a.para || ''))) {
    de = a.de ? Core.isoParaBr(a.de) : '(vazio)';
    para = Core.isoParaBr(a.para);
  }
  return 'Alterou <b>' + esc(nome) + '</b>: <code>' + esc(de) + '</code> → <code>' + esc(para) + '</code>';
}

function abrirWhats(digitos) {
  var msg = el('msgAniv') ? el('msgAniv').value : '';
  window.open(Core.linkWhatsapp(digitos, msg), '_blank', 'noopener');
}

/* ============================================================
   Cadastro manual
   ============================================================ */
function abrirNovo() { editarCadastro(null); }

async function editarCadastro(id) {
  var c = id ? acharColab(id) : null;
  if (id && !c) return;
  if (c && !c.ve_sensivel) {
    showToast('Só RH ou administrador pode editar o cadastro completo.', true);
    return;
  }
  var v = await perguntar({
    titulo: c ? 'Editar cadastro — ' + Core.nomeApresentavel(c.nome) : 'Novo colaborador',
    texto: c ? 'Toda alteração fica no histórico com valor anterior e novo.'
             : 'O CPF é o identificador único: o banco recusa um segundo cadastro com o mesmo CPF.',
    campos: [
      { tipo: 'texto', id: 'nome', rotulo: 'Nome completo', valor: c ? c.nome : '' },
      { tipo: 'texto', id: 'cpf', rotulo: 'CPF', valor: c && c.ve_sensivel ? Core.cpfFormatado(c.cpf) : '',
        dica: '000.000.000-00' },
      { tipo: 'texto', id: 'mae', rotulo: 'Nome completo da mãe', valor: c ? (c.nome_mae || '') : '' },
      { tipo: 'data', id: 'adm', rotulo: 'Data de admissão', valor: c ? (c.data_admissao || '') : '' },
      { tipo: 'data', id: 'nasc', rotulo: 'Data de nascimento', valor: c ? (c.data_nascimento || '') : '' },
      { tipo: 'texto', id: 'tel', rotulo: 'Telefone com DDD',
        valor: c ? (Core.analisarTelefone(c.telefone).exibicao || c.telefone || '') : '', dica: '(61) 99999-8888' },
      { tipo: 'texto', id: 'mail', rotulo: 'E-mail', valor: c ? (c.email || '') : '' },
      { tipo: 'texto', id: 'uni', rotulo: 'Unidade / local de trabalho', valor: c ? (c.unidade || '') : '' },
      { tipo: 'select', id: 'sit', rotulo: 'Situação', valor: c ? c.situacao : 'Ativo',
        opcoes: [{ valor: 'Ativo', rotulo: 'Ativo' }, { valor: 'Inativo', rotulo: 'Inativo' }] }
    ],
    validar: function (x) {
      var e = [];
      if (!x.nome.trim()) e.push('Informe o nome completo.');
      if (x.cpf.trim() && !Core.cpfValido(x.cpf)) e.push('CPF inválido — confira os dígitos.');
      if (x.adm && !Core.isoValido(x.adm)) e.push('Data de admissão inválida.');
      if (x.nasc && !Core.isoValido(x.nasc)) e.push('Data de nascimento inválida.');
      if (x.nasc && x.adm && Core.difDias(x.nasc, x.adm) / 365.25 < 14) {
        e.push('A admissão está menos de 14 anos após o nascimento — confira as datas.');
      }
      if (x.tel.trim()) {
        var a = Core.analisarTelefone(x.tel);
        if (!a.ok) e.push('Telefone: ' + a.motivo +
          (a.sugestao ? '. Sugestão: ' + Core.exibirTelefone(a.sugestao) : ''));
      }
      if (x.mail.trim() && !Core.emailValido(x.mail.trim())) e.push('E-mail em formato inválido.');
      return e.length ? e.join('<br>') : null;
    },
    confirmar: c ? 'Salvar alterações' : 'Cadastrar'
  });
  if (!v) return;

  var p = {
    nome: v.nome.trim(), cpf: v.cpf.trim() ? Core.cpfDigitos(v.cpf) : null,
    nome_mae: v.mae.trim(), data_admissao: v.adm || null, data_nascimento: v.nasc || null,
    email: v.mail.trim(), telefone: v.tel.trim(), unidade: v.uni.trim(), situacao: v.sit
  };
  if (id) p.id = id;
  var r = await chamar('colab_salvar', { p: p }, id ? 'Cadastro atualizado' : 'Colaborador cadastrado');
  if (!r.ok) return;
  await refetchColabs();
  if (id) { fichaAtual = acharColab(id); fichaHist = null; abrirFicha(id); }
  render();
}

async function excluirColab(id) {
  var c = acharColab(id);
  if (!c) return;
  var v = await perguntar({
    titulo: 'Excluir colaborador',
    texto: 'Excluir o cadastro de <b>' + esc(Core.nomeApresentavel(c.nome)) + '</b>?',
    alerta: 'A exclusão apaga o cadastro, as decisões e as notificações desta pessoa. O registro de ' +
      'auditoria da exclusão permanece. <b>Em geral o certo é marcar como Inativo</b>, não excluir — ' +
      'assim o histórico continua consultável.',
    campos: [{ tipo: 'texto', id: 'conf', rotulo: 'Digite EXCLUIR para confirmar', dica: 'EXCLUIR' }],
    validar: function (x) {
      return x.conf.trim().toUpperCase() === 'EXCLUIR' ? null : 'Digite EXCLUIR para confirmar.';
    },
    confirmar: 'Excluir definitivamente', perigo: true
  });
  if (!v) return;
  var r = await chamar('colab_excluir', { p_id: id }, 'Colaborador excluído');
  if (!r.ok) return;
  fecharFicha();
  await refetchColabs(); render();
}

/* ============================================================
   Exportação
   ============================================================ */
async function exportar() {
  var lista = Core.filtrar(colabs, filtrosColab(), cfg, hoje);
  if (!lista.length) { showToast('Nenhum colaborador nos filtros atuais.', true); return; }

  var v = await perguntar({
    titulo: 'Exportar dados de colaboradores',
    texto: 'Serão exportados <b>' + lista.length + '</b> registro(s), conforme os filtros da tela.',
    alerta: 'O arquivo conterá <b>dados pessoais</b>' +
      (ctx.ve_sensivel ? ', incluindo <b>CPF completo e nome da mãe</b>' : '') +
      '. A exportação fica registrada em auditoria com seu usuário, a quantidade e o horário. ' +
      'Guarde o arquivo em local controlado e apague quando não precisar mais.',
    campos: [{ tipo: 'chk', id: 'ciente',
      rotulo: 'Estou ciente e assumo a responsabilidade por este arquivo', valor: false }],
    validar: function (x) { return x.ciente ? null : 'Marque a confirmação para exportar.'; },
    confirmar: 'Exportar ' + lista.length + ' registro(s)'
  });
  if (!v) return;

  var linhas = Core.linhasExportacao(lista, cfg, hoje, !!ctx.ve_sensivel);
  var csv = '﻿' + Core.paraCsv(linhas);      // BOM: o Excel abre com acento certo
  var nome = 'colaboradores-' + hoje + '.csv';
  var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  var a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = nome;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);

  await chamar('colab_registrar_exportacao',
    { p_qtd: lista.length, p_escopo: descreverFiltros() }, 'Exportado: ' + nome);
}

function descreverFiltros() {
  var f = filtrosColab(), out = [];
  if (f.busca) out.push('busca="' + f.busca + '"');
  if (f.situacao !== 'todas') out.push(f.situacao);
  if (f.unidade !== 'todas') out.push('unidade=' + f.unidade);
  if (f.mesAniversario !== 'todos') out.push('mês=' + f.mesAniversario);
  if (f.etapaContrato !== 'todas') out.push('etapa=' + f.etapaContrato);
  if (f.folga !== 'todas') out.push('folga=' + f.folga);
  if (f.venceEm) out.push('vence em 15 dias');
  if (f.decisaoPendente) out.push('decisão pendente');
  if (f.decisaoAtrasada) out.push('decisão em atraso');
  if (f.cadastroIncompleto) out.push('cadastro incompleto');
  return out.length ? out.join(', ') : 'sem filtros';
}

/* ============================================================
   IMPORTAÇÃO
   ============================================================ */
el('arqPlan').addEventListener('change', function () {
  if (this.files && this.files[0]) lerPlanilha(this.files[0]);
});

function lerPlanilha(file) {
  el('impDeteccao').innerHTML = 'Lendo <b>' + esc(file.name) + '</b>…';
  var fr = new FileReader();
  fr.onerror = function () {
    el('impDeteccao').innerHTML = '<span style="color:var(--vermelho)">Não foi possível ler o arquivo.</span>';
  };
  fr.onload = function (e) {
    try {
      var wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      var ws = wb.Sheets[wb.SheetNames[0]];
      var matriz = XLSX.utils.sheet_to_json(ws, { header: 1, raw: false, defval: '' });
      imp = { arquivo: file.name, abas: wb.SheetNames, matriz: matriz };
      var det = Core.detectarLayout(matriz);
      imp.layout = det;
      if (det.tipo === 'folha' && !el('impUnidade').value) {
        var u = Core.unidadeDoRelatorio(matriz);
        if (u) el('impUnidade').value = u.replace(/^\d+\s*-\s*/, '');
      }
      reprocessarImport();
    } catch (err) {
      el('impDeteccao').innerHTML = '<span style="color:var(--vermelho)">Erro ao abrir a planilha: ' +
        esc(err && err.message || err) + '</span>';
    }
  };
  fr.readAsArrayBuffer(file);
}

function reprocessarImport() {
  if (!imp) return;
  var unidade = el('impUnidade').value.trim();
  var det = imp.layout;

  if (det.tipo === 'indefinido') {
    el('impDeteccao').innerHTML = '<span style="color:var(--vermelho)">Não reconheci o formato de <b>' +
      esc(imp.arquivo) + '</b>.</span> Verifique se a primeira aba tem uma linha de cabeçalho com, ao menos, ' +
      'uma coluna de nome e uma de CPF ou de datas.';
    ['passo2', 'passo3', 'passo4'].forEach(function (p) { el(p).classList.add('desligado'); });
    return;
  }

  var lido = Core.lerPlanilha(imp.matriz, {
    layout: det, mapa: imp.mapaManual || det.mapa, unidade: unidade
  });
  imp.lido = lido;
  imp.validados = lido.registros.map(Core.validarRegistro);
  imp.conc = Core.conciliar(imp.validados, colabs);
  imp.escolhas = { inserir: {}, campos: {} };

  el('impDeteccao').innerHTML = 'Arquivo <b>' + esc(imp.arquivo) + '</b>' +
    (imp.abas.length > 1 ? ' (usando a aba <b>' + esc(imp.abas[0]) + '</b> de ' + imp.abas.length + ')' : '') +
    ' · formato reconhecido: <b>' +
    (det.tipo === 'folha' ? 'relatório de listagem de funcionários' : 'planilha em tabela') + '</b>' +
    ' · <b>' + lido.registros.length + '</b> pessoa(s) encontrada(s)' +
    (lido.unidadeDetectada ? ' · empresa no arquivo: <b>' + esc(lido.unidadeDetectada) + '</b>' : '') +
    (unidade ? '' : ' · <span style="color:var(--alert)"><b>informe a unidade</b> para etiquetar estas pessoas</span>');

  desenharMapa();
  desenharResumoImport();

  ['passo2', 'passo3', 'passo4'].forEach(function (p) { el(p).classList.remove('desligado'); });
}

function desenharMapa() {
  var det = imp.layout;
  if (det.tipo === 'folha') {
    el('impMapaTexto').innerHTML = 'Neste formato cada pessoa ocupa duas linhas e telefone, e-mail e ' +
      'nome da mãe vêm dentro de um texto corrido, junto com o endereço. O módulo extrai os campos ' +
      'automaticamente — confira abaixo a primeira pessoa lida.';
    var r = (imp.lido.registros || [])[0];
    if (!r) { el('impMapa').innerHTML = '<p class="sub">Nada lido.</p>'; return; }
    el('impMapa').innerHTML = [
      ['Nome', r.nome], ['CPF', r.cpf], ['Nome da mãe', r.nome_mae],
      ['Admissão', r.data_admissao_bruta], ['Nascimento', r.data_nascimento_bruta],
      ['E-mail', r.email], ['Telefone', r.telefone_bruto], ['Unidade', r.unidade],
      ['Matrícula', r.matricula]
    ].map(function (x) {
      return '<div class="dado"><div class="rot">' + esc(x[0]) + '</div><div class="val">' +
        (x[1] ? esc(x[1]) : '<span class="oculto">vazio</span>') + '</div></div>';
    }).join('');
    return;
  }

  var cabLinha = imp.matriz[det.linhaCabecalho] || [];
  var mapa = imp.mapaManual || det.mapa || {};
  el('impMapaTexto').innerHTML = 'Cabeçalho encontrado na linha <b>' + (det.linhaCabecalho + 1) +
    '</b>. O de-para abaixo foi montado automaticamente — troque o que estiver errado.';
  el('impMapa').innerHTML = Core.CAMPOS_IMPORT.map(function (campo) {
    var atual = mapa[campo.chave];
    return '<div class="dado"><div class="rot">' + esc(campo.rotulo) + '</div>' +
      '<select style="font:inherit;font-size:13px;width:100%;padding:6px;border:1px solid var(--line);' +
      'border-radius:8px;margin-top:4px;" onchange="trocarMapa(\'' + campo.chave + '\',this.value)">' +
      '<option value="">— não importar —</option>' +
      cabLinha.map(function (h, i) {
        var rot = String(h || '').replace(/[\r\n]+/g, ' ').trim() || '(coluna ' + (i + 1) + ')';
        return '<option value="' + i + '"' + (atual === i ? ' selected' : '') + '>' +
          esc(rot.length > 46 ? rot.slice(0, 46) + '…' : rot) + '</option>';
      }).join('') + '</select></div>';
  }).join('');
}

function trocarMapa(campo, valor) {
  if (!imp) return;
  var mapa = {};
  var atual = imp.mapaManual || imp.layout.mapa || {};
  Object.keys(atual).forEach(function (k) { mapa[k] = atual[k]; });
  if (valor === '') delete mapa[campo];
  else {
    var idx = parseInt(valor, 10);
    // Uma coluna não pode alimentar dois campos.
    Object.keys(mapa).forEach(function (k) { if (mapa[k] === idx) delete mapa[k]; });
    mapa[campo] = idx;
  }
  imp.mapaManual = mapa;
  reprocessarImport();
}

function desenharResumoImport() {
  var c = imp.conc;
  var r = Core.resumoImportacao(c, null);
  el('impResumo').innerHTML =
    rcard('lidos na planilha', r.lidos, 'z') +
    rcard('a inserir', r.aInserir, 'v') +
    rcard('a atualizar', r.aAtualizar, 'a') +
    rcard('já cadastrados, sem mudança', r.semMudanca, '') +
    rcard('duplicados na planilha', r.duplicadosNoArquivo, 'a') +
    rcard('inválidos (não entram)', r.invalidos, 'r') +
    rcard('exigem correção manual', r.exigemCorrecaoManual, 'a');

  var h = '';

  if (c.invalidos.length) {
    h += '<h3 style="margin-top:16px;">Não entram — ' + c.invalidos.length + '</h3>' +
      '<p class="sub">Recusados na conferência. Corrija na planilha e importe de novo.</p>' +
      lista(c.invalidos, function (v) {
        return '<div class="item ruim"><b>linha ' + v.linha + '</b> — ' + esc(v.nome || '(sem nome)') +
          '<div class="pq">' + esc(v.erros.join(' · ')) + '</div></div>';
      });
  }

  if (c.duplicadosNoArquivo.length) {
    h += '<h3 style="margin-top:16px;">Duplicados dentro da planilha — ' + c.duplicadosNoArquivo.length + '</h3>' +
      '<p class="sub">Só a primeira ocorrência é considerada.</p>' +
      lista(c.duplicadosNoArquivo, function (v) {
        return '<div class="item atencao"><b>linha ' + v.linha + '</b> — ' + esc(v.nome) +
          '<div class="pq">' + esc(v.motivoDuplicata || '') + '</div></div>';
      });
  }

  if (c.atualizar.length) {
    h += '<h3 style="margin-top:16px;">Já cadastrados, com diferenças — ' + c.atualizar.length + '</h3>' +
      '<p class="sub">Marque o que deve ser atualizado. Telefone e e-mail vêm marcados; os outros campos ' +
      'ficam desmarcados de propósito. <b>Nada é sobrescrito sem a sua marcação.</b></p>' +
      lista(c.atualizar, function (v) {
        return '<div class="item"><b>' + esc(Core.nomeApresentavel(v.nome)) + '</b>' +
          '<span class="pq"> · linha ' + v.linha + '</span>' +
          '<div class="difs">' + v.diferencas.map(function (d) {
            return '<label class="dif"><input type="checkbox" ' + (d.marcado ? 'checked' : '') +
              ' onchange="marcarCampo(' + v.linha + ',\'' + d.campo + '\',this.checked)"> ' +
              esc(d.rotulo) + ': <code>' + esc(mostrarValor(d.campo, d.de)) + '</code>' +
              '<span class="seta">→</span><code>' + esc(mostrarValor(d.campo, d.para)) + '</code></label>';
          }).join('') + '</div></div>';
      });
  }

  if (c.manual.length) {
    h += '<h3 style="margin-top:16px;">Entram, mas exigem correção manual — ' + c.manual.length + '</h3>' +
      '<p class="sub">Ficam cadastrados e aparecem na aba <b>Cadastro</b> para você completar.</p>' +
      lista(c.manual, function (v) {
        return '<div class="item atencao"><b>' + esc(Core.nomeApresentavel(v.nome)) + '</b>' +
          '<span class="pq"> · linha ' + v.linha + '</span>' +
          '<div class="pq">' + esc(v.avisos.join(' · ')) + '</div></div>';
      });
  }

  if (c.inserir.length) {
    h += '<h3 style="margin-top:16px;">Novos cadastros — ' + c.inserir.length + '</h3>' +
      '<p class="sub">Desmarque quem não deve entrar agora.</p>' +
      lista(c.inserir, function (v) {
        return '<div class="item"><label class="dif"><input type="checkbox" checked ' +
          'onchange="marcarInsercao(' + v.linha + ',this.checked)"> <b>' +
          esc(Core.nomeApresentavel(v.nome)) + '</b></label>' +
          '<div class="pq">' + [
            v.cpf ? 'CPF ' + Core.cpfFormatado(v.cpf) : 'sem CPF',
            v.data_admissao ? 'admissão ' + Core.isoParaBr(v.data_admissao) : 'sem admissão',
            v.data_nascimento ? 'nascimento ' + Core.isoParaBr(v.data_nascimento) : 'sem nascimento',
            v.telefone ? Core.exibirTelefone(v.telefone) : 'sem telefone',
            v.email || 'sem e-mail'
          ].map(esc).join(' · ') + '</div></div>';
      });
  }

  if (c.semMudanca.length) {
    h += '<h3 style="margin-top:16px;">Já cadastrados e idênticos — ' + c.semMudanca.length + '</h3>' +
      '<p class="sub">Nada a fazer com estes.</p>';
  }

  el('impDetalhes').innerHTML = h;

  var vaiGravar = c.inserir.length + c.atualizar.length;
  el('impConfirmaTexto').innerHTML = vaiGravar
    ? 'Serão gravados até <b>' + c.inserir.length + '</b> novo(s) cadastro(s) e <b>' +
      c.atualizar.length + '</b> atualização(ões), conforme as marcações acima.'
    : 'Não há nada para gravar com as marcações atuais.';
  el('btnImportar').disabled = !vaiGravar;
}

function mostrarValor(campo, v) {
  if (v === null || v === undefined || v === '') return '(vazio)';
  if (campo === 'telefone') return Core.exibirTelefone(v);
  if (campo === 'cpf') return Core.cpfFormatado(v);
  if (/^data_/.test(campo)) return Core.isoParaBr(v) || String(v);
  return String(v);
}
function rcard(rot, n, cls) {
  return '<div class="rcard ' + cls + '"><div class="q">' + n + '</div><div class="l">' + esc(rot) + '</div></div>';
}
function lista(arr, fn) {
  return '<div class="lista-rolo">' + arr.map(fn).join('') + '</div>';
}
function marcarCampo(linha, campo, valor) {
  imp.escolhas.campos[linha] = imp.escolhas.campos[linha] || {};
  imp.escolhas.campos[linha][campo] = valor;
  atualizarContagemImport();
}
function marcarInsercao(linha, valor) {
  imp.escolhas.inserir[linha] = valor;
  atualizarContagemImport();
}
function atualizarContagemImport() {
  var pacote = Core.montarPacote(imp.conc, imp.escolhas);
  var ins = pacote.filter(function (p) { return p.acao === 'inserir'; }).length;
  var upd = pacote.length - ins;
  el('impConfirmaTexto').innerHTML = pacote.length
    ? 'Serão gravados <b>' + ins + '</b> novo(s) cadastro(s) e <b>' + upd + '</b> atualização(ões).'
    : 'Não há nada para gravar com as marcações atuais.';
  el('btnImportar').disabled = !pacote.length;
}

function cancelarImportacao() {
  imp = null;
  el('arqPlan').value = '';
  el('impDeteccao').textContent = '';
  el('impResumo').innerHTML = '';
  el('impDetalhes').innerHTML = '';
  el('impResultado').innerHTML = '';
  ['passo2', 'passo3', 'passo4'].forEach(function (p) { el(p).classList.add('desligado'); });
}

async function confirmarImportacao() {
  if (!imp) return;
  var pacote = Core.montarPacote(imp.conc, imp.escolhas);
  if (!pacote.length) { showToast('Nada marcado para gravar.', true); return; }
  var ins = pacote.filter(function (p) { return p.acao === 'inserir'; }).length;
  var upd = pacote.length - ins;
  var semUnidade = pacote.filter(function (p) { return !p.unidade && p.acao === 'inserir'; }).length;

  var v = await perguntar({
    titulo: 'Confirmar a importação',
    texto: '<b>' + ins + '</b> novo(s) cadastro(s) e <b>' + upd + '</b> atualização(ões) de ' +
      'campo(s) marcado(s).',
    alerta: (semUnidade
      ? '<b>' + semUnidade + ' cadastro(s) entrarão sem unidade.</b> Preencha o campo "Unidade destas ' +
        'pessoas" no passo 1 se quiser etiquetá-los. ' : '') +
      'Os dados vão para o banco e passam a valer para todos os usuários do módulo.',
    campos: [{ tipo: 'area', id: 'obs', rotulo: 'Observação sobre esta importação (fica na auditoria)',
      valor: 'Importação de ' + imp.arquivo, linhas: 2 }],
    confirmar: 'Gravar'
  });
  if (!v) return;

  el('btnImportar').disabled = true;
  el('impResultado').innerHTML = '<p class="sub" style="margin-top:12px;">Gravando ' +
    pacote.length + ' registro(s)…</p>';

  // Em lotes, para uma planilha grande não estourar o limite da requisição.
  var lote = 200, total = { inseridos: 0, atualizados: 0, recusados: 0, erros: [] };
  for (var i = 0; i < pacote.length; i += lote) {
    var parte = pacote.slice(i, i + lote);
    var r = await chamar('colab_importar', { p_registros: parte });
    if (!r.ok) {
      el('impResultado').innerHTML = '<div class="aviso" style="margin-top:12px;">' +
        'A gravação parou no lote ' + (Math.floor(i / lote) + 1) + '. ' +
        (total.inseridos + total.atualizados) + ' registro(s) já haviam sido gravados. ' +
        'Corrija o erro mostrado acima e importe de novo — os já gravados serão reconhecidos ' +
        'como “já cadastrados”, sem duplicar.</div>';
      el('btnImportar').disabled = false;
      await refetchColabs(); render();
      return;
    }
    total.inseridos += r.dados.inseridos || 0;
    total.atualizados += r.dados.atualizados || 0;
    total.recusados += r.dados.recusados || 0;
    (r.dados.erros || []).forEach(function (e) { total.erros.push(e); });
  }

  await refetchColabs();
  render();

  el('impResultado').innerHTML = '<h3 style="margin-top:16px;">Resultado</h3>' +
    '<div class="resumo">' +
      rcard('inseridos', total.inseridos, 'v') +
      rcard('atualizados', total.atualizados, 'a') +
      rcard('recusados pelo banco', total.recusados, total.recusados ? 'r' : '') +
    '</div>' +
    (total.erros.length
      ? '<p class="sub">Recusados:</p>' + lista(total.erros, function (e) {
          return '<div class="item ruim"><b>linha ' + esc(e.linha) + '</b> — ' + esc(e.nome || '') +
            '<div class="pq">' + esc(e.erro) + '</div></div>';
        })
      : '') +
    '<div class="acoes" style="margin-top:14px;">' +
      '<button class="btn" onclick="setAba(\'colaboradores\')">Ver colaboradores</button>' +
      '<button class="btn sec" onclick="setAba(\'experiencia\')">Ver contratos de experiência</button>' +
      '<button class="btn sec" onclick="cancelarImportacao()">Importar outra planilha</button>' +
    '</div>';
  showToast(total.inseridos + ' inserido(s), ' + total.atualizados + ' atualizado(s)');
  el('btnImportar').disabled = false;
}

/* ============================================================
   Configurações
   ============================================================ */
function preencherConfig() {
  el('cfEmpresa').value = cfg.empresa_nome || '';
  el('cfCidade').value = cfg.empresa_cidade || '';
  el('cfResp').value = cfg.resp_nome || '';
  el('cfCargo').value = cfg.resp_cargo || '';
  el('cfP1').value = cfg.dias_aviso_p1 === undefined ? 7 : cfg.dias_aviso_p1;
  el('cfP2').value = cfg.dias_aviso_p2 === undefined ? 7 : cfg.dias_aviso_p2;
  el('cfAniv').value = cfg.dias_aviso_aniv === undefined ? 7 : cfg.dias_aviso_aniv;
  el('cfFolga').checked = cfg.politica_folga_ativa !== false;
  el('cfMsgAniv').value = cfg.msg_aniversario || Core.MSG_ANIV_PADRAO;
  el('cfTermo').value = cfg.termo_modelo || Core.TERMO_PADRAO;
}
function restaurarMsgAniv() { el('cfMsgAniv').value = Core.MSG_ANIV_PADRAO; }
function restaurarTermo() { el('cfTermo').value = Core.TERMO_PADRAO; }

async function salvarConfig() {
  var p1 = parseInt(el('cfP1').value, 10), p2 = parseInt(el('cfP2').value, 10),
      an = parseInt(el('cfAniv').value, 10);
  if (isNaN(p1) || p1 < 0 || p1 > 29) { showToast('A antecedência do 1º período deve ficar entre 0 e 29 dias.', true); return; }
  if (isNaN(p2) || p2 < 0 || p2 > 59) { showToast('A antecedência da decisão final deve ficar entre 0 e 59 dias.', true); return; }
  if (isNaN(an) || an < 0 || an > 60) { showToast('A antecedência do aniversário deve ficar entre 0 e 60 dias.', true); return; }

  var termo = el('cfTermo').value;
  var faltando = ['[NOME COMPLETO]', '[CPF]', '[DATA DO ENCERRAMENTO]'].filter(function (k) {
    return termo.indexOf(k) < 0;
  });
  if (faltando.length) {
    var v = await perguntar({
      titulo: 'Modelo do termo sem campos essenciais',
      texto: 'O modelo não usa ' + faltando.join(', ') + '. O termo sairá sem essa informação.',
      confirmar: 'Salvar assim mesmo', perigo: true
    });
    if (!v) return;
  }

  var r = await chamar('colab_config_salvar', { p: {
    empresa_nome: el('cfEmpresa').value.trim(),
    empresa_cidade: el('cfCidade').value.trim(),
    resp_nome: el('cfResp').value.trim(),
    resp_cargo: el('cfCargo').value.trim(),
    dias_aviso_p1: p1, dias_aviso_p2: p2, dias_aviso_aniv: an,
    politica_folga_ativa: el('cfFolga').checked,
    msg_aniversario: el('cfMsgAniv').value,
    termo_modelo: termo
  } }, 'Configurações salvas');
  if (!r.ok) return;
  await recarregar();
}

function renderPerfis() {
  if (!ctx.pode_config) return;
  if (!perfis.length) {
    el('listaPerfis').innerHTML = '<p class="sub">Nenhum perfil carregado.</p>';
    return;
  }
  el('listaPerfis').innerHTML = '<div class="tabela-rolo"><table>' +
    '<tr><th>E-mail</th><th>Perfil</th><th>Unidade</th><th>Liberado em</th></tr>' +
    perfis.slice().sort(function (a, b) {
      return String(a.perfil).localeCompare(String(b.perfil)) ||
             String(a.email).localeCompare(String(b.email));
    }).map(function (p) {
      return '<tr><td>' + esc(p.email || '') + '</td>' +
        '<td><span class="tag ' + (p.perfil === 'admin' ? 'verde' : p.perfil === 'rh' ? 'azul' :
          p.perfil === 'gestor' ? 'ambar' : 'cinza') + '">' + esc(rotuloPerfil(p.perfil)) + '</span></td>' +
        '<td>' + esc(p.unidade || 'todas') + '</td>' +
        '<td class="sub-cel">' + fmtDataHora(p.criado_em) + '</td></tr>';
    }).join('') + '</table></div>';
}

/* ============================================================ */
window.addEventListener('focus', function () {
  // Volta do WhatsApp ou de outra aba: se o dia virou, recalcula tudo.
  if (iniciado && Core.hojeIso() !== hoje) render();
});

boot();
