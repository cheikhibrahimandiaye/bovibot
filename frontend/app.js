/* ============================================================
   BOVIBOT — Frontend App
   API FastAPI :8002 · Ollama · Skill llm-agent-flow
   ============================================================ */

'use strict';

// ─── CONFIG ─────────────────────────────────────────────────────
const API = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
  ? 'http://localhost:8002'
  : window.location.origin;
const SESSION_ID = 'session-' + Math.random().toString(36).slice(2, 10);
const POLL_INTERVAL = 30_000; // 30s pour les alertes

// ─── STATE ──────────────────────────────────────────────────────
const state = {
  currentPage:    'dashboard',
  pendingAction:  false,
  modalResolve:   null,
  alertsCount:    0,
  animauxData:    [],
  filterStatut:   'actif',
};

// ═══════════════════════════════════════════════════════════════
// NAVIGATION
// ═══════════════════════════════════════════════════════════════

function navigateTo(pageId) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(n => n.classList.remove('active'));

  const page = document.getElementById(`page-${pageId}`);
  if (!page) return;
  page.classList.add('active');

  const navBtn = document.querySelector(`[data-page="${pageId}"]`);
  if (navBtn) navBtn.classList.add('active');

  state.currentPage = pageId;
  const headingEl = document.getElementById('page-heading');
  if (headingEl) headingEl.textContent =
    { dashboard: 'Dashboard', troupeau: 'Troupeau', sante: 'Santé', ventes: 'Ventes', chat: 'Chat IA' }[pageId] || pageId;

  if (pageId === 'dashboard') loadDashboard();
  if (pageId === 'troupeau')  loadTroupeau();
  if (pageId === 'sante')     loadSante();
  if (pageId === 'ventes')    loadVentes();
  if (pageId === 'chat')      focusChatInput();
}

// ═══════════════════════════════════════════════════════════════
// API HELPERS
// ═══════════════════════════════════════════════════════════════

async function apiFetch(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: `HTTP ${res.status}` }));
    throw new Error(err.detail || `Erreur ${res.status}`);
  }
  return res.json();
}

async function checkApiHealth() {
  const pill = document.getElementById('api-status');
  const txt  = pill.querySelector('.api-label');
  try {
    await apiFetch('/health');
    pill.classList.add('connected');
    pill.classList.remove('error');
    txt.textContent = 'API connectée';
  } catch {
    pill.classList.add('error');
    pill.classList.remove('connected');
    txt.textContent = 'API hors ligne';
  }
}

// ═══════════════════════════════════════════════════════════════
// DASHBOARD
// ═══════════════════════════════════════════════════════════════

async function loadDashboard() {
  await Promise.all([loadStats(), loadAnimauxStats(), loadAlertsFeed()]);
  startAlertPolling();
}

async function loadStats() {
  try {
    const s = await apiFetch('/stats');
    animateValue('stat-actifs',   s.total_actifs   ?? 0);
    animateValue('stat-gmq',      s.gmq_moyen      ?? 0, true);
    animateValue('stat-velages',  s.velages_7jours ?? 0);
    animateValue('stat-alertes',  s.alertes_critiques ?? 0);

    const totalEl = document.getElementById('stat-total');
    if (totalEl) totalEl.textContent = s.total_animaux ?? '--';
    const alertesTotalEl = document.getElementById('stat-alertes-total');
    if (alertesTotalEl) alertesTotalEl.textContent = s.alertes_total ?? '--';
    const bentoAge = document.getElementById('bento-age');
    if (bentoAge) bentoAge.textContent = s.age_moyen ?? '--';

    const critiques = s.alertes_critiques ?? 0;
    const bellBadge = document.getElementById('bell-badge');
    if (bellBadge) {
      bellBadge.textContent = critiques;
      bellBadge.style.display = critiques > 0 ? 'flex' : 'none';
    }
    state.alertsCount = critiques;

    animateValue('stat-repro', s.velages_7jours ?? 0);
    const velageNext = document.getElementById('velage-next');
    if (velageNext) velageNext.textContent =
      s.velages_7jours > 0 ? `${s.velages_7jours} vêlage(s) dans 7 jours` : 'Aucun vêlage imminent';
    const troupeauCount = document.getElementById('troupeau-count');
    if (troupeauCount) troupeauCount.textContent = `${s.total_actifs ?? '--'} animaux actifs`;
  } catch (err) {
    console.error('loadStats:', err);
    showToast('Erreur statistiques', 'Impossible de charger les métriques.', 'critique');
  }
}

async function loadAnimauxStats() {
  try {
    const animaux = await apiFetch('/stats/animaux?statut=actif');
    state.animauxData = animaux;
    renderGmqChart(animaux);
    renderTroupeauMini(animaux.slice(0, 6));
  } catch (err) {
    console.error('loadAnimauxStats:', err);
  }
}

