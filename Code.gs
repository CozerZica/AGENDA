/**
 * SISTEMA DE CONTROLE DE AGENDA, TAREFAS & CRM — MATEUS COZER
 * Backend Google Apps Script (API JSON protegida por PIN)
 *
 * COMO ATUALIZAR NO APPS SCRIPT:
 * 1. Abra a planilha "Controle de Agenda e Demandas" na conta cozermateus@gmail.com.
 * 2. Menu Extensões > Apps Script > substitua todo o conteúdo de Code.gs por este arquivo.
 * 3. Em Configurações do Projeto (engrenagem) > Propriedades do script:
 *    - Adicione a propriedade APP_PIN com o seu PIN pessoal secreto (ex: 6 dígitos).
 *    - (Opcional, Passo 4) Adicione GEMINI_API_KEY e TELEGRAM_BOT_TOKEN.
 * 4. Salve (Ctrl+S) > Implantar > Gerenciar implantações > lápis (Editar) > Nova versão > Implantar.
 */

const CONFIG = {
  // Segurança: defina APP_PIN em "Propriedades do script" no Apps Script.
  // Não coloque seu PIN real no GitHub público.
  DEFAULT_PIN: 'DEFINIR_APP_PIN_NAS_PROPRIEDADES',
  TIMEZONE: 'America/Sao_Paulo',
  SHEET_DEMANDAS: 'Demandas',
  SHEET_CRM: 'CRM',
  SHEET_AUDITORIA: 'Auditoria',
  FOLLOWUP_DAYS: 2,

  // Agendas configuradas em cozermateus@gmail.com
  CALENDARS: [
    { front: 'Particular', name: 'Pessoal Mateus',    id: 'cozermateus@gmail.com' },
    { front: 'Otimize',    name: 'Otimize',           id: '396082c2658d0ab8b2222adb27c39903b0619fb2f46fbdb6bbf6e8a4888bf606@group.calendar.google.com' },
    { front: 'SR',         name: 'SR Contabilidade',  id: '9407475f47d378d4f5ddb0162605a33bc6fd268839a74892cfa6cee951ac3728@group.calendar.google.com' },
    { front: 'Otimize',    name: 'Reunião Cliente',   id: '59213d80d5690a0b74e29e018aeeacbb197128f00d378423d92d662f6fcf5489@group.calendar.google.com' },
    { front: 'Otimize',    name: 'Otimize Workspace', id: 'contato@otimizenow.com.br' },
    { front: 'Feriado',    name: 'Feriados Brasil',   id: 'pt.brazilian#holiday@group.v.calendar.google.com', readonly: true }
    // Descomente e cole os IDs quando criar as 2 agendas novas (Passo 3):
    // { front: 'Sette',   name: 'Consultoria Sette',   id: 'ID_SETTE@group.calendar.google.com' },
    // { front: 'Reforma', name: 'Consultoria Reforma', id: 'ID_REFORMA@group.calendar.google.com' }
  ]
};

