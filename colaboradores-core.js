/* =================================================================
   Gestão de Colaboradores — Grupo Caju
   NÚCLEO DE REGRAS

   Este arquivo é de propósito "puro": não toca no DOM, não fala com o
   Supabase, não lê a hora do sistema por conta própria (a data de hoje
   sempre entra como parâmetro). Por isso ele pode ser testado de ponta
   a ponta em colaboradores-testes.html sem banco e sem tela.

   Toda conta de dia sensível do módulo — os 30 e os 90 dias do contrato
   de experiência, aniversário em 29 de fevereiro, competência da folga —
   está aqui, num lugar só.
   ================================================================= */
(function (global) {
'use strict';

var Core = {};

/* =================================================================
   1) DATAS

   Regra da casa: data é texto 'AAAA-MM-DD' e a aritmética é feita em
   UTC. Nunca se mistura `new Date('2026-08-03')` (meia-noite UTC) com
   `new Date(2026, 7, 3)` (meia-noite local) — em fuso negativo, como o
   do Brasil, misturar os dois erra o dia. Aqui só existe o primeiro.
   ================================================================= */

var MS_DIA = 86400000;
var MESES = ['janeiro','fevereiro','março','abril','maio','junho',
             'julho','agosto','setembro','outubro','novembro','dezembro'];
var MESES_CURTO = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];

function pad2(n) { return (n < 10 ? '0' : '') + n; }

function ehBissexto(ano) {
  return (ano % 4 === 0 && ano % 100 !== 0) || ano % 400 === 0;
}

function diasNoMes(ano, mes) {          // mes: 1..12
  if (mes === 2) return ehBissexto(ano) ? 29 : 28;
  return [31,28,31,30,31,30,31,31,30,31,30,31][mes - 1];
}

/* Só aceita data que existe de verdade: 31/02 e 29/02 de ano comum caem. */
function isoValido(iso) {
  if (typeof iso !== 'string') return false;
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return false;
  var a = +m[1], me = +m[2], d = +m[3];
  if (me < 1 || me > 12) return false;
  if (a < 1900 || a > 2200) return false;
  return d >= 1 && d <= diasNoMes(a, me);
}

function partes(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? { ano: +m[1], mes: +m[2], dia: +m[3] } : null;
}

function montaIso(ano, mes, dia) {
  return ano + '-' + pad2(mes) + '-' + pad2(dia);
}

/* Número de dias desde 1970-01-01. Base de toda a aritmética. */
function numDia(iso) {
  var p = partes(iso);
  if (!p) return null;
  return Date.UTC(p.ano, p.mes - 1, p.dia) / MS_DIA;
}

function deNumDia(n) {
  var d = new Date(n * MS_DIA);
  return montaIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

function somaDias(iso, n) {
  var base = numDia(iso);
  return base === null ? null : deNumDia(base + n);
}

/* difDias('2026-01-01','2026-01-31') = 30 */
function difDias(de, para) {
  var a = numDia(de), b = numDia(para);
  return (a === null || b === null) ? null : b - a;
}

/* Hoje segundo o relógio de quem está usando (não UTC): se o usuário
   vê 03/08 no celular, o módulo trabalha com 03/08. */
function hojeIso(agora) {
  var d = agora ? new Date(agora) : new Date();
  return montaIso(d.getFullYear(), d.getMonth() + 1, d.getDate());
}

function isoParaBr(iso) {
  var p = partes(iso);
  return p ? pad2(p.dia) + '/' + pad2(p.mes) + '/' + p.ano : '';
}

function dataLonga(iso) {
  var p = partes(iso);
  return p ? p.dia + ' de ' + MESES[p.mes - 1] + ' de ' + p.ano : '';
}

function rotuloMes(ano, mes) {
  return MESES[mes - 1].charAt(0).toUpperCase() + MESES[mes - 1].slice(1) + ' de ' + ano;
}

/* Ano de dois dígitos: 26 -> 2026, 86 -> 1986.
   Corte em 30 porque o módulo lida com nascimento (século passado) e
   admissão (século atual). Quem cair no corte é sinalizado como aviso
   na importação, não silenciosamente. */
function expandeAno(yy) {
  return yy <= 30 ? 2000 + yy : 1900 + yy;
}

/* Serial do Excel -> ISO. O dia 0 do Excel é 30/12/1899 por causa do
   bug do ano 1900 que a Microsoft manteve por compatibilidade. */
function serialParaIso(n) {
  if (typeof n !== 'number' || !isFinite(n) || n < 1 || n > 200000) return null;
  var d = new Date(Date.UTC(1899, 11, 30) + Math.round(n) * MS_DIA);
  return montaIso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/* Aceita o que a planilha entregar: texto brasileiro, ISO, objeto Date
   ou o número serial do Excel. Devolve {iso, aviso} ou null. */
function parseData(v) {
  if (v === null || v === undefined || v === '') return null;

  if (v instanceof Date && !isNaN(v.getTime())) {
    return { iso: montaIso(v.getFullYear(), v.getMonth() + 1, v.getDate()), aviso: null };
  }
  if (typeof v === 'number') {
    var iso = serialParaIso(v);
    return iso && isoValido(iso) ? { iso: iso, aviso: null } : null;
  }

  var s = String(v).trim();
  if (!s) return null;

  var m = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(s);      // 2026-08-03
  if (m) {
    var i1 = montaIso(+m[1], +m[2], +m[3]);
    return isoValido(i1) ? { iso: i1, aviso: null } : null;
  }

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/.exec(s);          // 03/08/2026
  if (m) {
    var i2 = montaIso(+m[3], +m[2], +m[1]);
    return isoValido(i2) ? { iso: i2, aviso: null } : null;
  }

  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2})$/.exec(s);         // 03/08/26
  if (m) {
    var i3 = montaIso(expandeAno(+m[3]), +m[2], +m[1]);
    return isoValido(i3)
      ? { iso: i3, aviso: 'Ano com 2 dígitos interpretado como ' + partes(i3).ano + '. Confirme.' }
      : null;
  }

  m = /^(\d{8})$/.exec(s);                                     // 03082026
  if (m) {
    var i4 = montaIso(+s.slice(4, 8), +s.slice(2, 4), +s.slice(0, 2));
    if (isoValido(i4)) return { iso: i4, aviso: null };
  }

  if (/^\d+([.,]\d+)?$/.test(s)) {                             // serial em texto
    var i5 = serialParaIso(parseFloat(s.replace(',', '.')));
    if (i5 && isoValido(i5)) return { iso: i5, aviso: null };
  }
  return null;
}

Core.MS_DIA = MS_DIA;
Core.MESES = MESES;
Core.MESES_CURTO = MESES_CURTO;
Core.pad2 = pad2;
Core.ehBissexto = ehBissexto;
Core.diasNoMes = diasNoMes;
Core.isoValido = isoValido;
Core.partes = partes;
Core.montaIso = montaIso;
Core.numDia = numDia;
Core.deNumDia = deNumDia;
Core.somaDias = somaDias;
Core.difDias = difDias;
Core.hojeIso = hojeIso;
Core.isoParaBr = isoParaBr;
Core.dataLonga = dataLonga;
Core.rotuloMes = rotuloMes;
Core.serialParaIso = serialParaIso;
Core.parseData = parseData;


/* =================================================================
   2) CPF
   ================================================================= */

function cpfDigitos(v) {
  return String(v === null || v === undefined ? '' : v).replace(/\D/g, '');
}

function cpfValido(v) {
  var d = cpfDigitos(v);
  if (d.length !== 11) return false;
  if (/^(\d)\1{10}$/.test(d)) return false;      // 000.000.000-00 e irmãos
  var s = 0, i, dig;
  for (i = 0; i < 9; i++) s += +d[i] * (10 - i);
  dig = 11 - (s % 11); if (dig >= 10) dig = 0;
  if (dig !== +d[9]) return false;
  s = 0;
  for (i = 0; i < 10; i++) s += +d[i] * (11 - i);
  dig = 11 - (s % 11); if (dig >= 10) dig = 0;
  return dig === +d[10];
}

function cpfFormatado(v) {
  var d = cpfDigitos(v);
  if (d.length !== 11) return d || '';
  return d.slice(0, 3) + '.' + d.slice(3, 6) + '.' + d.slice(6, 9) + '-' + d.slice(9);
}

/* Mesma máscara da função colab_mascara_cpf() no banco. Se mudar aqui,
   mude lá — a tela nunca deve mostrar mais do que a view entrega. */
function cpfMascarado(v) {
  var d = cpfDigitos(v);
  if (d.length !== 11) return '';
  return '***.***.' + d.slice(6, 9) + '-' + d.slice(9, 11);
}

Core.cpfDigitos = cpfDigitos;
Core.cpfValido = cpfValido;
Core.cpfFormatado = cpfFormatado;
Core.cpfMascarado = cpfMascarado;


/* =================================================================
   3) TELEFONE

   Alvo: o formato que o WhatsApp aceita — 55 + DDD + 9 dígitos.
   A planilha da folha traz de tudo: campo vazio, só o DDD, parêntese
   sem fechar, e celular antigo de 8 dígitos (anterior ao nono dígito).
   Nada disso é "consertado" no escuro: o de 8 dígitos vira sugestão
   para o usuário confirmar.
   ================================================================= */

var DDDS = [11,12,13,14,15,16,17,18,19,
            21,22,24,27,28,
            31,32,33,34,35,37,38,
            41,42,43,44,45,46,47,48,49,
            51,53,54,55,
            61,62,63,64,65,66,67,68,69,
            71,73,74,75,77,79,
            81,82,83,84,85,86,87,88,89,
            91,92,93,94,95,96,97,98,99];

function dddValido(ddd) { return DDDS.indexOf(+ddd) >= 0; }

/* tipo:
     vazio      — não informado
     movel      — pronto para o WhatsApp
     fixo       — número válido, mas telefone fixo (WhatsApp não abre)
     incompleto — celular de 8 dígitos; falta o nono. Traz sugestão.
     sem_ddd    — número sem DDD
     invalido   — não dá para aproveitar                                */
function analisarTelefone(v) {
  var bruto = String(v === null || v === undefined ? '' : v).trim();
  var d = bruto.replace(/\D/g, '');
  var r = { bruto: bruto, digitos: null, ddd: null, numero: null,
            tipo: 'vazio', whatsapp: false, ok: false,
            motivo: '', sugestao: null, exibicao: '' };

  if (!d) { r.motivo = 'Telefone não informado'; return r; }

  d = d.replace(/^0+/, '');                       // 0 de operadora
  if (/^55/.test(d) && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length > 11 && /^0*55/.test(d)) d = d.replace(/^0*55/, '');

  if (d.length === 8 || d.length === 9) {
    r.tipo = 'sem_ddd'; r.numero = d;
    r.motivo = 'Falta o DDD';
    return r;
  }
  if (d.length !== 10 && d.length !== 11) {
    r.tipo = 'invalido';
    r.motivo = 'Quantidade de dígitos fora do padrão (' + d.length + ')';
    return r;
  }

  var ddd = d.slice(0, 2), num = d.slice(2);
  r.ddd = ddd; r.numero = num;
  if (!dddValido(ddd)) {
    r.tipo = 'invalido'; r.motivo = 'DDD ' + ddd + ' não existe';
    return r;
  }

  if (num.length === 9) {
    if (num[0] === '9') {
      r.tipo = 'movel'; r.whatsapp = true; r.ok = true;
      r.digitos = '55' + ddd + num;
    } else {
      r.tipo = 'invalido';
      r.motivo = 'Celular de 9 dígitos precisa começar com 9';
      return r;
    }
  } else {                                        // 8 dígitos
    if (/^[2-5]/.test(num)) {
      r.tipo = 'fixo'; r.ok = true;
      r.digitos = '55' + ddd + num;
      r.motivo = 'Telefone fixo — o WhatsApp não abre conversa com este número';
    } else {
      r.tipo = 'incompleto';
      r.motivo = 'Celular de 8 dígitos: falta o nono dígito';
      r.sugestao = '55' + ddd + '9' + num;
      return r;
    }
  }

  r.exibicao = exibirTelefone(r.digitos);
  return r;
}

function exibirTelefone(digitos) {
  var d = String(digitos || '').replace(/\D/g, '');
  if (/^55/.test(d) && d.length >= 12) d = d.slice(2);
  if (d.length === 11) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 7) + '-' + d.slice(7);
  if (d.length === 10) return '(' + d.slice(0, 2) + ') ' + d.slice(2, 6) + '-' + d.slice(6);
  return d;
}