async function loadAlertsFeed() {
  const feed = document.getElementById('alert-feed');
  try {
    const { alertes } = await apiFetch('/alertes?non_traitees_seulement=true&limit=15');
    if (!alertes.length) {
      feed.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-2);font-size:.8rem;">Aucune alerte non traitée</div>';
      return;
    }
    feed.innerHTML = '';
    alertes.forEach((a, i) => {
      const el = buildAlertRow(a, i);
      feed.appendChild(el);
    });
    alertes.filter(a => a.niveau === 'critique').slice(0, 2).forEach(a => {
      const age = (Date.now() - new Date(a.created_at).getTime()) / 60000;
      if (age < 5) showToast('Alerte critique', a.message.slice(0, 80) + '…', 'critique');
    });
  } catch (err) {
    feed.innerHTML = '<div style="text-align:center;padding:24px;color:var(--text-2);font-size:.8rem;">Erreur de chargement</div>';
  }
}

function buildAlertRow(a, i) {
  const el = document.createElement('div');
  el.className = `alert-row ${a.niveau}`;
  el.style.animationDelay = `${i * 60}ms`;
  const lvlLabels = { critique: 'Critique', avertissement: 'Avertissement', info: 'Info' };
  el.innerHTML = `
    <div class="alert-row-top">
      <span class="alert-badge">${lvlLabels[a.niveau] || a.niveau}</span>
      <div class="alert-msg">${escHtml(a.message)}</div>
    </div>
    <div class="alert-row-bottom">
      <span class="alert-time">${formatDate(a.created_at)}</span>
      <button class="alert-mark-btn" data-id="${a.id}">Traiter</button>
    </div>
  `;
  el.querySelector('.alert-mark-btn').addEventListener('click', async (e) => {
    e.stopPropagation();
    await markAlertTreated(a.id);
    el.style.opacity = '0';
    el.style.transform = 'translateX(14px)';
    el.style.transition = 'opacity .2s, transform .2s';
    setTimeout(() => el.remove(), 200);
  });
  return el;
}

async function markAlertTreated(id) {
  try {
    await apiFetch(`/alertes/${id}/traiter`, { method: 'PATCH' });
    await loadStats();
  } catch (err) {
    showToast('Erreur', `Impossible de traiter l'alerte ${id}.`, 'critique');
  }
}

let pollTimer = null;
function startAlertPolling() {
  clearInterval(pollTimer);
  pollTimer = setInterval(async () => {
    const prev = state.alertsCount;
    await loadStats();
    await loadAlertsFeed();
    if (state.alertsCount > prev) {
      showToast('Nouvelles alertes', `${state.alertsCount - prev} nouvelle(s) alerte(s) critique(s).`, 'avertissement');
    }
  }, POLL_INTERVAL);
}

// ─── GMQ Chart ──────────────────────────────────────────────────

function renderGmqChart(animaux) {
  const chart = document.getElementById('gmq-chart');
  if (!animaux.length) {
    chart.innerHTML = '<div style="width:100%;display:flex;align-items:center;justify-content:color:var(--text-2);font-size:.8rem;">Aucune donnée</div>';
    return;
  }
  const MAX_H  = 185;
  const maxGmq = Math.max(...animaux.map(a => a.gmq || 0), 0.01);
  const avgGmq = animaux.reduce((s, a) => s + (a.gmq || 0), 0) / animaux.length;
  chart.innerHTML = '';

  // ── Grid background ──────────────────────────────────────────
  const gridBg = document.createElement('div');
  gridBg.className = 'chart-grid-bg';

  [0.33, 0.66, 1.0].forEach(pct => {
    const line = document.createElement('div');
    line.className = 'chart-grid-line';
    line.style.bottom = Math.round(pct * MAX_H) + 'px';
    const lbl = document.createElement('span');
    lbl.className = 'chart-y-lbl';
    lbl.textContent = (pct * maxGmq).toFixed(2);
    line.appendChild(lbl);
    gridBg.appendChild(line);
  });

  // ── Average line ─────────────────────────────────────────────
  const avgLine = document.createElement('div');
  avgLine.className = 'chart-avg-line';
  avgLine.style.bottom = Math.round((avgGmq / maxGmq) * MAX_H) + 'px';
  const avgTag = document.createElement('span');
  avgTag.className = 'chart-avg-tag';
  avgTag.textContent = '⌀ ' + avgGmq.toFixed(2);
  avgLine.appendChild(avgTag);
  gridBg.appendChild(avgLine);
  chart.appendChild(gridBg);

  // ── Bars ─────────────────────────────────────────────────────
  animaux.forEach((a, i) => {
    const gmq = a.gmq || 0;
    const h   = Math.max((gmq / maxGmq) * MAX_H, gmq > 0 ? 14 : 4);
    const cls = gmq >= 0.5 ? '' : gmq >= 0.3 ? 'warn' : 'crit';

    const group = document.createElement('div');
    group.className = 'bar-group';
    group.style.setProperty('--bi', i);
    group.innerHTML = `
      <div class="bar-val">${gmq > 0 ? gmq.toFixed(2) : '—'}</div>
      <div class="bar-fill ${cls}" style="height:${h}px"
           title="${escHtml(a.numero_tag)} · ${escHtml(a.nom || '')} · ${gmq} kg/j"></div>
      <div class="bar-lbl">${escHtml(a.numero_tag)}</div>
    `;
    chart.appendChild(group);
  });
}