function doGet(e) {
  try {
    const p = (e && e.parameter) || {};
    if (!p.pin) {
      return json_({ ok: true, status: 'API Central Mateus online. Informe o PIN.' });
    }
    if (!validarPin_(p.pin)) return json_({ ok: false, error: 'PIN inválido.' });
    return json_({
      ok: true,
      cards: listarDemandas_(),
      leads: listarLeads_(),
      events: listarEventosPeriodo_(),
      audit: listarAuditoria_(50),
      updatedAt: fmtDateTime_(new Date())
    });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    if (!validarPin_(body.pin)) return json_({ ok: false, error: 'PIN inválido ou APP_PIN não configurado nas Propriedades do script.' });
    const a = body.action || 'quick_add';
    if (a === 'sync') {
      return json_({
        ok: true,
        cards: listarDemandas_(),
        leads: listarLeads_(),
        events: listarEventosPeriodo_(),
        audit: listarAuditoria_(50),
        updatedAt: fmtDateTime_(new Date())
      });
    }
    lock.waitLock(10000);
    let res;
    switch (a) {
      case 'quick_add':    res = capturaRapida_(body.text || '', body.origem || 'Web'); break;
      case 'add_task':     res = criarDemanda_(body.item || {}, body.origem || 'Web'); break;
      case 'update_task':  res = atualizarDemanda_(body.item || {}, body.origem || 'Web'); break;
      case 'cobrei_task':  res = cobreiDemanda_(body.id, body.origem || 'Web'); break;
      case 'delete_task':  res = excluirLinha_(CONFIG.SHEET_DEMANDAS, body.id, 'EXCLUIDO', body.origem || 'Web'); break;
      case 'add_lead':     res = criarLead_(body.item || {}, body.origem || 'Web'); break;
      case 'update_lead':  res = atualizarLead_(body.item || {}, body.origem || 'Web'); break;
      case 'cobrei_lead':  res = cobreiLead_(body.id, body.origem || 'Web'); break;
      case 'delete_lead':  res = excluirLinha_(CONFIG.SHEET_CRM, body.id, 'CRM EXCLUIDO', body.origem || 'Web'); break;
      case 'add_event':    res = criarEventoAgenda_(body.event || {}, body.origem || 'Web'); break;
      case 'move_event':   res = moverEventoAgenda_(body.event || {}, body.origem || 'Web'); break;
      case 'delete_event': res = excluirEventoAgenda_(body.event || {}, body.origem || 'Web'); break;
      default: return json_({ ok: false, error: 'Ação desconhecida: ' + a });
    }
    return json_({ ok: true, data: res });
  } catch (err) {
    return json_({ ok: false, error: err.message });
  } finally {
    try { lock.releaseLock(); } catch (_) {}
  }
}

// ===================== HELPERS =====================

function validarPin_(pin) {
  const expected = String(PropertiesService.getScriptProperties().getProperty('APP_PIN') || '').trim();
  if (!expected || expected === CONFIG.DEFAULT_PIN) return false;
  return String(pin || '').trim() === expected;
}