/* O relatório da folha traz "Fones: <residencial> / <celular>", e às
   vezes o número útil está no primeiro campo. Analisa os dois e fica
   com o melhor: celular pronto > celular sem o nono dígito > fixo. */
function melhorTelefone(lista) {
  var ordem = { movel: 4, incompleto: 3, fixo: 2, sem_ddd: 1, invalido: 0, vazio: -1 };
  var melhor = null;
  (lista || []).forEach(function (v) {
    var a = analisarTelefone(v);
    if (!melhor || ordem[a.tipo] > ordem[melhor.tipo]) melhor = a;
  });
  return melhor || analisarTelefone('');
}

Core.DDDS = DDDS;
Core.dddValido = dddValido;
Core.analisarTelefone = analisarTelefone;
Core.exibirTelefone = exibirTelefone;
Core.melhorTelefone = melhorTelefone;


/* =================================================================
   4) E-MAIL E NOME
   ================================================================= */

/* Validação de formato, como pede o escopo — não confirma existência. */
function emailValido(v) {
  var s = String(v === null || v === undefined ? '' : v).trim();
  if (!s || s.length > 254) return false;
  if (/\s/.test(s)) return false;
  return /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$/.test(s);
}

function normalizarEmail(v) {
  return String(v === null || v === undefined ? '' : v).trim().toLowerCase();
}

function limparNome(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/\s+/g, ' ').trim();
}

/* Marcas de acento no formato decomposto (NFD). Escrito com \u para o
   arquivo poder ser salvo em qualquer codificação sem quebrar. */
var RE_ACENTOS = /[\u0300-\u036f]/g;

function semAcento(s) {
  var t = String(s === null || s === undefined ? '' : s);
  return t.normalize ? t.normalize('NFD').replace(RE_ACENTOS, '') : t;
}

/* Chave de comparação de nome: sem acento, sem caixa, sem espaço duplo.
   Serve para achar a mesma pessoa quando não há CPF. */
function chaveNome(v) {
  return semAcento(limparNome(v)).toUpperCase();
}

function primeiroNome(v) {
  var n = limparNome(v);
  if (!n) return '';
  var p = n.split(' ')[0];
  // Nome vindo da folha costuma estar todo em maiúscula: "MARIA" -> "Maria".
  if (p === p.toUpperCase()) {
    p = p.charAt(0).toUpperCase() + p.slice(1).toLowerCase();
  }
  return p;
}

function nomeApresentavel(v) {
  var n = limparNome(v);
  if (!n || n !== n.toUpperCase()) return n;
  var minus = ['de','da','do','das','dos','e','di','du','del'];
  return n.toLowerCase().split(' ').map(function (p, i) {
    if (i > 0 && minus.indexOf(p) >= 0) return p;
    return p.charAt(0).toUpperCase() + p.slice(1);
  }).join(' ');
}

Core.emailValido = emailValido;
Core.normalizarEmail = normalizarEmail;
Core.limparNome = limparNome;
Core.chaveNome = chaveNome;
Core.primeiroNome = primeiroNome;
Core.nomeApresentavel = nomeApresentavel;


/* =================================================================
   5) CONTRATO DE EXPERIÊNCIA

   A conta, escrita uma única vez:
     - a admissão é o DIA 1 do contrato;
     - 1º período = 30 dias corridos  -> termina em admissão + 29;
     - o 2º período começa no dia 31 e acrescenta 60 dias corridos,
       fechando 90 dias -> termina em admissão + 89, que é o 90º dia.

   "Dias corridos" quer dizer soma de dias no calendário: fevereiro com
   28 ou 29, meses de 30 ou 31 e virada de ano saem certos de graça,
   porque a soma é feita em número de dias, não em mês.
   ================================================================= */

var DIAS_P1 = 30;
var DIAS_TOTAL = 90;

function experiencia(admissaoIso) {
  if (!isoValido(admissaoIso)) return null;
  return {
    inicio:    admissaoIso,
    fimP1:     somaDias(admissaoIso, DIAS_P1 - 1),        // 30º dia
    inicioP2:  somaDias(admissaoIso, DIAS_P1),            // 31º dia
    fimP2:     somaDias(admissaoIso, DIAS_TOTAL - 1),     // 90º dia
    diasP1:    DIAS_P1,
    diasP2:    DIAS_TOTAL - DIAS_P1,
    diasTotal: DIAS_TOTAL
  };
}

/* Qual é o dia do contrato em que a pessoa está (1 = dia da admissão). */
function diaDoContrato(admissaoIso, hoje) {
  if (!isoValido(admissaoIso) || !isoValido(hoje)) return null;
  return difDias(admissaoIso, hoje) + 1;
}

var STATUS_CONTRATO = {
  sem_admissao:       { rotulo: 'Sem data de admissão',            cor: 'cinza'  },
  p1_andamento:       { rotulo: '1º período em andamento',         cor: 'azul'   },
  p1_aguardando:      { rotulo: 'Aguardando decisão do 1º período',cor: 'ambar'  },
  renovacao_aprovada: { rotulo: 'Renovação aprovada',              cor: 'ambar'  },
  p2_andamento:       { rotulo: '2º período em andamento',         cor: 'azul'   },
  p2_aguardando:      { rotulo: 'Aguardando decisão final',        cor: 'ambar'  },
  efetivado:          { rotulo: 'Efetivado',                       cor: 'verde'  },
  reprovado_p1:       { rotulo: 'Reprovado no 1º período',         cor: 'vermelho' },
  reprovado_p2:       { rotulo: 'Reprovado no 2º período',         cor: 'vermelho' },
  encerrado:          { rotulo: 'Contrato encerrado',              cor: 'vermelho' }
};

/* Espelho exato de colab_contrato_status() no banco. Se mudar um, mude
   o outro — e o teste compara os dois casos de fronteira. */
function contratoStatus(c, cfg, hoje) {
  cfg = cfg || {};
  var avisoP1 = cfg.dias_aviso_p1 === undefined ? 7 : +cfg.dias_aviso_p1;
  var avisoP2 = cfg.dias_aviso_p2 === undefined ? 7 : +cfg.dias_aviso_p2;

  if (c.p2_decisao === 'efetivado') return 'efetivado';
  if (c.p2_decisao === 'encerrado') return 'reprovado_p2';
  if (c.p1_decisao === 'reprovado') return 'reprovado_p1';
  if (c.data_encerramento) return 'encerrado';
  if (!isoValido(c.data_admissao)) return 'sem_admissao';

  var e = experiencia(c.data_admissao);

  if (c.p1_decisao === 'aprovado') {
    if (!c.renovacao_confirmada_em) return 'renovacao_aprovada';
    return difDias(hoje, e.fimP2) > avisoP2 ? 'p2_andamento' : 'p2_aguardando';
  }
  return difDias(hoje, e.fimP1) > avisoP1 ? 'p1_andamento' : 'p1_aguardando';
}