// ─── Troupeau mini ──────────────────────────────────────────────

function renderTroupeauMini(animaux) {
  const container = document.getElementById('troupeau-mini');
  container.innerHTML = '';
  animaux.forEach((a, i) => {
    const gmq = a.gmq || 0;
    const cls = gmq >= 0.5 ? 'g' : gmq >= 0.3 ? 'w' : 'r';
    const row = document.createElement('div');
    row.className = 'mini-row';
    row.style.setProperty('--ti', i);
    row.innerHTML = `
      <span class="mini-tag">${escHtml(a.numero_tag)}</span>
      <span class="mini-name">${escHtml(a.nom || 'Sans nom')}</span>
      <span class="mini-gmq ${cls}">${gmq > 0 ? gmq.toFixed(2) + ' kg/j' : '—'}</span>
    `;
    container.appendChild(row);
  });
}

// ═══════════════════════════════════════════════════════════════
// TROUPEAU PAGE
// ═══════════════════════════════════════════════════════════════

async function loadTroupeau() {
  const tbody = document.getElementById('troupeau-tbody');
  tbody.innerHTML = `
    <tr><td colspan="9"><div class="skel-row"></div></td></tr>
    <tr><td colspan="9"><div class="skel-row" style="--d:.1s"></div></td></tr>
    <tr><td colspan="9"><div class="skel-row" style="--d:.2s"></div></td></tr>
  `;
  try {
    const all = await apiFetch('/stats/animaux');
    state.animauxData = all;
    renderTroupeauTable(all);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-2)">Erreur de chargement</td></tr>`;
  }
}