function safeCell_(val) {
  const s = String(val == null ? '' : val).trim();
  if (/^[=+\-@]/.test(s) && !/^-\d+(\.\d+)?$/.test(s)) return "'" + s;
  return s;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function sheet_(name) {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Aba não encontrada: ' + name);
  return sh;
}

function fmtDate_(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd'); }
function fmtDateTime_(d) { return Utilities.formatDate(d, CONFIG.TIMEZONE, 'yyyy-MM-dd HH:mm'); }

/**
 * Soma N dias úteis corretamente (pula sábados e domingos passo a passo).
 * Ex.: Sexta + 2 dias úteis = Terça (não Segunda).
 */
function addDiasUteis_(baseIso, dias) {
  const hoje = fmtDate_(new Date());
  const start = (baseIso && baseIso > hoje) ? baseIso : hoje;
  const parts = start.split('-').map(Number);
  const dt = new Date(parts[0], parts[1] - 1, parts[2], 12, 0, 0);
  let added = 0;
  const target = Math.max(1, Number(dias) || 1);
  while (added < target) {
    dt.setDate(dt.getDate() + 1);
    const dow = dt.getDay();
    if (dow !== 0 && dow !== 6) added++;
  }
  return fmtDate_(dt);
}

function parseJsonSafe_(s) {
  try { return JSON.parse(s || '[]'); } catch (_) { return []; }
}

function nextId_(sh, prefix) {
  const last = sh.getLastRow();
  let max = 0;
  if (last > 1) {
    sh.getRange(2, 1, last - 1, 1).getValues().forEach(r => {
      const m = String(r[0] || '').match(new RegExp(prefix + '-(\\d+)', 'i'));
      if (m) max = Math.max(max, parseInt(m[1], 10));
    });
  }
  return prefix + '-' + String(max + 1).padStart(3, '0');
}

function findRow_(sh, id) {
  const last = sh.getLastRow();
  if (last <= 1) return -1;
  const ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (let i = 0; i < ids.length; i++) {
    if (String(ids[i][0]).trim() === String(id).trim()) return i + 2;
  }
  return -1;
}

function log_(acao, idItem, titulo, frente, detalhes, origem) {
  sheet_(CONFIG.SHEET_AUDITORIA).appendRow([
    fmtDateTime_(new Date()), acao, idItem, titulo, frente, detalhes, origem || 'Web'
  ]);
}

function listarAuditoria_(limit) {
  const vals = sheet_(CONFIG.SHEET_AUDITORIA).getDataRange().getValues();
  if (vals.length <= 1) return [];
  return vals.slice(1).reverse().slice(0, limit || 50).map(r => ({
    at: r[0] instanceof Date ? fmtDateTime_(r[0]) : String(r[0] || ''),
    action: String(r[1] || ''),
    detail: `${r[2]} · ${r[3]} (${r[5]})`
  }));
}

// ===================== DEMANDAS (TAREFAS) =====================

function garantirColunaResponsavel_(sh) {
  if (sh.getLastColumn() < 16 || !sh.getRange(1, 16).getValue()) {
    sh.getRange(1, 16).setValue('Responsavel');
  }
}

function listarDemandas_() {
  const sh = sheet_(CONFIG.SHEET_DEMANDAS);
  const vals = sh.getDataRange().getValues();
  if (vals.length <= 1) return [];
  const out = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    if (!r[0] && !r[2]) continue;
    const status = String(r[7] || 'Pendente');
    let stage = String(r[13] || '').trim();
    if (!stage) stage = status === 'Concluído' ? 'done' : (String(r[4]) === 'Follow-up' ? 'waiting' : 'todo');
    const prioRaw = String(r[5] || '2');
    const prioNum = prioRaw.charAt(0).match(/[1-4]/) ? prioRaw.charAt(0) : '2';
    out.push({
      id: String(r[0]),
      createdAt: r[1] instanceof Date ? fmtDate_(r[1]) : String(r[1] || '').slice(0, 10),
      title: String(r[2] || ''),
      front: normalizarFrente_(r[3]),
      type: String(r[4] || 'Tarefa'),
      priority: prioNum,
      due: r[6] instanceof Date ? fmtDate_(r[6]) : String(r[6] || ''),
      stage: stage,
      cobrancas: Number(r[8] || 0),
      lastCharge: r[9] instanceof Date ? fmtDateTime_(r[9]) : String(r[9] || ''),
      contact: String(r[10] || ''),
      notes: String(r[12] || ''),
      assignee: String(r[15] || 'Comigo').trim() || 'Comigo',
      comments: parseJsonSafe_(r[14])
    });
  }
  return out;
}

function normalizarFrente_(f) {
  const s = String(f || '');
  if (s.indexOf('Sette') >= 0) return 'Sette';
  if (s.indexOf('Reforma') >= 0 || s.indexOf('Tiago') >= 0) return 'Reforma';
  if (s.indexOf('Otimize') >= 0) return 'Otimize';
  if (s === 'SR' || s.indexOf('SR ') >= 0 || s.indexOf('| SR') >= 0) return 'SR';
  return 'Particular';
}

function detectarFrenteEvento_(calFront, title) {
  if (calFront && calFront !== 'Particular') return calFront;
  const s = String(title || '');
  if (/\|\s*sr\b|\bsr\s+contab/i.test(s)) return 'SR';
  if (/\|\s*otimize\b|\botimize\b/i.test(s)) return 'Otimize';
  if (/\|\s*sette\b|\bsette\b/i.test(s)) return 'Sette';
  if (/\|\s*reforma\b|\breforma\b/i.test(s)) return 'Reforma';
  return calFront || 'Particular';
}

function prioLabel_(n) {
  const map = { '1': '1 - Prazo legal/multa', '2': '2 - Cliente/receita', '3': '3 - Crescimento', '4': '4 - Resto' };
  return map[String(n)] || '2 - Cliente/receita';
}

function criarDemanda_(item, origem) {
  const sh = sheet_(CONFIG.SHEET_DEMANDAS);
  garantirColunaResponsavel_(sh);
  const id = nextId_(sh, 'DEM');
  const assignee = String(item.assignee || 'Comigo').trim() || 'Comigo';
  const stage = item.stage || (item.type === 'Follow-up' || assignee !== 'Comigo' ? 'waiting' : 'inbox');
  const status = stage === 'done' ? 'Concluído' : 'Pendente';
  const comments = item.comments || [];
  sh.appendRow([
    id, fmtDateTime_(new Date()), safeCell_(item.title),
    item.front || 'Otimize', item.type || 'Tarefa', prioLabel_(item.priority),
    item.due || fmtDate_(new Date()), status, Number(item.cobrancas || 0), '',
    safeCell_(item.contact), origem, safeCell_(item.notes), stage,
    JSON.stringify(comments), safeCell_(assignee)
  ]);
  log_('CRIADO', id, item.title, item.front, `Etapa: ${stage} | Resp: ${assignee} | Venc: ${item.due}`, origem);
  return { id };
}

function atualizarDemanda_(item, origem) {
  const sh = sheet_(CONFIG.SHEET_DEMANDAS);
  garantirColunaResponsavel_(sh);
  const row = findRow_(sh, item.id);
  if (row < 0) throw new Error('Demanda não encontrada: ' + item.id);
  const status = item.stage === 'done' ? 'Concluído' : 'Pendente';
  sh.getRange(row, 3, 1, 6).setValues([[
    safeCell_(item.title), item.front, item.type || 'Tarefa', prioLabel_(item.priority), item.due, status
  ]]);
  sh.getRange(row, 11).setValue(safeCell_(item.contact));
  sh.getRange(row, 13).setValue(safeCell_(item.notes));
  sh.getRange(row, 14, 1, 3).setValues([[
    item.stage,
    JSON.stringify(item.comments || []),
    safeCell_(item.assignee || 'Comigo') || 'Comigo'
  ]]);
  log_('EDITADO', item.id, item.title, item.front, `Etapa: ${item.stage} | Resp: ${item.assignee || 'Comigo'} | Venc: ${item.due}`, origem);
  return { id: item.id };
}

function cobreiDemanda_(id, origem) {
  const sh = sheet_(CONFIG.SHEET_DEMANDAS);
  garantirColunaResponsavel_(sh);
  const row = findRow_(sh, id);
  if (row < 0) throw new Error('Demanda não encontrada: ' + id);
  const vals = sh.getRange(row, 1, 1, 16).getValues()[0];
  const qtd = Number(vals[8] || 0) + 1;
  const dueAtual = vals[6] instanceof Date ? fmtDate_(vals[6]) : String(vals[6] || '');
  const novoVenc = addDiasUteis_(dueAtual, CONFIG.FOLLOWUP_DAYS);
  const comments = parseJsonSafe_(vals[14]);
  comments.push({ at: fmtDateTime_(new Date()), text: `Cobrança #${qtd} registrada. Próxima em ${novoVenc}.` });
  sh.getRange(row, 7).setValue(novoVenc);
  sh.getRange(row, 9).setValue(qtd);
  sh.getRange(row, 10).setValue(fmtDateTime_(new Date()));
  sh.getRange(row, 14).setValue('waiting');
  sh.getRange(row, 15).setValue(JSON.stringify(comments));
  log_('COBREI', id, vals[2], vals[3], `Cobrança #${qtd} → ${novoVenc}`, origem);
  return { id, cobrancas: qtd, due: novoVenc };
}

// ===================== CRM (LEADS) =====================

function listarLeads_() {
  const vals = sheet_(CONFIG.SHEET_CRM).getDataRange().getValues();
  if (vals.length <= 1) return [];
  const out = [];
  for (let i = 1; i < vals.length; i++) {
    const r = vals[i];
    if (!r[0] && !r[2]) continue;
    out.push({
      id: String(r[0]),
      createdAt: r[1] instanceof Date ? fmtDate_(r[1]) : String(r[1] || '').slice(0, 10),
      name: String(r[2] || ''),
      contact: String(r[3] || ''),
      origin: String(r[4] || 'Indicação'),
      front: normalizarFrente_(r[5]),
      temp: String(r[6] || 'Morno'),
      stage: String(r[7] || 'novo'),
      value: Number(r[8] || 0),
      unit: String(r[9] || '/mês'),
      nextDate: r[10] instanceof Date ? fmtDate_(r[10]) : String(r[10] || ''),
      nextStep: String(r[11] || ''),
      cobrancas: Number(r[12] || 0),
      comments: parseJsonSafe_(r[13])
    });
  }
  return out;
}

function criarLead_(item, origem) {
  const sh = sheet_(CONFIG.SHEET_CRM);
  const id = nextId_(sh, 'CRM');
  const comments = item.comments || [];
  sh.appendRow([
    id, fmtDateTime_(new Date()), safeCell_(item.name),
    safeCell_(item.contact), item.origin || 'Indicação', item.front || 'Otimize',
    item.temp || 'Morno', item.stage || 'novo', Number(item.value || 0),
    item.unit || '/mês', item.nextDate || fmtDate_(new Date()),
    safeCell_(item.nextStep), Number(item.cobrancas || 0), JSON.stringify(comments)
  ]);
  log_('CRM CRIADO', id, item.name, item.front, `${item.origin} | ${item.temp} | ${item.stage}`, origem);
  return { id };
}

function atualizarLead_(item, origem) {
  const sh = sheet_(CONFIG.SHEET_CRM);
  const row = findRow_(sh, item.id);
  if (row < 0) throw new Error('Lead não encontrado: ' + item.id);
  sh.getRange(row, 3, 1, 12).setValues([[
    safeCell_(item.name), safeCell_(item.contact), item.origin || 'Indicação', item.front || 'Otimize',
    item.temp || 'Morno', item.stage || 'novo', Number(item.value || 0),
    item.unit || '/mês', item.nextDate || '', safeCell_(item.nextStep),
    Number(item.cobrancas || 0), JSON.stringify(item.comments || [])
  ]]);
  log_('CRM EDITADO', item.id, item.name, item.front, `Etapa: ${item.stage} | Temp: ${item.temp}`, origem);
  return { id: item.id };
}

function cobreiLead_(id, origem) {
  const sh = sheet_(CONFIG.SHEET_CRM);
  const row = findRow_(sh, id);
  if (row < 0) throw new Error('Lead não encontrado: ' + id);
  const vals = sh.getRange(row, 1, 1, 14).getValues()[0];
  const qtd = Number(vals[12] || 0) + 1;
  const atual = vals[10] instanceof Date ? fmtDate_(vals[10]) : String(vals[10] || '');
  const novo = addDiasUteis_(atual, CONFIG.FOLLOWUP_DAYS);
  const comments = parseJsonSafe_(vals[13]);
  comments.push({ at: fmtDateTime_(new Date()), text: `Follow-up comercial #${qtd}. Próximo em ${novo}.` });
  sh.getRange(row, 11).setValue(novo);
  sh.getRange(row, 13).setValue(qtd);
  sh.getRange(row, 14).setValue(JSON.stringify(comments));
  log_('CRM COBREI', id, vals[2], vals[5], `Follow-up #${qtd} → ${novo}`, origem);
  return { id, cobrancas: qtd, nextDate: novo };
}

function excluirLinha_(sheetName, id, acao, origem) {
  const sh = sheet_(sheetName);
  const row = findRow_(sh, id);
  if (row < 0) throw new Error('Item não encontrado: ' + id);
  const vals = sh.getRange(row, 1, 1, 6).getValues()[0];
  log_(acao, id, vals[2], vals[3] || vals[5], 'Removido pelo usuário', origem);
  sh.deleteRow(row);
  return { id, deleted: true };
}

// ===================== GOOGLE AGENDA (4 SEMANAS: -7 a +21 DIAS) =====================

function listarEventosPeriodo_() {
  const hoje = new Date();
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - 7, 0, 0, 0);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 21, 23, 59, 59);

  const out = [];
  CONFIG.CALENDARS.forEach(c => {
    if (!c.id || c.id.indexOf('ID_') === 0) return;
    try {
      const cal = CalendarApp.getCalendarById(c.id);
      if (!cal) return;
      cal.getEvents(ini, fim).forEach(ev => {
        const isAllDay = ev.isAllDayEvent();
        const start = ev.getStartTime();
        const end = ev.getEndTime();
        const startMin = isAllDay ? 0 : (start.getHours() * 60 + start.getMinutes());
        let endMin = isAllDay ? 1440 : (end.getHours() * 60 + end.getMinutes());
        if (!isAllDay && endMin <= startMin) endMin = startMin + 60;
        out.push({
          id: ev.getId(),
          calendarId: c.id,
          calendarName: c.name,
          readonly: Boolean(c.readonly),
          date: fmtDate_(start),
          hour: start.getHours(),
          startMin: startMin,
          endMin: endMin,
          allDay: isAllDay,
          title: ev.getTitle(),
          description: ev.getDescription() || '',
          location: ev.getLocation() || '',
          front: detectarFrenteEvento_(c.front, ev.getTitle())
        });
      });
    } catch (_) {}
  });
  return out;
}