/* Tudo que a tela precisa mostrar sobre o contrato de uma pessoa. */
function contratoResumo(c, cfg, hoje) {
  cfg = cfg || {};
  var status = contratoStatus(c, cfg, hoje);
  var e = experiencia(c.data_admissao);
  var r = {
    status: status,
    rotulo: STATUS_CONTRATO[status].rotulo,
    cor: STATUS_CONTRATO[status].cor,
    fimP1: e ? e.fimP1 : null,
    fimP2: e ? e.fimP2 : null,
    inicioP2: e ? e.inicioP2 : null,
    diaAtual: e ? diaDoContrato(c.data_admissao, hoje) : null,
    diasParaFimP1: e ? difDias(hoje, e.fimP1) : null,
    diasParaFimP2: e ? difDias(hoje, e.fimP2) : null,
    encerrado: ['efetivado','reprovado_p1','reprovado_p2','encerrado'].indexOf(status) >= 0,
    atrasado: false,
    proximaAcao: null,
    prazo: null
  };

  if (status === 'p1_aguardando') {
    r.proximaAcao = 'Decidir o 1º período: aprovar para renovação ou reprovar';
    r.prazo = r.fimP1;
    r.atrasado = r.diasParaFimP1 < 0;
  } else if (status === 'renovacao_aprovada') {
    r.proximaAcao = 'Confirmar a renovação para o 2º período começar a contar';
    r.prazo = r.fimP1;
    // Passou do 30º dia e a renovação segue sem confirmar: está em atraso.
    r.atrasado = difDias(hoje, r.fimP1) < 0;
  } else if (status === 'p2_aguardando') {
    r.proximaAcao = 'Decisão final: efetivar ou encerrar o contrato';
    r.prazo = r.fimP2;
    r.atrasado = r.diasParaFimP2 < 0;
  } else if (status === 'p1_andamento') {
    r.proximaAcao = 'Nada a fazer agora — o aviso do 1º período chega em ' +
      (r.diasParaFimP1 - (cfg.dias_aviso_p1 === undefined ? 7 : +cfg.dias_aviso_p1)) + ' dia(s)';
    r.prazo = r.fimP1;
  } else if (status === 'p2_andamento') {
    r.proximaAcao = 'Nada a fazer agora — o aviso da decisão final chega em ' +
      (r.diasParaFimP2 - (cfg.dias_aviso_p2 === undefined ? 7 : +cfg.dias_aviso_p2)) + ' dia(s)';
    r.prazo = r.fimP2;
  }
  return r;
}

/* As decisões que podem ser tomadas agora, para a tela não oferecer
   botão que o banco vai recusar. */
function acoesContrato(c, cfg, hoje) {
  var s = contratoStatus(c, cfg, hoje);
  var a = { p1: false, renovar: false, p2: false, encerrar: false };
  if (s === 'p1_andamento' || s === 'p1_aguardando') { a.p1 = true; a.encerrar = true; }
  if (s === 'renovacao_aprovada') { a.renovar = true; a.encerrar = true; }
  if (s === 'p2_andamento' || s === 'p2_aguardando') { a.p2 = true; a.encerrar = true; }
  if (s === 'efetivado') { a.encerrar = true; }
  return a;
}

/* REGULARIZAÇÃO DE HISTÓRICO
   Ao importar o cadastro que já existia antes deste módulo, entra gente
   admitida há anos. Como não há decisão registrada, a regra acima os
   classifica — corretamente — como "aguardando decisão do 1º período",
   e a central de notificações abre com dezenas de cobranças de um
   contrato que na prática terminou muito antes.

   A saída NÃO é o sistema deduzir a decisão sozinho: isso esconderia
   pendência de verdade. É separar esses casos para o RH efetivar em
   lote, uma vez, com registro de quem fez, quando e por quê.

   A margem existe para não varrer junto quem venceu há pouco: alguém
   cujo 90º dia foi na semana passada é pendência real, não histórico. */
function candidatosRegularizacao(lista, cfg, hoje, diasMargem) {
  var margem = diasMargem === undefined ? 30 : +diasMargem;
  return (lista || []).filter(function (c) {
    if (!isoValido(c.data_admissao)) return false;
    if (c.p1_decisao || c.p2_decisao || c.data_encerramento) return false;
    if (c.situacao !== 'Ativo') return false;
    var e = experiencia(c.data_admissao);
    return difDias(e.fimP2, hoje) > margem;
  });
}

Core.candidatosRegularizacao = candidatosRegularizacao;
Core.DIAS_P1 = DIAS_P1;
Core.DIAS_TOTAL = DIAS_TOTAL;
Core.experiencia = experiencia;
Core.diaDoContrato = diaDoContrato;
Core.STATUS_CONTRATO = STATUS_CONTRATO;
Core.contratoStatus = contratoStatus;
Core.contratoResumo = contratoResumo;
Core.acoesContrato = acoesContrato;


/* =================================================================
   6) ANIVERSÁRIO E FOLGA

   Quem nasceu em 29 de fevereiro só tem aniversário no calendário a
   cada quatro anos. Nos outros anos o módulo considera 28 de fevereiro
   — assim a pessoa aparece na lista do mês, recebe mensagem e tem
   direito à folga todo ano, em vez de desaparecer em três de cada
   quatro anos.
   ================================================================= */

function aniversarioNoAno(nascIso, ano) {
  var p = partes(nascIso);
  if (!p) return null;
  var dia = p.dia;
  if (p.mes === 2 && p.dia === 29 && !ehBissexto(ano)) dia = 28;
  return montaIso(ano, p.mes, dia);
}

function ehAniversarioAdiado(nascIso, ano) {
  var p = partes(nascIso);
  return !!(p && p.mes === 2 && p.dia === 29 && !ehBissexto(ano));
}

function proximoAniversario(nascIso, hoje) {
  var p = partes(nascIso), h = partes(hoje);
  if (!p || !h) return null;
  var deste = aniversarioNoAno(nascIso, h.ano);
  if (difDias(hoje, deste) >= 0) return deste;
  return aniversarioNoAno(nascIso, h.ano + 1);
}

function diasParaAniversario(nascIso, hoje) {
  var prox = proximoAniversario(nascIso, hoje);
  return prox ? difDias(hoje, prox) : null;
}

function idadeQueFaz(nascIso, ano) {
  var p = partes(nascIso);
  return p ? ano - p.ano : null;
}

/* Aniversariantes de um mês. `mes` 1..12. */
function aniversariantesDoMes(lista, ano, mes, hoje) {
  return (lista || []).filter(function (c) {
    var p = partes(c.data_nascimento);
    if (!p) return false;
    // 29/02 em ano comum continua contando como fevereiro.
    return p.mes === mes;
  }).map(function (c) {
    var aniv = aniversarioNoAno(c.data_nascimento, ano);
    return {
      colaborador: c,
      aniversario: aniv,
      dia: partes(aniv).dia,
      adiado: ehAniversarioAdiado(c.data_nascimento, ano),
      idade: idadeQueFaz(c.data_nascimento, ano),
      diasPara: hoje ? difDias(hoje, aniv) : null,
      ano: ano,
      mes: mes
    };
  }).sort(function (a, b) {
    return a.dia - b.dia || chaveNome(a.colaborador.nome).localeCompare(chaveNome(b.colaborador.nome));
  });
}

function mesSeguinte(ano, mes) {
  return mes === 12 ? { ano: ano + 1, mes: 1 } : { ano: ano, mes: mes + 1 };
}

var FOLGA_STATUS = {
  nao_analisada:          { rotulo: 'Não analisada',              cor: 'cinza'    },
  aguardando_aprovacao:   { rotulo: 'Aguardando aprovação',       cor: 'ambar'    },
  aprovada:               { rotulo: 'Aprovada',                   cor: 'verde'    },
  agendada:               { rotulo: 'Agendada',                    cor: 'azul'     },
  realizada:              { rotulo: 'Realizada',                   cor: 'verde'    },
  recusada:               { rotulo: 'Recusada',                    cor: 'vermelho' },
  nao_se_aplica:          { rotulo: 'Não se aplica',               cor: 'cinza'    },
  reagendada_excepcional: { rotulo: 'Reagendada excepcionalmente', cor: 'ambar'    }
};

/* A folga não precisa cair no dia do aniversário, mas precisa cair na
   mesma competência mensal — isto é, no mesmo mês do aniversário.
   Fora dela, só como exceção autorizada, e a exceção fica registrada. */
function folgaNaCompetencia(nascIso, folgaIso) {
  var n = partes(nascIso), f = partes(folgaIso);
  if (!n || !f) return null;
  return f.mes === n.mes;
}

function validarFolga(colab, folgaIso, ano, excepcional) {
  var r = { ok: true, erros: [], avisos: [], excepcional: !!excepcional };
  if (!isoValido(folgaIso)) { r.ok = false; r.erros.push('Data da folga inválida.'); return r; }
  if (!isoValido(colab.data_nascimento)) {
    r.ok = false;
    r.erros.push('Sem data de nascimento não é possível conferir a competência da folga.');
    return r;
  }
  var n = partes(colab.data_nascimento), f = partes(folgaIso);
  if (f.mes !== n.mes) {
    if (!excepcional) {
      r.ok = false;
      r.erros.push('A folga precisa acontecer em ' + MESES[n.mes - 1] +
                   ', mês do aniversário. Para outra data, marque como exceção autorizada.');
    } else {
      r.avisos.push('Fora da competência de ' + MESES[n.mes - 1] +
                    ' — será registrada como exceção autorizada.');
    }
  }
  if (ano && f.ano !== ano) {
    r.avisos.push('A data escolhida é de ' + f.ano + ', e a competência tratada é ' + ano + '.');
  }
  return r;
}

/* Impacto operacional: outras folgas na mesma data e mesma unidade.
   Avisa, mas não impede — a decisão é do gestor autorizado. */
function conflitosFolga(lista, colab, folgaIso) {
  var ativos = ['aprovada','agendada','realizada','reagendada_excepcional'];
  return (lista || []).filter(function (o) {
    return o.id !== colab.id
      && o.folga_data === folgaIso
      && (o.unidade || '') === (colab.unidade || '')
      && ativos.indexOf(o.folga_status) >= 0;
  });
}

function folgaPendenteNoAno(c, ano) {
  if (c.folga_ano !== ano) return true;   // ano novo, folga nova
  return ['nao_analisada','aguardando_aprovacao'].indexOf(c.folga_status) >= 0;
}

function msgAnivEnviada(c, ano) {
  return c.aniv_msg_ano === ano && !!c.aniv_msg_em;
}

Core.aniversarioNoAno = aniversarioNoAno;
Core.ehAniversarioAdiado = ehAniversarioAdiado;
Core.proximoAniversario = proximoAniversario;
Core.diasParaAniversario = diasParaAniversario;
Core.idadeQueFaz = idadeQueFaz;
Core.aniversariantesDoMes = aniversariantesDoMes;
Core.mesSeguinte = mesSeguinte;
Core.FOLGA_STATUS = FOLGA_STATUS;
Core.folgaNaCompetencia = folgaNaCompetencia;
Core.validarFolga = validarFolga;
Core.conflitosFolga = conflitosFolga;
Core.folgaPendenteNoAno = folgaPendenteNoAno;
Core.msgAnivEnviada = msgAnivEnviada;


/* =================================================================
   7) MENSAGEM DE ANIVERSÁRIO
   ================================================================= */