function renderTroupeauTable(animaux) {
  const tbody = document.getElementById('troupeau-tbody');
  const search = (document.getElementById('troupeau-search').value || '').toLowerCase();
  const filtre = state.filterStatut;

  const filtered = animaux.filter(a => {
    const matchFilter = !filtre || a.statut === filtre;
    const matchSearch = !search || a.numero_tag.toLowerCase().includes(search) || (a.nom || '').toLowerCase().includes(search);
    return matchFilter && matchSearch;
  });

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:24px;color:var(--text-2)">Aucun animal trouvé</td></tr>`;
    return;
  }

  tbody.innerHTML = '';
  filtered.forEach(a => {
    const gmq    = a.gmq || 0;
    const gmqCls = gmq >= 0.5 ? 'good' : gmq >= 0.3 ? 'warn' : 'poor';
    const tr     = document.createElement('tr');
    tr.innerHTML = `
      <td class="tag-cell">${escHtml(a.numero_tag)}</td>
      <td>${escHtml(a.nom || '—')}</td>
      <td>${escHtml(a.race || '—')}</td>
      <td>${a.sexe === 'M' ? '♂' : '♀'}</td>
      <td><span style="font-family:'JetBrains Mono',monospace">${a.age_mois ?? '—'} mois</span></td>
      <td><span style="font-family:'JetBrains Mono',monospace">${a.poids_actuel_kg ?? '—'} kg</span></td>
      <td><span class="gmq-cell ${gmqCls}">${gmq > 0 ? gmq.toFixed(3) : '—'}</span></td>
      <td><span class="status-badge ${a.statut}">${a.statut}</span></td>
      <td>
        ${a.statut === 'actif' ? `
          <button class="action-btn-pesee" data-tag="${escHtml(a.numero_tag)}" data-nom="${escHtml(a.nom||'')}">⚖ Peser</button>
          <button class="action-btn-vente" data-tag="${escHtml(a.numero_tag)}" data-nom="${escHtml(a.nom||'')}" data-poids="${a.poids_actuel_kg ?? ''}">💰 Vendre</button>
        ` : '—'}
      </td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll('.action-btn-pesee').forEach(btn => {
    btn.addEventListener('click', () => {
      const tag = btn.dataset.tag;
      const nom = btn.dataset.nom;
      const poids = prompt(`Pesée rapide — ${tag} (${nom || 'Sans nom'})\nPoids en kg :`, '');
      if (!poids || isNaN(poids)) return;
      startQuickPesee(tag, parseFloat(poids));
    });
  });

  tbody.querySelectorAll('.action-btn-vente').forEach(btn => {
    btn.addEventListener('click', () => startQuickVente(btn.dataset.tag, btn.dataset.nom, btn.dataset.poids ? parseFloat(btn.dataset.poids) : null));
  });
}

async function startQuickPesee(tag, poids) {
  const today = new Date().toISOString().split('T')[0];
  const msg = `  Animal : ${tag}\n  Poids  : ${poids} kg\n  Date   : ${today}`;
  const confirmed = await showModal('Confirmer la pesée', msg);
  if (!confirmed) return;

  try {
    const res = await apiFetch('/pesees', {
      method: 'POST',
      body: JSON.stringify({ numero_tag: tag, poids_kg: poids, date_pesee: today }),
    });
    showToast('Pesée enregistrée', res.message || `${poids} kg pour ${tag}`, 'info');
    loadStats();
    loadAnimauxStats();
    if (state.currentPage === 'troupeau') loadTroupeau();
  } catch (err) {
    showToast('Erreur pesée', err.message, 'critique');
  }
}

async function startQuickVente(tag, nom, poidsActuel) {
  const acheteur = prompt(`Vente — ${tag} (${nom || 'Sans nom'})\nNom de l'acheteur :`, '');
  if (!acheteur || !acheteur.trim()) return;
  const telStr = prompt('Téléphone de l\'acheteur (optionnel, Entrée pour ignorer) :', '');
  const telephone = telStr && telStr.trim() ? telStr.trim() : null;
  const prixStr = prompt('Prix de vente (en FCFA) :', '');
  if (!prixStr || isNaN(prixStr)) return;
  const prix = parseFloat(prixStr);
  const today = new Date().toISOString().split('T')[0];

  const msg = `  Animal   : ${tag} / ${nom || 'Sans nom'}\n  Acheteur : ${acheteur.trim()}\n  Tél.     : ${telephone || 'Non renseigné'}\n  Prix     : ${Math.round(prix).toLocaleString('fr-FR')} FCFA\n  Poids    : ${poidsActuel ? poidsActuel + ' kg' : 'Non renseigné'}\n  Date     : ${today}`;
  const confirmed = await showModal('Confirmer la vente', msg);
  if (!confirmed) return;

  try {
    const res = await apiFetch('/ventes', {
      method: 'POST',
      body: JSON.stringify({
        numero_tag: tag,
        acheteur: acheteur.trim(),
        telephone: telephone,
        prix_fcfa: prix,
        poids_vente_kg: poidsActuel ?? null,
      }),
    });
    showToast('Vente enregistrée', res.message || `${tag} vendu à ${acheteur.trim()}`, 'info');
    loadStats();
    loadAnimauxStats();
    await loadVentes();
    navigateTo('ventes');
  } catch (err) {
    showToast('Erreur vente', err.message, 'critique');
  }
}

// ═══════════════════════════════════════════════════════════════
// PAGE SANTÉ
// ═══════════════════════════════════════════════════════════════

let _santeData = [];

async function loadSante() {
  // Charger les stats KPI
  try {
    const stats = await apiFetch('/sante/stats');
    const el = id => document.getElementById(id);
    if (el('sante-total'))        el('sante-total').textContent        = stats.total_actes ?? '--';
    if (el('sante-rdv-depasses')) el('sante-rdv-depasses').textContent = stats.rdv_depasses ?? '--';
    if (el('sante-rdv-prochains'))el('sante-rdv-prochains').textContent= stats.rdv_prochains_30j ?? '--';
    if (el('sante-animaux-suivis'))el('sante-animaux-suivis').textContent = stats.animaux_suivis ?? '--';
  } catch (err) { console.error('sante/stats:', err); }

  // Charger le tableau
  const tbody = document.getElementById('sante-tbody');
  if (!tbody) return;
  tbody.innerHTML = `
    <tr><td colspan="6"><div class="skel-row"></div></td></tr>
    <tr><td colspan="6"><div class="skel-row" style="--d:.1s"></div></td></tr>
    <tr><td colspan="6"><div class="skel-row" style="--d:.2s"></div></td></tr>
  `;
  try {
    _santeData = await apiFetch('/sante?limit=100');
    renderSanteTable(_santeData);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-2)">Erreur de chargement</td></tr>`;
  }
}