function criarEventoAgenda_(ev, origem) {
  const calCfg = CONFIG.CALENDARS.find(c => !c.readonly && c.front === ev.front) || CONFIG.CALENDARS[0];
  const cal = CalendarApp.getCalendarById(calCfg.id);
  if (!cal) throw new Error('Agenda não encontrada para frente: ' + ev.front);
  const p = String(ev.date).split('-').map(Number);
  const startMin = ev.startMin != null ? Number(ev.startMin) : (Number(ev.hour || 9) * 60);
  const durationMin = Math.max(15, Number(ev.durationMin || 60));
  const ini = new Date(p[0], p[1] - 1, p[2], Math.floor(startMin / 60), startMin % 60, 0);
  const fim = new Date(ini.getTime() + durationMin * 60 * 1000);
  const created = cal.createEvent(String(ev.title || 'Reunião'), ini, fim, {
    description: String(ev.description || '')
  });
  log_('AGENDADO', 'CAL', ev.title, ev.front, `${ev.date} ${Math.floor(startMin / 60)}:${String(startMin % 60).padStart(2, '0')} (${durationMin}min)`, origem);
  return { ok: true, id: created.getId() };
}

function validarAgendaGravavel_(calendarId) {
  const cfg = CONFIG.CALENDARS.find(c => c.id === calendarId);
  if (!cfg || cfg.readonly) throw new Error('Agenda não autorizada para alteração.');
  return cfg;
}