var MSG_ANIV_PADRAO =
  'Olá, {PRIMEIRO_NOME}! Em nome de toda a equipe, desejamos a você um feliz aniversário! ' +
  'Que este novo ciclo seja marcado por muitas conquistas, saúde, felicidade e sucesso. ' +
  'Agradecemos por fazer parte do nosso time. Aproveite muito o seu dia! 🎉🎂';

function montarMsgAniversario(modelo, colab, extras) {
  var tpl = modelo || MSG_ANIV_PADRAO;
  var v = extras || {};
  return tpl
    .replace(/\{PRIMEIRO_NOME\}/g, primeiroNome(colab.nome))
    .replace(/\{NOME\}/g, nomeApresentavel(colab.nome))
    .replace(/\{NOME_COMPLETO\}/g, nomeApresentavel(colab.nome))
    .replace(/\{UNIDADE\}/g, colab.unidade || '')
    .replace(/\{EMPRESA\}/g, v.empresa || '')
    .replace(/\{IDADE\}/g, v.idade === undefined || v.idade === null ? '' : String(v.idade));
}

function linkWhatsapp(telefoneDigitos, mensagem) {
  var d = String(telefoneDigitos || '').replace(/\D/g, '');
  if (!d) return null;
  return 'https://wa.me/' + d + '?text=' + encodeURIComponent(mensagem || '');
}

Core.MSG_ANIV_PADRAO = MSG_ANIV_PADRAO;
Core.montarMsgAniversario = montarMsgAniversario;
Core.linkWhatsapp = linkWhatsapp;


/* =================================================================
   8) TERMO DE ENCERRAMENTO

   Modelo operacional, com campos dinâmicos. A observação interna do
   gestor (p1_obs / p2_obs) NÃO tem campo aqui de propósito: ela é de
   uso interno e não pode vazar para a via entregue ao colaborador.
   O teste confere que ela não aparece no texto gerado.
   ================================================================= */

var TERMO_PADRAO =
'TERMO DE ENCERRAMENTO DE CONTRATO DE EXPERIÊNCIA\n' +
'\n' +
'Pelo presente instrumento, fica formalizado o encerramento do contrato de experiência ' +
'do(a) colaborador(a) [NOME COMPLETO], inscrito(a) no CPF sob o nº [CPF], admitido(a) em ' +
'[DATA DE ADMISSÃO], para exercer suas atividades junto à empresa [NOME DA EMPRESA].\n' +
'\n' +
'O encerramento ocorrerá em [DATA DO ENCERRAMENTO], conforme as condições estabelecidas ' +
'no contrato de experiência firmado entre as partes.\n' +
'\n' +
'O presente termo é emitido em duas vias de igual teor, ficando uma via com o(a) ' +
'colaborador(a) e outra com a empresa.\n' +
'\n' +
'[CIDADE], [DATA DE EMISSÃO].\n' +
'\n' +
'__________________________________\n' +
'[NOME DO COLABORADOR]\n' +
'CPF: [CPF]\n' +
'\n' +
'__________________________________\n' +
'[NOME DO RESPONSÁVEL PELA EMPRESA]\n' +
'Cargo: [CARGO]';

var TERMO_CAMPOS = ['[NOME COMPLETO]','[CPF]','[DATA DE ADMISSÃO]','[NOME DA EMPRESA]',
                    '[DATA DO ENCERRAMENTO]','[CIDADE]','[DATA DE EMISSÃO]',
                    '[NOME DO COLABORADOR]','[NOME DO RESPONSÁVEL PELA EMPRESA]','[CARGO]'];

var TERMO_RESSALVA =
  'Documento gerado automaticamente pelo módulo de Gestão de Colaboradores. ' +
  'Trata-se de MODELO OPERACIONAL: antes do uso definitivo, submeta à validação do ' +
  'RH / Departamento Pessoal ou da assessoria jurídica.';

function montarTermo(colab, cfg, opcoes) {
  cfg = cfg || {}; opcoes = opcoes || {};
  var modelo = (cfg.termo_modelo && String(cfg.termo_modelo).trim()) || TERMO_PADRAO;
  var emissao = opcoes.dataEmissao || hojeIso();
  var encerramento = colab.data_encerramento || opcoes.dataEncerramento || '';
  var nome = nomeApresentavel(colab.nome);
  var cpfTexto = colab.cpf && cpfDigitos(colab.cpf).length === 11
    ? cpfFormatado(colab.cpf)
    : (colab.cpf_mascarado || '(CPF não cadastrado)');

  var faltando = [];
  if (!cfg.empresa_nome)   faltando.push('nome da empresa');
  if (!cfg.empresa_cidade) faltando.push('cidade');
  if (!cfg.resp_nome)      faltando.push('nome do responsável');
  if (!cfg.resp_cargo)     faltando.push('cargo do responsável');
  if (!encerramento)       faltando.push('data do encerramento');
  if (cpfDigitos(colab.cpf).length !== 11) faltando.push('CPF do colaborador');

  var texto = modelo
    .replace(/\[NOME COMPLETO\]/g, nome)
    .replace(/\[NOME DO COLABORADOR\]/g, nome)
    .replace(/\[CPF\]/g, cpfTexto)
    .replace(/\[DATA DE ADMISS[ÃA]O\]/g, isoParaBr(colab.data_admissao) || '—')
    .replace(/\[NOME DA EMPRESA\]/g, cfg.empresa_nome || '________________________')
    .replace(/\[DATA DO ENCERRAMENTO\]/g, isoParaBr(encerramento) || '__/__/____')
    .replace(/\[CIDADE\]/g, cfg.empresa_cidade || '________________')
    .replace(/\[DATA DE EMISS[ÃA]O\]/g, dataLonga(emissao))
    .replace(/\[NOME DO RESPONS[ÁA]VEL PELA EMPRESA\]/g, cfg.resp_nome || '________________________')
    .replace(/\[CARGO\]/g, cfg.resp_cargo || '________________');

  return {
    texto: texto,
    titulo: 'Termo de Encerramento de Contrato de Experiência',
    ressalva: TERMO_RESSALVA,
    dataEmissao: emissao,
    dataEncerramento: encerramento,
    camposFaltando: faltando,
    completo: faltando.length === 0
  };
}

Core.TERMO_PADRAO = TERMO_PADRAO;
Core.TERMO_CAMPOS = TERMO_CAMPOS;
Core.TERMO_RESSALVA = TERMO_RESSALVA;
Core.montarTermo = montarTermo;


/* =================================================================
   9) SITUAÇÃO DO CADASTRO (telefone / e-mail)
   ================================================================= */

function situacaoCadastro(c) {
  var r = { completo: true, problemas: [], telefone: null, email: null };

  r.telefone = analisarTelefone(c.telefone);
  if (r.telefone.tipo === 'vazio') {
    r.problemas.push({ campo: 'telefone', grau: 'ausente', texto: 'Telefone não cadastrado' });
  } else if (!r.telefone.whatsapp) {
    r.problemas.push({
      campo: 'telefone',
      grau: r.telefone.ok ? 'atencao' : 'invalido',
      texto: r.telefone.motivo,
      sugestao: r.telefone.sugestao
    });
  }

  var em = String(c.email || '').trim();
  if (!em) {
    r.problemas.push({ campo: 'email', grau: 'ausente', texto: 'E-mail não cadastrado' });
  } else if (!emailValido(em)) {
    r.problemas.push({ campo: 'email', grau: 'invalido', texto: 'E-mail em formato inválido' });
  } else {
    r.email = em;
  }

  if (!isoValido(c.data_nascimento)) {
    r.problemas.push({ campo: 'data_nascimento', grau: 'ausente',
                       texto: 'Sem data de nascimento — fica fora de aniversário e folga' });
  }
  if (!isoValido(c.data_admissao)) {
    r.problemas.push({ campo: 'data_admissao', grau: 'ausente',
                       texto: 'Sem data de admissão — não há contrato de experiência calculado' });
  }
  if (!c.tem_cpf && !cpfValido(c.cpf)) {
    r.problemas.push({ campo: 'cpf', grau: 'ausente', texto: 'CPF não cadastrado' });
  }

  r.completo = r.problemas.length === 0;
  // "Contato incompleto" é o filtro do item 9 do escopo: só telefone/e-mail.
  r.contatoIncompleto = r.problemas.some(function (p) {
    return p.campo === 'telefone' || p.campo === 'email';
  });
  return r;
}

Core.situacaoCadastro = situacaoCadastro;


/* =================================================================
   10) IMPORTAÇÃO DE PLANILHA

   Dois formatos são reconhecidos sozinhos:

   a) TABULAR — uma linha de cabeçalho e uma linha por pessoa. É o caso
      dos layouts padrão de funcionário e das planilhas montadas à mão.

   b) RELATÓRIO DE FOLHA (Rel090, "Listagem de Funcionários") — o que
      sai do sistema de folha. Não é uma tabela: cada pessoa ocupa duas
      linhas, e telefone, e-mail e nome da mãe vêm dentro de um texto
      corrido na segunda linha, junto com o endereço. A unidade vem da
      linha "Empresa:" que abre o bloco.

   Em qualquer um dos dois o usuário pode revisar e trocar o
   de-para das colunas antes de confirmar.
   ================================================================= */

var CAMPOS_IMPORT = [
  { chave: 'nome',            rotulo: 'Nome completo',      obrigatorio: true  },
  { chave: 'cpf',             rotulo: 'CPF',                obrigatorio: false },
  { chave: 'nome_mae',        rotulo: 'Nome da mãe',        obrigatorio: false },
  { chave: 'data_admissao',   rotulo: 'Data de admissão',   obrigatorio: false },
  { chave: 'data_nascimento', rotulo: 'Data de nascimento', obrigatorio: false },
  { chave: 'email',           rotulo: 'E-mail',             obrigatorio: false },
  { chave: 'telefone',        rotulo: 'Telefone',           obrigatorio: false },
  { chave: 'ddd',             rotulo: 'DDD (coluna à parte)', obrigatorio: false },
  { chave: 'unidade',         rotulo: 'Unidade / local',    obrigatorio: false },
  { chave: 'matricula',       rotulo: 'Matrícula',          obrigatorio: false },
  { chave: 'situacao',        rotulo: 'Situação',           obrigatorio: false }
];