function renderSanteTable(data) {
  const tbody = document.getElementById('sante-tbody');
  const search = (document.getElementById('sante-search')?.value || '').toLowerCase();
  const filtered = search
    ? data.filter(r => r.numero_tag.toLowerCase().includes(search) || r.type_acte.toLowerCase().includes(search) || (r.nom_animal || '').toLowerCase().includes(search))
    : data;

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;padding:24px;color:var(--text-2)">Aucun acte trouvé</td></tr>`;
    return;
  }
  tbody.innerHTML = '';
  filtered.forEach(r => {
    let rdvHtml = `<span class="rdv-empty">—</span>`;
    if (r.prochain_rdv) {
      rdvHtml = r.rdv_depasse
        ? `<span class="rdv-depasse">⚠ ${r.prochain_rdv}</span>`
        : `<span class="rdv-ok">✓ ${r.prochain_rdv}</span>`;
    }
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="tag-cell">${escHtml(r.numero_tag)}</td>
      <td>${escHtml(r.nom_animal)}</td>
      <td><span class="acte-badge">${escHtml(r.type_acte)}</span></td>
      <td style="font-family:'JetBrains Mono',monospace;font-size:.72rem">${r.date_acte}</td>
      <td>${escHtml(r.veterinaire)}</td>
      <td>${rdvHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

// ═══════════════════════════════════════════════════════════════
// PAGE VENTES
// ═══════════════════════════════════════════════════════════════

async function loadVentes() {
  // Charger les stats KPI
  try {
    const stats = await apiFetch('/ventes/stats');
    const el = id => document.getElementById(id);
    if (el('ventes-total'))    el('ventes-total').textContent    = stats.total_ventes ?? '--';
    if (el('ventes-revenu'))   el('ventes-revenu').textContent   = stats.revenu_total ? Math.round(stats.revenu_total).toLocaleString('fr-FR') : '--';
    if (el('ventes-prix-moy')) el('ventes-prix-moy').textContent = stats.prix_moyen   ? Math.round(stats.prix_moyen).toLocaleString('fr-FR')   : '--';
    if (el('ventes-poids-moy'))el('ventes-poids-moy').textContent= stats.poids_moyen  ? parseFloat(stats.poids_moyen).toFixed(1)               : '--';
  } catch (err) { console.error('ventes/stats:', err); }

  // Charger le tableau
  const tbody = document.getElementById('ventes-tbody');
  if (!tbody) return;
  tbody.innerHTML = `
    <tr><td colspan="8"><div class="skel-row"></div></td></tr>
    <tr><td colspan="8"><div class="skel-row" style="--d:.1s"></div></td></tr>
    <tr><td colspan="8"><div class="skel-row" style="--d:.2s"></div></td></tr>
  `;
  try {
    const ventes = await apiFetch('/ventes?limit=100');
    if (!ventes.length) {
      tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-2)">Aucune vente enregistrée</td></tr>`;
      return;
    }
    tbody.innerHTML = '';
    ventes.forEach(v => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="tag-cell">${escHtml(v.numero_tag)}</td>
        <td>${escHtml(v.nom_animal)}</td>
        <td>${escHtml(v.race || '—')}</td>
        <td>${escHtml(v.acheteur)}</td>
        <td style="font-size:.72rem">${escHtml(v.telephone)}</td>
        <td class="prix-cell">${Math.round(v.prix_fcfa).toLocaleString('fr-FR')}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:.72rem">${v.poids_vente_kg ? v.poids_vente_kg + ' kg' : '—'}</td>
        <td style="font-family:'JetBrains Mono',monospace;font-size:.72rem">${v.date_vente}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:24px;color:var(--text-2)">Erreur de chargement</td></tr>`;
  }
}

// ═══════════════════════════════════════════════════════════════
// CHAT IA
// ═══════════════════════════════════════════════════════════════

function focusChatInput() {
  setTimeout(() => document.getElementById('chat-input')?.focus(), 150);
}

async function sendChatMessage(text) {
  if (!text.trim()) return;

  const input   = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  input.value   = '';
  input.style.height = 'auto';
  sendBtn.disabled = true;

  appendUserMessage(text);
  const typingEl = appendTypingIndicator();
  scrollChatBottom();

  const modeBar   = document.getElementById('chat-mode');
  const modeLabel = modeBar.querySelector('.mode-txt');
  const modeDot   = modeBar.querySelector('.mode-dot');

  try {
    const data = await apiFetch('/chat', {
      method: 'POST',
      body: JSON.stringify({ message: text, session_id: SESSION_ID }),
    });

    typingEl.remove();

    if (data.mode === 'ACTION_PENDING') {
      state.pendingAction = true;
      modeDot.className   = 'mode-dot mode-action';
      modeLabel.textContent = 'Mode Action · En attente de confirmation';
      // Afficher dans le chat ET ouvrir la modale (pas de double texte — modale confirme l'action)
      appendBotMessage(data.response, 'action');
      const confirmed = await showModal('Confirmer l\'action', data.response);
      if (confirmed) {
        await sendChatMessage('Oui');
      } else {
        await sendChatMessage('Non');
        state.pendingAction = false;
        modeDot.className   = 'mode-dot mode-consult';
        modeLabel.textContent = 'Mode Consultation';
      }
    } else if (data.mode === 'ACTION_EXECUTED') {
      state.pendingAction = false;
      modeDot.className   = 'mode-dot mode-consult';
      modeLabel.textContent = 'Mode Consultation';
      appendBotMessageTypewriter(data.response);
      showToast('Action effectuée', data.response.slice(0, 80), 'info');
      loadStats();
      loadAnimauxStats();
      await loadVentes();
    } else {
      state.pendingAction = false;
      modeDot.className   = 'mode-dot mode-consult';
      modeLabel.textContent = 'Mode Consultation';

      const bubble = appendBotMessageTypewriter(data.response);
      if (data.sql_executed) appendSqlBlock(bubble, data.sql_executed);
      if (data.data?.length)  appendDataTable(bubble, data.data);
    }
  } catch (err) {
    typingEl.remove();
    appendBotMessage(`Erreur : ${err.message || 'Connexion au backend impossible.'}`, '');
    showToast('Erreur API', err.message, 'critique');
  } finally {
    sendBtn.disabled = false;
    scrollChatBottom();
  }
}

function appendUserMessage(text) {
  const msgs = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'msg msg--user';
  el.innerHTML = `
    <div class="msg-avatar">
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
        <circle cx="8" cy="5" r="3" stroke="currentColor" stroke-width="1.4"/>
        <path d="M2 14 C2 10.5, 4.5 9, 8 9 C11.5 9, 14 10.5, 14 14" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
      </svg>
    </div>
    <div class="msg-bubble">${escHtml(text)}</div>
  `;
  msgs.appendChild(el);
}

function appendBotMessage(text, extraClass = '') {
  const msgs = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'msg msg--bot';
  const bubble = document.createElement('div');
  bubble.className = `msg-bubble${extraClass ? ' ' + extraClass : ''}`;
  bubble.innerHTML = formatMsgText(text);
  el.innerHTML = `
    <div class="msg-avatar">
      <svg width="16" height="16" viewBox="0 0 22 22" fill="none">
        <path d="M11 2C7 4.5 4 8 4 13C4 17 7 20 11 20C15 20 18 17 18 13C18 8 15 4.5 11 2Z" stroke="currentColor" stroke-width="1.6" fill="none"/>
        <circle cx="8.5" cy="13" r="1.5" fill="currentColor"/>
        <circle cx="13.5" cy="13" r="1.5" fill="currentColor"/>
      </svg>
    </div>
  `;
  el.appendChild(bubble);
  msgs.appendChild(el);
  return bubble;
}

function appendBotMessageTypewriter(fullText) {
  const msgs = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'msg msg--bot';
  const bubble = document.createElement('div');
  bubble.className = 'msg-bubble';
  el.innerHTML = `
    <div class="msg-avatar">
      <svg width="16" height="16" viewBox="0 0 22 22" fill="none">
        <path d="M11 2C7 4.5 4 8 4 13C4 17 7 20 11 20C15 20 18 17 18 13C18 8 15 4.5 11 2Z" stroke="currentColor" stroke-width="1.6" fill="none"/>
        <circle cx="8.5" cy="13" r="1.5" fill="currentColor"/>
        <circle cx="13.5" cy="13" r="1.5" fill="currentColor"/>
      </svg>
    </div>
  `;
  el.appendChild(bubble);
  msgs.appendChild(el);
  typewriter(bubble, fullText);
  return bubble;
}

function typewriter(el, text, speed = 18) {
  el.textContent = '';
  const cursor = document.createElement('span');
  cursor.className = 'tw-cursor';
  el.appendChild(cursor);

  let i = 0;
  const tick = () => {
    if (i < text.length) {
      cursor.insertAdjacentText('beforebegin', text[i++]);
      scrollChatBottom();
      const delay = text[i - 1] === '.' || text[i - 1] === '\n' ? speed * 4 : speed;
      setTimeout(tick, delay);
    } else {
      cursor.remove();
    }
  };
  setTimeout(tick, 50);
}

function appendTypingIndicator() {
  const msgs = document.getElementById('chat-messages');
  const el = document.createElement('div');
  el.className = 'msg msg--bot';
  el.innerHTML = `
    <div class="msg-avatar">
      <svg width="16" height="16" viewBox="0 0 22 22" fill="none">
        <path d="M11 2C7 4.5 4 8 4 13C4 17 7 20 11 20C15 20 18 17 18 13C18 8 15 4.5 11 2Z" stroke="currentColor" stroke-width="1.6" fill="none"/>
        <circle cx="8.5" cy="13" r="1.5" fill="currentColor"/>
        <circle cx="13.5" cy="13" r="1.5" fill="currentColor"/>
      </svg>
    </div>
    <div class="msg-bubble">
      <div class="typing-indicator">
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
        <div class="typing-dot"></div>
      </div>
    </div>
  `;
  msgs.appendChild(el);
  scrollChatBottom();
  return el;
}

function appendSqlBlock(bubble, sql) {
  const pre = document.createElement('pre');
  pre.className = 'msg-sql';
  pre.textContent = sql;
  bubble.appendChild(pre);
}

function appendDataTable(bubble, rows) {
  if (!rows || !rows.length || !rows[0]) return;
  const cols = Object.keys(rows[0]);
  const table = document.createElement('table');
  table.className = 'msg-data-table';
  table.innerHTML = `
    <thead><tr>${cols.map(c => `<th>${escHtml(c)}</th>`).join('')}</tr></thead>
    <tbody>${rows.slice(0, 10).map(r =>
      `<tr>${cols.map(c => `<td>${escHtml(String(r[c] ?? ''))}</td>`).join('')}</tr>`
    ).join('')}</tbody>
  `;
  bubble.appendChild(table);
  if (rows.length > 10) {
    const note = document.createElement('div');
    note.style = 'font-size:.68rem;color:var(--text-2);margin-top:4px;';
    note.textContent = `… ${rows.length - 10} lignes supplémentaires`;
    bubble.appendChild(note);
  }
}

function scrollChatBottom() {
  const msgs = document.getElementById('chat-messages');
  if (msgs) msgs.scrollTop = msgs.scrollHeight;
}

// ═══════════════════════════════════════════════════════════════
// TOAST SYSTEM
// ═══════════════════════════════════════════════════════════════

const TOAST_ICONS = {
  critique:      '🔴',
  avertissement: '⚠️',
  info:          'ℹ️',
};

function showToast(title, message, niveau = 'info', duration = 5000) {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast t-${niveau}`;
  toast.innerHTML = `
    <div class="toast-ico">${TOAST_ICONS[niveau] || 'ℹ️'}</div>
    <div class="toast-body">
      <div class="toast-title">${escHtml(title)}</div>
      <div class="toast-msg">${escHtml(message)}</div>
    </div>
    <button class="toast-x" aria-label="Fermer">×</button>
  `;
  container.appendChild(toast);

  const dismiss = () => {
    toast.classList.add('out');
    setTimeout(() => toast.remove(), 280);
  };
  toast.querySelector('.toast-x').addEventListener('click', dismiss);
  toast.addEventListener('click', dismiss);
  setTimeout(dismiss, duration);
}

// ═══════════════════════════════════════════════════════════════
// MODAL SYSTEM
// ═══════════════════════════════════════════════════════════════

function showModal(title, bodyText) {
  return new Promise(resolve => {
    state.modalResolve = resolve;
    document.getElementById('modal-title').textContent = title;
    document.getElementById('modal-body').textContent  = bodyText;
    document.getElementById('modal-overlay').classList.add('open');
  });
}

function closeModal(confirmed) {
  document.getElementById('modal-overlay').classList.remove('open');
  if (state.modalResolve) {
    state.modalResolve(confirmed);
    state.modalResolve = null;
  }
}

// ═══════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════

function escHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function formatDate(dt) {
  if (!dt) return '';
  const d = new Date(dt);
  return d.toLocaleDateString('fr-FR', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

function formatMsgText(text) {
  return escHtml(text).replace(/\n/g, '<br>').replace(/\*(.*?)\*/g, '<strong>$1</strong>');
}

function animateValue(id, target, isDecimal = false) {
  const el = document.getElementById(id);
  if (!el) return;
  const end      = parseFloat(target) || 0;
  const duration = 1000;
  const step     = 16;
  const steps    = duration / step;
  let current    = 0;
  const inc      = (end - 0) / steps;

  const tick = () => {
    current += inc;
    if ((inc >= 0 && current >= end) || (inc < 0 && current <= end)) {
      el.textContent = isDecimal ? end.toFixed(3) : Math.round(end);
      return;
    }
    el.textContent = isDecimal ? current.toFixed(3) : Math.round(current);
    setTimeout(tick, step);
  };
  tick();
}

function updateSyncTime() {
  const el = document.getElementById('sync-time');
  if (el) el.textContent = new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function setCurrentDate() {
  const el = document.getElementById('topbar-date');
  if (el) el.textContent = new Date().toLocaleDateString('fr-FR', { weekday:'long', day:'numeric', month:'long', year:'numeric' });
}

// ═══════════════════════════════════════════════════════════════
// EVENT LISTENERS
// ═══════════════════════════════════════════════════════════════

document.addEventListener('DOMContentLoaded', () => {
  // ─── PAGE LOADER ──────────────────────────────────────────
  const loaderEl  = document.getElementById('page-loader');
  const loaderBar = document.getElementById('loader-bar');
  if (loaderEl && loaderBar) {
    let progress = 0;
    const tick = setInterval(() => {
      progress += Math.random() * 18 + 4;
      if (progress >= 100) { progress = 100; clearInterval(tick); }
      loaderBar.style.width = progress + '%';
    }, 100);
    setTimeout(() => {
      clearInterval(tick);
      loaderBar.style.width = '100%';
      setTimeout(() => loaderEl.classList.add('hidden'), 150);
    }, 2200);
  }

  setCurrentDate();
  setInterval(updateSyncTime, 1000);

  // Navigation
  document.querySelectorAll('[data-page]').forEach(el => {
    el.addEventListener('click', () => navigateTo(el.dataset.page));
  });

  // Refresh button
  document.getElementById('refresh-btn').addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    btn.classList.add('spinning');
    if (state.currentPage === 'dashboard') await loadDashboard();
    else if (state.currentPage === 'troupeau')  await loadTroupeau();
    else if (state.currentPage === 'sante')     await loadSante();
    else if (state.currentPage === 'ventes')    await loadVentes();
    else if (state.currentPage === 'pesees')    await loadTroupeau();
    btn.classList.remove('spinning');
    updateSyncTime();
  });

  // Alert bell → scroll vers le feed alertes (navigation si hors dashboard)
  document.getElementById('alert-bell').addEventListener('click', () => {
    const scrollToFeed = () => {
      const feed = document.getElementById('alert-feed');
      if (!feed) return;
      feed.scrollIntoView({ behavior: 'smooth', block: 'center' });
      feed.classList.add('feed-highlight');
      setTimeout(() => feed.classList.remove('feed-highlight'), 1200);
    };
    if (state.currentPage === 'dashboard') {
      scrollToFeed();
    } else {
      navigateTo('dashboard');
      setTimeout(scrollToFeed, 150);
    }
  });

  // Mark all alerts treated
  document.getElementById('mark-all-btn').addEventListener('click', async () => {
    const rows = document.querySelectorAll('#alert-feed .alert-row');
    for (const row of rows) {
      const btn = row.querySelector('.alert-mark-btn');
      if (btn) {
        const id = parseInt(btn.dataset.id);
        if (id) await markAlertTreated(id);
      }
    }
    await loadAlertsFeed();
    showToast('Alertes traitées', 'Toutes les alertes ont été marquées comme traitées.', 'info');
  });

  // Chat — send button
  document.getElementById('chat-send-btn').addEventListener('click', () => {
    sendChatMessage(document.getElementById('chat-input').value);
  });

  // Chat — Enter (Shift+Enter = newline)
  document.getElementById('chat-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendChatMessage(e.target.value);
    }
  });

  // Auto-resize textarea
  document.getElementById('chat-input').addEventListener('input', (e) => {
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  });

  // Suggestion chips
  document.querySelectorAll('.sug-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      navigateTo('chat');
      setTimeout(() => sendChatMessage(chip.dataset.msg), 200);
    });
  });

  // Table filter pills
  document.querySelectorAll('.filter-pill').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.filter-pill').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.filterStatut = btn.dataset.filter;
      renderTroupeauTable(state.animauxData);
    });
  });

  // Table search — troupeau
  document.getElementById('troupeau-search')?.addEventListener('input', () => {
    renderTroupeauTable(state.animauxData);
  });

  // Table search — santé
  document.getElementById('sante-search')?.addEventListener('input', () => {
    renderSanteTable(_santeData);
  });

  // Bouton "Enregistrer via Chat IA" — page Santé
  document.getElementById('sante-chat-btn')?.addEventListener('click', () => {
    navigateTo('chat');
    setTimeout(() => {
      const input = document.getElementById('chat-input');
      if (input) {
        input.value = 'Montre-moi les actes sanitaires pour ';
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
        input.style.height = 'auto';
        input.style.height = input.scrollHeight + 'px';
      }
    }, 150);
  });

  // ─── SANTE FORM MODAL ────────────────────────────────────────
  document.getElementById('sante-new-btn')?.addEventListener('click', () => {
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('sf-tag').value   = '';
    document.getElementById('sf-type').value  = 'vaccination';
    document.getElementById('sf-date').value  = today;
    document.getElementById('sf-vet').value   = '';
    document.getElementById('sf-rdv').value   = '';
    document.getElementById('sante-form-overlay').classList.add('open');
    setTimeout(() => document.getElementById('sf-tag').focus(), 80);
  });

  document.getElementById('sante-form-cancel')?.addEventListener('click', () => {
    document.getElementById('sante-form-overlay').classList.remove('open');
  });
  document.getElementById('sante-form-overlay')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) document.getElementById('sante-form-overlay').classList.remove('open');
  });

  document.getElementById('sante-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('sante-form-submit');
    btn.disabled = true;
    btn.textContent = 'Enregistrement…';
    const payload = {
      numero_tag:   document.getElementById('sf-tag').value.trim().toUpperCase(),
      type:         document.getElementById('sf-type').value,
      date_acte:    document.getElementById('sf-date').value || null,
      veterinaire:  document.getElementById('sf-vet').value.trim() || null,
      prochain_rdv: document.getElementById('sf-rdv').value || null,
    };
    try {
      const res = await apiFetch('/sante', { method: 'POST', body: JSON.stringify(payload) });
      document.getElementById('sante-form-overlay').classList.remove('open');
      showToast('Acte enregistré', res.message, 'info');
      loadSante();
    } catch (err) {
      showToast('Erreur', err.message, 'critique');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Enregistrer';
    }
  });

  // Modal buttons
  document.getElementById('modal-confirm').addEventListener('click', () => closeModal(true));
  document.getElementById('modal-cancel').addEventListener('click',  () => closeModal(false));
  document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeModal(false);
  });

  // Escape key → close modal
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeModal(false);
  });

  // ─── INIT ─────────────────────────────────────────────────
  checkApiHealth();
  navigateTo('dashboard');
  setInterval(checkApiHealth, 60_000);
});