function moverEventoAgenda_(ev, origem) {
  if (!ev.id || !ev.calendarId || !ev.date) throw new Error('Dados do evento incompletos para remarcar.');
  validarAgendaGravavel_(ev.calendarId);
  const cal = CalendarApp.getCalendarById(ev.calendarId);
  if (!cal) throw new Error('Agenda não encontrada.');
  const target = cal.getEventById(ev.id);
  if (!target) throw new Error('Compromisso não encontrado na agenda.');
  const origDurMs = Math.max(15 * 60 * 1000, target.getEndTime().getTime() - target.getStartTime().getTime());
  const durMs = ev.durationMin ? Math.max(15, Number(ev.durationMin)) * 60 * 1000 : origDurMs;
  const p = String(ev.date).split('-').map(Number);
  const startMin = ev.startMin != null ? Number(ev.startMin) : (Number(ev.hour || 9) * 60);
  const ini = new Date(p[0], p[1] - 1, p[2], Math.floor(startMin / 60), startMin % 60, 0);
  const fim = new Date(ini.getTime() + durMs);
  target.setTime(ini, fim);
  log_('AGENDA REMARCADO', 'CAL', target.getTitle(), ev.front || 'Particular', `${ev.date} às ${Math.floor(startMin / 60)}:${String(startMin % 60).padStart(2, '0')}`, origem);
  return { ok: true, id: ev.id, date: ev.date, startMin };
}