/* Apelidos observados nos layouts que a empresa usa (padrão de
   funcionário, relatórios da folha, planilhas de benefício e as
   montadas à mão). Quem vencer é o apelido mais longo que casar. */
var APELIDOS = {
  nome: ['NOME COMPLETO','NOME DO FUNCIONARIO','NOME DO COLABORADOR','NOME BENEFICIARIO',
         'NOME DO EMPREGADO','FUNCIONARIO','COLABORADOR','EMPREGADO','NOME'],
  cpf: ['NR CPF','N CPF','NUMERO CPF','CPF CNPJ','DOCUMENTO CPF','CPF'],
  nome_mae: ['NOME DA GENITORA','NOME COMPLETO DA MAE','FILIACAO MAE','NOME DA MAE',
             'NOME MAE','MAE'],
  data_admissao: ['DATA DE ADMISSAO','DATA ADMISSAO','DT ADMISSAO','DATA ADM','DT ADM',
                  'ADMISSAO','ADMITIDO EM','DATA DE ENTRADA'],
  data_nascimento: ['DATA DE NASCIMENTO','DATA NASCIMENTO','DT NASCIMENTO','DATA NASC',
                    'DT NASC','NASCIMENTO','DATA DE NASC'],
  email: ['E MAIL PESSOAL','ENDERECO ELETRONICO','E MAIL','EMAIL','E MAIL CORPORATIVO'],
  telefone: ['TEL CELULAR','TELEFONE CELULAR','NUMERO WHATSAPP','WHATS APP','WHATSAPP',
             'CELULAR','TELEFONE','FONE','CONTATO','TEL'],
  ddd: ['DDD CELULAR','DDD DO CELULAR','DDD'],
  unidade: ['LOCAL DE TRABALHO','CENTRO DE CUSTO','UNIDADE','ESTABELECIMENTO','TOMADOR',
            'FILIAL','LOJA','EMPRESA','SETOR','DEPARTAMENTO'],
  matricula: ['MATRICULA','MATR','CHAPA','CODIGO','MAT'],
  situacao: ['SITUACAO DO COLABORADOR','SITUACAO','STATUS']
};