function excluirEventoAgenda_(ev, origem) {
  if (!ev.id || !ev.calendarId) throw new Error('Dados do evento incompletos para exclusão.');
  validarAgendaGravavel_(ev.calendarId);
  const cal = CalendarApp.getCalendarById(ev.calendarId);
  if (!cal) throw new Error('Agenda não encontrada.');
  const target = cal.getEventById(ev.id);
  if (!target) throw new Error('Compromisso não encontrado na agenda.');
  const title = target.getTitle();
  target.deleteEvent();
  log_('AGENDA EXCLUIDO', 'CAL', title, ev.front || 'Particular', `${ev.date || ''}`, origem);
  return { ok: true, deleted: true };
}

// ===================== CAPTURA RÁPIDA (WEB / IPHONE / VOZ) =====================

function detectarDataTexto_(low) {
  const hoje = new Date();
  if (/\bamanh[aã]\b/.test(low)) {
    hoje.setDate(hoje.getDate() + 1);
    return fmtDate_(hoje);
  }
  const diasMap = [
    { re: /\bdomingo\b/, dow: 0 },
    { re: /\bsegunda\b/, dow: 1 },
    { re: /\bter[cç]a\b/, dow: 2 },
    { re: /\bquarta\b/, dow: 3 },
    { re: /\bquinta\b/, dow: 4 },
    { re: /\bsexta\b/, dow: 5 },
    { re: /\bs[aá]bado\b/, dow: 6 }
  ];
  for (let i = 0; i < diasMap.length; i++) {
    if (diasMap[i].re.test(low)) {
      let diff = (diasMap[i].dow - hoje.getDay() + 7) % 7;
      if (diff === 0) diff = 7;
      hoje.setDate(hoje.getDate() + diff);
      return fmtDate_(hoje);
    }
  }
  return fmtDate_(hoje);
}

function detectarResponsavelTexto_(low) {
  const equipe = [
    { re: /\bkaren\b/, name: 'Karen' },
    { re: /\bnicolas\b/, name: 'Nicolas' },
    { re: /\btiago\b/, name: 'Tiago' },
    { re: /\belizandra\b/, name: 'Elizandra' },
    { re: /\bkalleo\b/, name: 'Kalleo' },
    { re: /\banilton\b/, name: 'Anilton' },
    { re: /\bgraciele\b/, name: 'Graciele' },
    { re: /\bcliente\b/, name: 'Cliente' }
  ];
  for (let i = 0; i < equipe.length; i++) {
    if (equipe[i].re.test(low)) return equipe[i].name;
  }
  return 'Comigo';
}

function capturaRapida_(texto, origem) {
  const low = texto.toLowerCase();
  let front = 'Otimize';
  if (/\b(sr|karen|elizandra|kalleo|anilton|graciele|societ|fiscal|dp|rafael)\b/.test(low)) front = 'SR';
  else if (/\b(sette|exterior|cripto|sa[ií]da)\b/.test(low)) front = 'Sette';
  else if (/\b(tiago|reforma)\b/.test(low)) front = 'Reforma';
  else if (/\b(pessoal|particular|m[eé]dico|casa|fam[ií]lia|cabelo)\b/.test(low)) front = 'Particular';

  const due = detectarDataTexto_(low);

  // Se mencionar hora explícita + reunião/marcar/agendar (ex: "marcar reunião Rafael SR hoje 11h")
  const horaMatch = low.match(/\b([01]?\d|2[0-3])\s*(?:h|:(\d{2}))\b/);
  if (horaMatch && /\b(reuni[aã]o|marcar|agendar|alinhamento|call)\b/.test(low)) {
    const hh = parseInt(horaMatch[1], 10);
    const mm = horaMatch[2] ? parseInt(horaMatch[2], 10) : 0;
    return criarEventoAgenda_({
      date: due,
      startMin: hh * 60 + mm,
      durationMin: 60,
      title: texto.charAt(0).toUpperCase() + texto.slice(1),
      front
    }, origem);
  }

  if (/\b(lead|proposta|or[cç]amento|prospect)\b/.test(low)) {
    return criarLead_({
      name: texto.replace(/\b(lead|novo lead)\b/i, '').trim() || texto,
      contact: origem,
      origin: /\bindica[cç][aã]o\b/.test(low) ? 'Indicação' : (/\binsta\b/.test(low) ? 'Instagram' : 'WhatsApp'),
      front: front === 'Particular' ? 'Otimize' : front,
      temp: /\bquente\b/.test(low) ? 'Quente' : (/\bfrio\b/.test(low) ? 'Frio' : 'Morno'),
      stage: /\bproposta\b/.test(low) ? 'proposta' : 'novo',
      value: 0, unit: '/mês', nextDate: due, nextStep: 'Qualificar lead'
    }, origem);
  }

  let type = 'Tarefa';
  if (/\b(cobrar|follow|retorno)\b/.test(low)) type = 'Follow-up';
  else if (/\b(reuni[aã]o|marcar|agendar)\b/.test(low)) type = 'Marcar reunião';
  else if (/\b(prazo|entregar|darf|das|guia|multa)\b/.test(low)) type = 'Entrega/prazo';

  const assignee = detectarResponsavelTexto_(low);

  return criarDemanda_({
    title: texto.charAt(0).toUpperCase() + texto.slice(1),
    front, type, assignee,
    priority: /\b(multa|urgente|hoje|prazo)\b/.test(low) ? '1' : '2',
    due,
    stage: (type === 'Follow-up' || assignee !== 'Comigo') ? 'waiting' : 'inbox'
  }, origem);
}