function normalizarCabecalho(v) {
  var s = String(v === null || v === undefined ? '' : v);
  s = s.replace(/[\r\n]+/g, ' ');
  if (s.normalize) s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  return s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/* Casa um cabeçalho com um campo do sistema. Devolve a pontuação para
   que "DDD CELULAR" não seja confundido com "CELULAR": ganha o apelido
   mais longo. */
function pontuarCabecalho(cabecalho, campo) {
  var n = normalizarCabecalho(cabecalho);
  if (!n) return 0;
  var lista = APELIDOS[campo] || [], melhor = 0;
  for (var i = 0; i < lista.length; i++) {
    var a = lista[i];
    if (n === a) melhor = Math.max(melhor, 1000 + a.length);
    else if (n.indexOf(a + ' ') === 0) melhor = Math.max(melhor, 500 + a.length);
    else if (n.indexOf(' ' + a) === n.length - a.length - 1) melhor = Math.max(melhor, 300 + a.length);
    else if (n.indexOf(a) >= 0) melhor = Math.max(melhor, 100 + a.length);
  }
  return melhor;
}

/* De-para automático: cada coluna fica com no máximo um campo, e cada
   campo com a coluna que pontuou mais alto. */
function mapearColunas(cabecalho) {
  var candidatos = [];
  (cabecalho || []).forEach(function (h, idx) {
    CAMPOS_IMPORT.forEach(function (c) {
      var p = pontuarCabecalho(h, c.chave);
      if (p > 0) candidatos.push({ coluna: idx, campo: c.chave, pontos: p });
    });
  });
  candidatos.sort(function (a, b) { return b.pontos - a.pontos; });

  var mapa = {}, colUsada = {};
  candidatos.forEach(function (c) {
    if (mapa[c.campo] !== undefined) return;
    if (colUsada[c.coluna]) return;
    mapa[c.campo] = c.coluna;
    colUsada[c.coluna] = true;
  });
  return mapa;
}

function celula(linha, idx) {
  if (idx === undefined || idx === null || !linha) return '';
  var v = linha[idx];
  return v === null || v === undefined ? '' : v;
}

/* Acha a linha de cabeçalho: a primeira que casar com pelo menos dois
   campos, sendo um deles o nome. Planilhas de sistema costumam ter
   título, data e número de página antes. */
function acharCabecalho(matriz, limite) {
  var max = Math.min(matriz.length, limite || 25);
  for (var r = 0; r < max; r++) {
    var mapa = mapearColunas(matriz[r]);
    var qtd = Object.keys(mapa).length;
    if (mapa.nome !== undefined && qtd >= 2) return { linha: r, mapa: mapa };
  }
  return null;
}

function ehLinhaRelatorioFolha(linha) {
  var txt = (linha || []).map(function (c) { return normalizarCabecalho(c); }).join(' ');
  return /\bMATR\b/.test(txt) && /NOME DO FUNCIONARIO/.test(txt);
}

function detectarLayout(matriz) {
  for (var r = 0; r < Math.min(matriz.length, 30); r++) {
    if (ehLinhaRelatorioFolha(matriz[r])) {
      return { tipo: 'folha', linhaCabecalho: r };
    }
  }
  var c = acharCabecalho(matriz);
  if (c) return { tipo: 'tabular', linhaCabecalho: c.linha, mapa: c.mapa };
  return { tipo: 'indefinido' };
}

/* ---------- (a) planilha tabular ---------- */
function lerTabular(matriz, mapa, linhaCabecalho, unidadePadrao) {
  var regs = [];
  for (var r = linhaCabecalho + 1; r < matriz.length; r++) {
    var linha = matriz[r];
    if (!linha) continue;
    var vazia = linha.every(function (c) { return String(c === null || c === undefined ? '' : c).trim() === ''; });
    if (vazia) continue;

    var nome = limparNome(celula(linha, mapa.nome));
    if (!nome) continue;
    // Linha de exemplo que os layouts padrão trazem preenchida.
    if (/REMOVER ESTA LINHA/i.test(linha.join(' '))) continue;

    var fone = String(celula(linha, mapa.telefone) || '').trim();
    var ddd = String(celula(linha, mapa.ddd) || '').trim();
    if (ddd && fone && fone.replace(/\D/g, '').length <= 9) fone = ddd + fone;

    regs.push({
      linha: r + 1,
      nome: nome,
      cpf: String(celula(linha, mapa.cpf) || '').trim(),
      nome_mae: limparNome(celula(linha, mapa.nome_mae)),
      data_admissao_bruta: celula(linha, mapa.data_admissao),
      data_nascimento_bruta: celula(linha, mapa.data_nascimento),
      email: String(celula(linha, mapa.email) || '').trim(),
      telefone_bruto: fone,
      unidade: String(celula(linha, mapa.unidade) || '').trim() || unidadePadrao || '',
      matricula: String(celula(linha, mapa.matricula) || '').trim(),
      situacao: String(celula(linha, mapa.situacao) || '').trim()
    });
  }
  return regs;
}

/* ---------- (b) relatório da folha (Rel090) ---------- */

function acharColunaPor(linha, regex) {
  for (var i = 0; i < (linha || []).length; i++) {
    if (regex.test(normalizarCabecalho(linha[i]))) return i;
  }
  return undefined;
}

/* Da segunda linha de cada pessoa sai telefone, e-mail e nome da mãe.
   O texto vem assim:
     "<endereço> - CEP: 70000-100 - Fones:  / (65)991234567 -
      E-Mail: X@Y.COM\nNome da Mãe: FULANA - CTPS: 123-DF"           */
function lerDetalheFolha(texto) {
  var t = String(texto || '');
  var out = { telefones: [], email: '', nome_mae: '', endereco: '' };

  var mFone = /Fones?\s*:\s*([^\r\n]*?)(?=\s*-\s*E-?\s*Mail\s*:|[\r\n]|$)/i.exec(t);
  if (mFone) {
    out.telefones = mFone[1].split('/').map(function (p) { return p.trim(); })
      .filter(function (p) { return p.replace(/\D/g, '').length >= 8; });
  }

  var mMail = /E-?\s*Mail\s*:\s*([^\s\r\n]+)/i.exec(t);
  if (mMail) out.email = mMail[1].replace(/[,;.]+$/, '');

  var mMae = /Nome\s+da\s+M[ãaá]e\s*:\s*([^\r\n]*?)(?=\s*-\s*(?:CTPS|RG|PIS|CTPS\/)\s*:|[\r\n]|$)/i.exec(t);
  if (mMae) out.nome_mae = limparNome(mMae[1]);

  var mEnd = /^([^\r\n]*?)(?=\s*-\s*Fones?\s*:|[\r\n]|$)/.exec(t);
  if (mEnd) out.endereco = mEnd[1].trim();

  return out;
}

function lerRelatorioFolha(matriz, linhaCabecalho, unidadePadrao) {
  var cab = matriz[linhaCabecalho] || [];
  var iNome = acharColunaPor(cab, /NOME DO FUNCIONARIO/) ;
  var iCpf  = acharColunaPor(cab, /^CPF$|\bCPF\b/);
  var iAdm  = acharColunaPor(cab, /DATA ADM/);
  var iNasc = acharColunaPor(cab, /DATA NASC/);
  var iMat  = acharColunaPor(cab, /^MATR|^MAT$/);
  if (iNome === undefined) iNome = 1;
  if (iMat === undefined) iMat = 0;

  var regs = [], unidadeAtual = unidadePadrao || '', tomadorAtual = '';

  for (var r = 0; r < matriz.length; r++) {
    var linha = matriz[r] || [];
    var textoLinha = linha.map(function (c) {
      return c === null || c === undefined ? '' : String(c);
    }).join(' ');

    // Cabeçalho do bloco: define a unidade das pessoas que vêm abaixo.
    var mEmp = /Empresa\s*:\s*(.+?)\s*$/i.exec(String(linha[0] || ''));
    if (mEmp) { unidadeAtual = mEmp[1].trim(); tomadorAtual = ''; continue; }
    var mTom = /Tomador\s*:\s*(.+?)\s*$/i.exec(String(linha[0] || ''));
    if (mTom) {
      var tv = mTom[1].trim();
      tomadorAtual = (tv === '-' || tv === '') ? '' : tv;
      continue;
    }
    if (/^(LISTAGEM|Rel\d|P[áa]g\.|Data:|Setor\s*:)/i.test(String(linha[0] || '').trim())) continue;
    if (ehLinhaRelatorioFolha(linha)) continue;

    var mat = String(linha[iMat] === null || linha[iMat] === undefined ? '' : linha[iMat]).trim();
    var nome = limparNome(linha[iNome]);
    var ehPessoa = /^\d+$/.test(mat) && nome && !/Fones?\s*:/i.test(nome);
    if (!ehPessoa) continue;

    // A linha de detalhe vem logo abaixo (às vezes com uma em branco).
    var det = { telefones: [], email: '', nome_mae: '', endereco: '' };
    for (var k = 1; k <= 3 && r + k < matriz.length; k++) {
      var prox = (matriz[r + k] || []).map(function (c) {
        return c === null || c === undefined ? '' : String(c);
      }).join('\n');
      if (/Fones?\s*:|Nome\s+da\s+M[ãaá]e\s*:/i.test(prox)) { det = lerDetalheFolha(prox); break; }
      if (/^\d+$/.test(String((matriz[r + k] || [])[iMat] || '').trim())) break; // já é a próxima pessoa
    }

    regs.push({
      linha: r + 1,
      nome: nome,
      cpf: String(linha[iCpf] === undefined ? '' : (linha[iCpf] || '')).trim(),
      nome_mae: det.nome_mae,
      data_admissao_bruta: iAdm === undefined ? '' : linha[iAdm],
      data_nascimento_bruta: iNasc === undefined ? '' : linha[iNasc],
      email: det.email,
      telefone_bruto: det.telefones.join(' / '),
      telefones_brutos: det.telefones,
      unidade: tomadorAtual || unidadeAtual || '',
      matricula: mat,
      situacao: ''
    });
    r++;   // pula a linha de detalhe
  }
  return regs;
}

/* Porta de entrada única: recebe a matriz da planilha e devolve os
   registros crus + o que foi detectado. */
function lerPlanilha(matriz, opcoes) {
  opcoes = opcoes || {};
  var det = opcoes.layout || detectarLayout(matriz);
  var unidade = opcoes.unidade || '';
  var regs = [], mapa = det.mapa;

  if (det.tipo === 'folha') {
    regs = lerRelatorioFolha(matriz, det.linhaCabecalho, unidade);
  } else if (det.tipo === 'tabular') {
    mapa = opcoes.mapa || det.mapa || mapearColunas(matriz[det.linhaCabecalho]);
    regs = lerTabular(matriz, mapa, det.linhaCabecalho, unidade);
  }
  if (opcoes.unidade) {
    // Unidade digitada pelo usuário manda: o "Empresa: 073 - ..." do
    // relatório é a razão social, e nem sempre é o nome da unidade.
    regs.forEach(function (x) { x.unidade = opcoes.unidade; });
  }
  return { layout: det.tipo, linhaCabecalho: det.linhaCabecalho, mapa: mapa, registros: regs,
           unidadeDetectada: det.tipo === 'folha' ? unidadeDoRelatorio(matriz) : '' };
}

function unidadeDoRelatorio(matriz) {
  for (var r = 0; r < Math.min(matriz.length, 40); r++) {
    var m = /Empresa\s*:\s*(.+?)\s*$/i.exec(String(((matriz[r] || [])[0]) || ''));
    if (m) return m[1].trim();
  }
  return '';
}

/* ---------- validação linha a linha ---------- */
/* grau:
     valido   — entra direto
     manual   — entra, mas com pendência que precisa de olho humano
     invalido — não entra                                              */
function validarRegistro(reg) {
  var v = {
    linha: reg.linha,
    nome: limparNome(reg.nome),
    cpf: null,
    nome_mae: reg.nome_mae || null,
    data_admissao: null,
    data_nascimento: null,
    email: null,
    telefone: null,
    unidade: reg.unidade || null,
    matricula: reg.matricula || null,
    situacao: /inativ|desligad|demitid/i.test(reg.situacao || '') ? 'Inativo' : 'Ativo',
    erros: [], avisos: [], grau: 'valido'
  };

  if (!v.nome) { v.erros.push('Sem nome'); v.grau = 'invalido'; return v; }
  if (v.nome.length < 3) v.avisos.push('Nome muito curto — confira');

  // CPF
  var cpfBruto = String(reg.cpf || '').trim();
  if (!cpfBruto) {
    v.avisos.push('CPF não informado — sem ele não há como garantir que não é duplicata');
    v.grau = 'manual';
  } else if (!cpfValido(cpfBruto)) {
    v.erros.push('CPF inválido: ' + cpfBruto);
    v.grau = 'invalido';
  } else {
    v.cpf = cpfDigitos(cpfBruto);
  }

  // Admissão
  var adm = parseData(reg.data_admissao_bruta);
  if (!adm) {
    if (String(reg.data_admissao_bruta || '').trim()) {
      v.erros.push('Data de admissão inválida: ' + reg.data_admissao_bruta);
      v.grau = 'invalido';
    } else {
      v.avisos.push('Sem data de admissão — o contrato de experiência não será calculado');
      if (v.grau === 'valido') v.grau = 'manual';
    }
  } else {
    v.data_admissao = adm.iso;
    if (adm.aviso) v.avisos.push('Admissão: ' + adm.aviso);
  }

  // Nascimento
  var nasc = parseData(reg.data_nascimento_bruta);
  if (!nasc) {
    if (String(reg.data_nascimento_bruta || '').trim()) {
      v.erros.push('Data de nascimento inválida: ' + reg.data_nascimento_bruta);
      v.grau = 'invalido';
    } else {
      v.avisos.push('Sem data de nascimento — ficará fora de aniversário e folga');
      if (v.grau === 'valido') v.grau = 'manual';
    }
  } else {
    v.data_nascimento = nasc.iso;
    if (nasc.aviso) v.avisos.push('Nascimento: ' + nasc.aviso);
  }

  // Coerência entre as duas datas
  if (v.data_admissao && v.data_nascimento) {
    var anos = difDias(v.data_nascimento, v.data_admissao) / 365.25;
    if (anos < 14) {
      v.erros.push('Admissão menos de 14 anos após o nascimento — confira as datas');
      v.grau = 'invalido';
    } else if (anos > 80) {
      v.avisos.push('Mais de 80 anos entre nascimento e admissão — confira as datas');
      if (v.grau === 'valido') v.grau = 'manual';
    }
  }

  // E-mail
  var em = normalizarEmail(reg.email);
  if (!em) {
    v.avisos.push('E-mail não informado');
    if (v.grau === 'valido') v.grau = 'manual';
  } else if (!emailValido(em)) {
    v.avisos.push('E-mail em formato inválido: ' + em);
    if (v.grau === 'valido') v.grau = 'manual';
  } else {
    v.email = em;
  }

  // Telefone
  var tel = reg.telefones_brutos && reg.telefones_brutos.length
    ? melhorTelefone(reg.telefones_brutos)
    : analisarTelefone(reg.telefone_bruto);
  v.telefoneAnalise = tel;
  if (tel.tipo === 'vazio') {
    v.avisos.push('Telefone não informado');
    if (v.grau === 'valido') v.grau = 'manual';
  } else if (tel.tipo === 'incompleto') {
    v.avisos.push(tel.motivo + '. Sugestão: ' + exibirTelefone(tel.sugestao));
    v.telefoneSugestao = tel.sugestao;
    if (v.grau === 'valido') v.grau = 'manual';
  } else if (tel.tipo === 'fixo') {
    v.telefone = tel.digitos;
    v.avisos.push(tel.motivo);
    if (v.grau === 'valido') v.grau = 'manual';
  } else if (!tel.ok) {
    v.avisos.push('Telefone não aproveitável: ' + tel.motivo + ' (' + tel.bruto + ')');
    if (v.grau === 'valido') v.grau = 'manual';
  } else {
    v.telefone = tel.digitos;
  }

  return v;
}

/* ---------- conciliação com o que já está cadastrado ----------
   Nada é sobrescrito por conta própria: as diferenças viram propostas.
   Telefone e e-mail vêm pré-marcados porque são o alvo declarado do
   escopo; os demais campos ficam desmarcados, à espera do usuário. */
var CAMPOS_COMPARAR = [
  { chave: 'nome',            rotulo: 'Nome',              premarcado: false },
  { chave: 'nome_mae',        rotulo: 'Nome da mãe',       premarcado: false },
  { chave: 'cpf',             rotulo: 'CPF',               premarcado: false },
  { chave: 'data_admissao',   rotulo: 'Data de admissão',  premarcado: false },
  { chave: 'data_nascimento', rotulo: 'Data de nascimento',premarcado: false },
  { chave: 'email',           rotulo: 'E-mail',            premarcado: true  },
  { chave: 'telefone',        rotulo: 'Telefone',          premarcado: true  },
  { chave: 'unidade',         rotulo: 'Unidade',           premarcado: false }
];

function valorComparavel(chave, v) {
  if (v === null || v === undefined || v === '') return '';
  if (chave === 'telefone' || chave === 'cpf') return String(v).replace(/\D/g, '');
  if (chave === 'email') return normalizarEmail(v);
  if (chave === 'nome' || chave === 'nome_mae') return chaveNome(v);
  return String(v).trim();
}

function conciliar(validados, existentes) {
  var porCpf = {}, porNomeAdm = {};
  (existentes || []).forEach(function (c) {
    if (c.cpf && cpfDigitos(c.cpf).length === 11) porCpf[cpfDigitos(c.cpf)] = c;
    porNomeAdm[chaveNome(c.nome) + '|' + (c.data_admissao || '')] = c;
  });

  var vistosCpf = {}, vistosNome = {};
  var res = {
    inserir: [], atualizar: [], semMudanca: [], duplicadosNoArquivo: [],
    invalidos: [], manual: [], total: (validados || []).length
  };

  (validados || []).forEach(function (v) {
    if (v.grau === 'invalido') { res.invalidos.push(v); return; }

    var chaveN = chaveNome(v.nome) + '|' + (v.data_admissao || '');

    // Duplicata dentro do próprio arquivo
    if (v.cpf && vistosCpf[v.cpf]) {
      v.motivoDuplicata = 'CPF repetido na planilha (linha ' + vistosCpf[v.cpf] + ')';
      res.duplicadosNoArquivo.push(v); return;
    }
    if (!v.cpf && vistosNome[chaveN]) {
      v.motivoDuplicata = 'Mesmo nome e admissão repetidos na planilha (linha ' + vistosNome[chaveN] + ')';
      res.duplicadosNoArquivo.push(v); return;
    }
    if (v.cpf) vistosCpf[v.cpf] = v.linha; else vistosNome[chaveN] = v.linha;

    var existente = v.cpf ? porCpf[v.cpf] : porNomeAdm[chaveN];

    // Já cadastrado com CPF diferente mas mesmo nome+admissão: possível
    // duplicata que só a pessoa consegue julgar.
    if (!existente && v.cpf && porNomeAdm[chaveN]) {
      v.grau = 'manual';
      v.avisos.push('Já existe cadastro com este nome e admissão, mas com CPF diferente. Confira antes de inserir.');
      v.possivelDuplicata = porNomeAdm[chaveN];
    }

    if (!existente) {
      res.inserir.push(v);
      if (v.grau === 'manual') res.manual.push(v);
      return;
    }

    var difs = [];
    CAMPOS_COMPARAR.forEach(function (campo) {
      var novo = v[campo.chave];
      if (novo === null || novo === undefined || novo === '') return;   // planilha não informou: não apaga
      var atual = existente[campo.chave];
      if (valorComparavel(campo.chave, novo) === valorComparavel(campo.chave, atual)) return;
      difs.push({
        campo: campo.chave, rotulo: campo.rotulo,
        de: atual === null || atual === undefined ? '' : atual,
        para: novo,
        marcado: campo.premarcado
      });
    });

    if (!difs.length) {
      v.existente = existente;
      res.semMudanca.push(v);
    } else {
      v.existente = existente;
      v.diferencas = difs;
      res.atualizar.push(v);
      if (v.grau === 'manual') res.manual.push(v);
    }
  });

  return res;
}

/* Monta o pacote que vai para colab_importar(). Só entra o que o
   usuário confirmou; em atualização, só os campos marcados. */
function montarPacote(conc, escolhas) {
  escolhas = escolhas || {};
  var pacote = [];

  (conc.inserir || []).forEach(function (v) {
    if (escolhas.inserir && escolhas.inserir[v.linha] === false) return;
    pacote.push({
      acao: 'inserir', linha: v.linha,
      nome: v.nome, nome_mae: v.nome_mae, cpf: v.cpf,
      data_admissao: v.data_admissao, data_nascimento: v.data_nascimento,
      email: v.email, telefone: v.telefone, unidade: v.unidade, situacao: v.situacao
    });
  });

  (conc.atualizar || []).forEach(function (v) {
    var campos = (v.diferencas || []).filter(function (d) {
      var e = escolhas.campos && escolhas.campos[v.linha];
      return e && e[d.campo] !== undefined ? e[d.campo] : d.marcado;
    }).map(function (d) { return d.campo; });
    if (!campos.length) return;

    var item = { acao: 'atualizar', id: v.existente.id, linha: v.linha, campos: campos };
    campos.forEach(function (c) { item[c] = v[c]; });
    item.nome = item.nome || v.nome;      // para a mensagem de erro do banco
    pacote.push(item);
  });

  return pacote;
}

function resumoImportacao(conc, resultadoBanco) {
  return {
    lidos: conc.total,
    aInserir: conc.inserir.length,
    aAtualizar: conc.atualizar.length,
    semMudanca: conc.semMudanca.length,
    duplicadosNoArquivo: conc.duplicadosNoArquivo.length,
    invalidos: conc.invalidos.length,
    exigemCorrecaoManual: conc.manual.length,
    inseridos: resultadoBanco ? resultadoBanco.inseridos : null,
    atualizados: resultadoBanco ? resultadoBanco.atualizados : null,
    recusadosPeloBanco: resultadoBanco ? resultadoBanco.recusados : null
  };
}

Core.CAMPOS_IMPORT = CAMPOS_IMPORT;
Core.APELIDOS = APELIDOS;
Core.normalizarCabecalho = normalizarCabecalho;
Core.pontuarCabecalho = pontuarCabecalho;
Core.mapearColunas = mapearColunas;
Core.acharCabecalho = acharCabecalho;
Core.detectarLayout = detectarLayout;
Core.lerTabular = lerTabular;
Core.lerDetalheFolha = lerDetalheFolha;
Core.lerRelatorioFolha = lerRelatorioFolha;
Core.lerPlanilha = lerPlanilha;
Core.unidadeDoRelatorio = unidadeDoRelatorio;
Core.validarRegistro = validarRegistro;
Core.CAMPOS_COMPARAR = CAMPOS_COMPARAR;
Core.conciliar = conciliar;
Core.montarPacote = montarPacote;
Core.resumoImportacao = resumoImportacao;


/* =================================================================
   11) NOTIFICAÇÕES

   Nada de fila gravada no banco: as pendências são CALCULADAS a partir
   do estado atual. Assim não existe notificação fantasma de algo que já
   foi resolvido, nem pendência que ficou sem notificação porque um job
   não rodou. O que o banco guarda é só o que o usuário fez com cada
   aviso — leu, adiou, resolveu — na tabela colab_notificacoes.
   ================================================================= */

var PRIORIDADES = { urgente: 0, alta: 1, media: 2, baixa: 3 };

var TIPOS_NOTIF = {
  p1_vence:       { titulo: 'Fim do 1º período de experiência', grupo: 'contrato' },
  p1_atrasada:    { titulo: 'Decisão do 1º período em atraso',  grupo: 'contrato' },
  renov_pendente: { titulo: 'Renovação aprovada mas não confirmada', grupo: 'contrato' },
  p2_vence:       { titulo: 'Fim do contrato de experiência',   grupo: 'contrato' },
  p2_atrasada:    { titulo: 'Decisão final em atraso',          grupo: 'contrato' },
  aniversario:    { titulo: 'Aniversário chegando',             grupo: 'aniversario' },
  msg_aniv:       { titulo: 'Mensagem de aniversário não enviada', grupo: 'aniversario' },
  folga_analise:  { titulo: 'Folga de aniversário sem análise', grupo: 'folga' },
  folga_agendar:  { titulo: 'Folga aprovada e ainda não agendada', grupo: 'folga' },
  cadastro:       { titulo: 'Telefone ou e-mail ausente ou inválido', grupo: 'cadastro' }
};

function chaveNotif(colabId, tipo, ref) {
  return colabId + '|' + tipo + '|' + (ref || '-');
}

function gerarNotificacoes(lista, cfg, hoje, estados, agoraISO) {
  cfg = cfg || {};
  var avisoAniv = cfg.dias_aviso_aniv === undefined ? 7 : +cfg.dias_aviso_aniv;
  var avisoP1 = cfg.dias_aviso_p1 === undefined ? 7 : +cfg.dias_aviso_p1;
  var avisoP2 = cfg.dias_aviso_p2 === undefined ? 7 : +cfg.dias_aviso_p2;
  var h = partes(hoje);
  var mapaEstado = {};
  (estados || []).forEach(function (e) {
    mapaEstado[chaveNotif(e.colaborador_id, e.tipo, e.referencia)] = e;
  });

  var out = [];
  function add(c, tipo, ref, prioridade, detalhe, prazo, extra) {
    var est = mapaEstado[chaveNotif(c.id, tipo, ref)] || {};
    var n = {
      id: chaveNotif(c.id, tipo, ref),
      colaborador_id: c.id, colaborador: c,
      tipo: tipo, referencia: ref || '-',
      grupo: TIPOS_NOTIF[tipo].grupo,
      titulo: TIPOS_NOTIF[tipo].titulo,
      detalhe: detalhe, prazo: prazo || null,
      prioridade: prioridade,
      lida: !!est.lida_em, lida_em: est.lida_em || null,
      adiada_para: est.adiada_para || null,
      resolvida: !!est.resolvida_em, resolvida_em: est.resolvida_em || null,
      resolucao: est.resolucao || null,
      usuario_estado: est.usuario_email || null
    };
    n.adiada = !!(n.adiada_para && (!agoraISO || n.adiada_para > agoraISO));
    if (extra) Object.keys(extra).forEach(function (k) { n[k] = extra[k]; });
    out.push(n);
  }

  (lista || []).forEach(function (c) {
    var res = contratoResumo(c, cfg, hoje);

    /* ---- contrato de experiência ---- */
    if (!res.encerrado && isoValido(c.data_admissao) && c.situacao !== 'Inativo') {
      if (res.status === 'p1_aguardando') {
        if (res.diasParaFimP1 < 0) {
          add(c, 'p1_atrasada', 'p1', 'urgente',
            'O 1º período terminou em ' + isoParaBr(res.fimP1) + ' (há ' +
            (-res.diasParaFimP1) + ' dia(s)) e ainda não há decisão registrada.', res.fimP1);
        } else {
          add(c, 'p1_vence', 'p1', res.diasParaFimP1 <= 2 ? 'urgente' : 'alta',
            'Termina em ' + isoParaBr(res.fimP1) + ' — ' +
            (res.diasParaFimP1 === 0 ? 'é hoje' : 'faltam ' + res.diasParaFimP1 + ' dia(s)') +
            '. Informe: aprovado para renovação, reprovado ou decisão pendente.', res.fimP1);
        }
      }
      if (res.status === 'renovacao_aprovada') {
        add(c, 'renov_pendente', 'p1', res.atrasado ? 'urgente' : 'alta',
          res.atrasado
            ? 'Aprovado no 1º período, que terminou em ' + isoParaBr(res.fimP1) +
              ', e a renovação segue sem confirmação. O 2º período não começou a contar.'
            : 'Aprovado no 1º período. Confirme a renovação para os 60 dias seguintes começarem a contar.',
          res.fimP1);
      }
      if (res.status === 'p2_aguardando') {
        if (res.diasParaFimP2 < 0) {
          add(c, 'p2_atrasada', 'p2', 'urgente',
            'O contrato de experiência terminou em ' + isoParaBr(res.fimP2) + ' (há ' +
            (-res.diasParaFimP2) + ' dia(s)) sem decisão final.', res.fimP2);
        } else {
          add(c, 'p2_vence', 'p2', res.diasParaFimP2 <= 2 ? 'urgente' : 'alta',
            '90º dia em ' + isoParaBr(res.fimP2) + ' — ' +
            (res.diasParaFimP2 === 0 ? 'é hoje' : 'faltam ' + res.diasParaFimP2 + ' dia(s)') +
            '. Informe: efetivar ou encerrar o contrato.', res.fimP2);
        }
      }
    }

    /* ---- aniversário, mensagem e folga (só para quem está ativo) ---- */
    if (c.situacao === 'Ativo' && isoValido(c.data_nascimento)) {
      var anivEste = aniversarioNoAno(c.data_nascimento, h.ano);
      var pn = partes(c.data_nascimento);
      var diasPara = difDias(hoje, anivEste);
      var ano = String(h.ano);

      if (diasPara >= 0 && diasPara <= avisoAniv) {
        add(c, 'aniversario', ano, diasPara <= 1 ? 'alta' : 'media',
          (diasPara === 0 ? 'É hoje!' : 'Em ' + diasPara + ' dia(s), em ' + isoParaBr(anivEste)) +
          (ehAniversarioAdiado(c.data_nascimento, h.ano)
            ? ' (nasceu em 29/02; neste ano considerado 28/02)' : '') +
          ' — faz ' + idadeQueFaz(c.data_nascimento, h.ano) + ' anos.', anivEste,
          { aniversario: anivEste });
      }

      // Mensagem: cobrada do dia do aniversário até o fim do mês dele.
      if (pn.mes === h.mes && diasPara <= 0 && !msgAnivEnviada(c, h.ano)) {
        add(c, 'msg_aniv', ano, 'alta',
          'Aniversário em ' + isoParaBr(anivEste) + ' e a mensagem ainda não foi registrada como enviada.',
          montaIso(h.ano, h.mes, diasNoMes(h.ano, h.mes)));
      }

      // Folga: cobrada durante todo o mês do aniversário.
      if (cfg.politica_folga_ativa !== false && pn.mes === h.mes) {
        var fimMes = montaIso(h.ano, h.mes, diasNoMes(h.ano, h.mes));
        var diasAteFimMes = difDias(hoje, fimMes);
        if (c.folga_ano !== h.ano ||
            ['nao_analisada','aguardando_aprovacao'].indexOf(c.folga_status) >= 0) {
          add(c, 'folga_analise', ano, diasAteFimMes <= 5 ? 'alta' : 'media',
            'Aniversariante de ' + MESES[h.mes - 1] + '. A folga de aniversário ainda não foi ' +
            (c.folga_status === 'aguardando_aprovacao' ? 'aprovada' : 'analisada') +
            ' — restam ' + diasAteFimMes + ' dia(s) na competência.', fimMes);
        } else if (c.folga_ano === h.ano && c.folga_status === 'aprovada' && !c.folga_data) {
          add(c, 'folga_agendar', ano, diasAteFimMes <= 5 ? 'urgente' : 'alta',
            'Folga aprovada e sem data. Precisa ser agendada dentro de ' + MESES[h.mes - 1] +
            ' — restam ' + diasAteFimMes + ' dia(s).', fimMes);
        }
      }
    }

    /* ---- cadastro ---- */
    if (c.situacao === 'Ativo') {
      var sc = situacaoCadastro(c);
      if (sc.contatoIncompleto) {
        var probs = sc.problemas.filter(function (p) {
          return p.campo === 'telefone' || p.campo === 'email';
        });
        var faltaTudo = probs.length >= 2;
        add(c, 'cadastro', '-', faltaTudo ? 'media' : 'baixa',
          probs.map(function (p) { return p.texto; }).join('. ') + '.', null,
          { problemas: probs });
      }
    }
  });

  out.sort(function (a, b) {
    if (a.resolvida !== b.resolvida) return a.resolvida ? 1 : -1;
    if (a.adiada !== b.adiada) return a.adiada ? 1 : -1;
    var p = PRIORIDADES[a.prioridade] - PRIORIDADES[b.prioridade];
    if (p) return p;
    if (a.prazo && b.prazo && a.prazo !== b.prazo) return a.prazo < b.prazo ? -1 : 1;
    return chaveNome(a.colaborador.nome).localeCompare(chaveNome(b.colaborador.nome));
  });
  return out;
}

function contarNotificacoes(notifs) {
  var c = { total: 0, urgente: 0, naoLidas: 0, porGrupo: {} };
  (notifs || []).forEach(function (n) {
    if (n.resolvida || n.adiada) return;
    c.total++;
    if (n.prioridade === 'urgente') c.urgente++;
    if (!n.lida) c.naoLidas++;
    c.porGrupo[n.grupo] = (c.porGrupo[n.grupo] || 0) + 1;
  });
  return c;
}

Core.PRIORIDADES = PRIORIDADES;
Core.TIPOS_NOTIF = TIPOS_NOTIF;
Core.chaveNotif = chaveNotif;
Core.gerarNotificacoes = gerarNotificacoes;
Core.contarNotificacoes = contarNotificacoes;


/* =================================================================
   12) FILTROS E PESQUISA
   ================================================================= */

/* Tudo em maiúscula e sem acento, inclusive o e-mail: o termo digitado
   passa pela mesma normalização, e assim procurar "as12contato" acha
   "AS12CONTATO@EXEMPLO.COM". */
function textoBusca(c) {
  return chaveNome([c.nome, cpfDigitos(c.cpf), String(c.cpf || ''),
                    String(c.telefone || ''), exibirTelefone(c.telefone),
                    c.email || '', c.unidade || ''].join(' '));
}

function filtrar(lista, f, cfg, hoje) {
  f = f || {};
  var termo = f.busca ? chaveNome(f.busca) : '';
  var termoDigitos = f.busca ? String(f.busca).replace(/\D/g, '') : '';

  return (lista || []).filter(function (c) {
    if (termo) {
      var alvo = textoBusca(c);
      var achou = alvo.indexOf(termo) >= 0 ||
                  (termoDigitos.length >= 3 && alvo.replace(/\D/g, '').indexOf(termoDigitos) >= 0);
      if (!achou) return false;
    }
    if (f.situacao && f.situacao !== 'todas' && c.situacao !== f.situacao) return false;
    if (f.unidade && f.unidade !== 'todas' && (c.unidade || '') !== f.unidade) return false;

    if (f.mesAniversario && f.mesAniversario !== 'todos') {
      var p = partes(c.data_nascimento);
      if (!p || p.mes !== +f.mesAniversario) return false;
    }

    var res = contratoResumo(c, cfg, hoje);
    if (f.etapaContrato && f.etapaContrato !== 'todas' && res.status !== f.etapaContrato) return false;

    if (f.venceEm) {
      var d = +f.venceEm;
      var alvoDias = res.status === 'p1_andamento' || res.status === 'p1_aguardando'
        ? res.diasParaFimP1 : res.diasParaFimP2;
      if (res.encerrado || alvoDias === null || alvoDias < 0 || alvoDias > d) return false;
    }
    if (f.decisaoPendente) {
      if (['p1_aguardando','renovacao_aprovada','p2_aguardando'].indexOf(res.status) < 0) return false;
    }
    if (f.decisaoAtrasada && !res.atrasado) return false;

    if (f.folga && f.folga !== 'todas') {
      if (f.folga === 'pendentes') {
        if (['nao_analisada','aguardando_aprovacao'].indexOf(c.folga_status) < 0) return false;
      } else if (f.folga === 'sem_data') {
        if (!(c.folga_status === 'aprovada' && !c.folga_data)) return false;
      } else if (c.folga_status !== f.folga) return false;
    }

    if (f.cadastroIncompleto) {
      if (!situacaoCadastro(c).contatoIncompleto) return false;
    }
    if (f.semTelefone && analisarTelefone(c.telefone).tipo !== 'vazio') return false;
    if (f.semEmail && String(c.email || '').trim()) return false;

    return true;
  });
}

function unidades(lista) {
  var set = {};
  (lista || []).forEach(function (c) { if (c.unidade) set[c.unidade] = true; });
  return Object.keys(set).sort();
}

Core.textoBusca = textoBusca;
Core.filtrar = filtrar;
Core.unidades = unidades;


/* =================================================================
   13) EXPORTAÇÃO
   Só monta o conteúdo. Quem confirma e quem registra em auditoria é a
   tela (colaboradores.js) chamando colab_registrar_exportacao().
   ================================================================= */

function linhasExportacao(lista, cfg, hoje, incluirSensivel) {
  var cab = ['Nome','CPF','Nome da mãe','Admissão','Nascimento','E-mail','Telefone',
             'Unidade','Situação','Status do contrato','Fim 1º período','Fim do contrato',
             'Folga (status)','Folga (data)','Mensagem de aniversário'];
  var linhas = (lista || []).map(function (c) {
    var r = contratoResumo(c, cfg, hoje);
    return [
      nomeApresentavel(c.nome),
      incluirSensivel ? cpfFormatado(c.cpf) : (c.cpf_mascarado || cpfMascarado(c.cpf)),
      incluirSensivel ? (c.nome_mae || '') : '(restrito)',
      isoParaBr(c.data_admissao), isoParaBr(c.data_nascimento),
      c.email || '', exibirTelefone(c.telefone),
      c.unidade || '', c.situacao || '',
      r.rotulo, isoParaBr(r.fimP1), isoParaBr(r.fimP2),
      (FOLGA_STATUS[c.folga_status] || {}).rotulo || c.folga_status || '',
      isoParaBr(c.folga_data),
      c.aniv_msg_em ? 'enviada em ' + String(c.aniv_msg_em).slice(0, 10) : 'não enviada'
    ];
  });
  return [cab].concat(linhas);
}

function paraCsv(linhas) {
  return linhas.map(function (l) {
    return l.map(function (v) {
      var s = v === null || v === undefined ? '' : String(v);
      return /[";\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    }).join(';');
  }).join('\r\n');
}

Core.linhasExportacao = linhasExportacao;
Core.paraCsv = paraCsv;


/* ================================================================= */
Core.versao = '1.0.0';

if (typeof module === 'object' && module.exports) module.exports = Core;
global.CoreColab = Core;

})(typeof globalThis !== 'undefined' ? globalThis : this);
