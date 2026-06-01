/*
 * app.js — Controlador de la UI (equivalent a app.py, sense lògica de
 * domini). Reprodueix el flux: selecció → problema → raonament/commit →
 * resolt. Branca segons ENABLE_AI igual que app.py (una columna sense IA,
 * dues columnes amb IA + xat).
 */
(function () {
  "use strict";

  const T = window.Tutor;
  const L = window.LLM;
  const AI_ON = L.isAiEnabled();
  const DEBUG = new URLSearchParams(location.search).get("debug") === "1";

  // ---- Estat de la UI ----
  let state = null; // estat de la sessió (Tutor.newSessionState)
  let busy = false; // bloqueja accions mentre s'espera la IA
  let busyLabel = "";
  let draftMessage = ""; // preserva el text escrit entre re-renders

  // Filtres del selector
  let selCurs = "1ESO";
  let selAny = 2026;
  let selPunts = new Set([3, 4, 5]);
  let selectedPid = null;

  const root = document.getElementById("app-root");

  // ---- Utils de presentació ----
  function esc(s) {
    return (s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  // Conversió mínima Markdown→HTML (igual que _format_md de app.py),
  // sobre text JA escapat.
  function formatMd(text) {
    let html = esc(text)
      .replace(/\n\n/g, "<br/><br/>")
      .replace(/\n/g, "<br/>");
    html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    return html;
  }

  function cap(s) {
    if (!s) return s;
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function formatOption(pid) {
    const p = T.getProblem(pid);
    const tema = p.tema || "—";
    const displayId = pid.replace(/^CAN-/, "");
    return `${displayId} · ${tema}`;
  }

  function willHintUseAI(st) {
    const hasInitial = !!st.problem.pista_inicial;
    return !(st.pistes_count === 0 && hasInitial);
  }

  // ============================================================
  // RENDER
  // ============================================================
  function render() {
    const parts = [];
    parts.push(`<h1 class="app-title">🦘 Prova Cangur</h1>`);

    if (!state) {
      parts.push(`
        <div class="welcome">
          👋 Et donem la benvinguda a la pràctica de Prova Cangur.<br/><br/>
          Tria un problema aquí sota i prem <strong>🎯 Inicia el problema</strong>.
        </div>`);
    }

    parts.push(renderSelector());

    if (state) {
      parts.push(renderSession());
    }

    root.innerHTML = parts.join("");

    // Restaura el text del missatge si n'hi havia (re-render no el perd).
    const ta = root.querySelector('[data-role="message-input"]');
    if (ta) ta.value = draftMessage;
  }

  function renderSelector() {
    const open = !state ? "open" : "";
    const available = T.getAvailableProblems();

    const cursPills = ["1ESO", "2ESO", "3ESO", "4ESO"]
      .map(
        (c) =>
          `<button class="pill ${
            selCurs === c ? "selected" : ""
          }" data-action="pill" data-group="curs" data-value="${c}">${c}</button>`
      )
      .join("");

    const anyPills = [2023, 2024, 2025, 2026]
      .map(
        (y) =>
          `<button class="pill ${
            selAny === y ? "selected" : ""
          }" data-action="pill" data-group="any" data-value="${y}">${y}</button>`
      )
      .join("");

    const puntsPills = [3, 4, 5]
      .map(
        (p) =>
          `<button class="pill ${
            selPunts.has(p) ? "selected" : ""
          }" data-action="pill" data-group="punts" data-value="${p}">${p}</button>`
      )
      .join("");

    const filtered = available.filter((pid) => {
      const p = T.getProblem(pid);
      return (
        selPunts.has(p.punts) &&
        p.categoria === selCurs &&
        p.any === selAny
      );
    });

    // Manté la selecció si encara és vàlida; si no, el primer.
    if (!filtered.includes(selectedPid)) {
      selectedPid = filtered.length ? filtered[0] : null;
    }

    let problemPicker;
    if (!available.length) {
      problemPicker = `<div class="selector-empty">Encara no hi ha problemes al catàleg.</div>`;
    } else if (!filtered.length) {
      problemPicker = `<div class="selector-empty">No hi ha cap problema amb els filtres seleccionats.</div>`;
    } else {
      const opts = filtered
        .map(
          (pid) =>
            `<option value="${pid}" ${
              pid === selectedPid ? "selected" : ""
            }>${esc(formatOption(pid))}</option>`
        )
        .join("");
      problemPicker = `
        <div class="field-label">Problema</div>
        <select class="problem-select" data-role="problem-select">${opts}</select>
        <button class="btn btn-start btn-full" data-action="start">🎯 Inicia el problema</button>`;
    }

    return `
      <details class="selector" ${open}>
        <summary>📚 Escull un problema</summary>
        <div class="selector-body">
          <div class="filter-row">
            <div class="filter-label">Curs</div>
            <div class="pills">${cursPills}</div>
          </div>
          <div class="filter-row">
            <div class="filter-label">Any</div>
            <div class="pills">${anyPills}</div>
          </div>
          <div class="filter-row">
            <div class="filter-label">Punts</div>
            <div class="pills">${puntsPills}</div>
          </div>
          ${problemPicker}
          ${DEBUG ? renderDebugBadge() : ""}
        </div>
      </details>`;
  }

  function renderDebugBadge() {
    const badge = AI_ON ? "🟢 ENABLE_AI=1" : "🔴 ENABLE_AI=0 (default)";
    return `<div class="selector-empty" style="margin-top:.8rem;border-top:1px solid #e5e7eb;padding-top:.6rem">
      <strong>Mode debug actiu</strong><br/>Estat IA: ${badge} · Model: <code>${esc(
      window.CANGUR_CONFIG.MODEL || "?"
    )}</code></div>`;
  }

  function renderSession() {
    const problemPanel = renderProblemPanel();
    const sidePanel = AI_ON ? renderDialoguePanel() : renderAiOffExtras();

    let trailing = `<hr class="divider"/>${renderHistoryExpander()}`;
    if (DEBUG) trailing += renderDebugState();

    return `<div class="layout">${problemPanel}${sidePanel}</div>${trailing}`;
  }

  function renderProblemPanel() {
    const p = state.problem;
    const verdict = state.verdict_final;
    const mode = state.mode;

    const tema = cap(p.tema || "tema no especificat");
    let html = `<section class="problem-panel">`;
    html += `<h2 class="problem-title">${esc(p.categoria)} (${p.any}) Q${
      p.numero
    } · ${esc(tema)}</h2>`;

    // Imatge o enunciat de text
    if (p.imatge) {
      html += `<div class="header-image"><img src="data/img/${esc(
        p.imatge
      )}" alt="Enunciat del problema" loading="lazy"/></div>`;
    } else if (p.enunciat) {
      html += `<div class="enunciat">${formatMd(p.enunciat)}</div>`;
    }

    // Targeta A-E (excepte en mode commit)
    if (mode !== "committing") {
      html += renderEliminationCard();
    }

    // Botons segons el mode
    if (verdict === null && mode === "reasoning") {
      const canHint = AI_ON || !willHintUseAI(state);
      const hintBtn = canHint
        ? `<button class="btn btn-hint" data-action="hint" ${
            busy ? "disabled" : ""
          }>${
            busy && busyLabel === "hint" ? "Generant…" : "Vull una pista"
          }</button>`
        : "";
      html += `<div class="action-row">
        ${hintBtn}
        <button class="btn btn-commit-enter" data-action="enter-commit" ${
          busy ? "disabled" : ""
        }>Ja tinc la resposta</button>
      </div>`;
    } else if (verdict === null && mode === "committing") {
      html += renderCommitSection();
    } else if (verdict !== null) {
      // Resolt: felicitació + botó següent problema
      html += renderFlash({ only: "commit_ok" });
      const nextPid = T.nextProblemId(p.id);
      if (nextPid) {
        html += `<button class="btn btn-next btn-full" data-action="start-next" title="Començar ${esc(
          nextPid.replace(/^CAN-/, "")
        )}">⏩︎ Inicia el problema següent</button>`;
      }
    }

    html += `</section>`;
    return html;
  }

  function renderEliminationCard() {
    const eliminated = new Set(state.eliminated_options || []);
    const chips = T.VALID_LETTERS.map((letter) => {
      const cls = eliminated.has(letter)
        ? "label-row eliminated"
        : "label-row";
      return `<span class="${cls}">${letter}</span>`;
    }).join("");
    return `<div class="opcions-card">${chips}</div>`;
  }

  function renderCommitSection() {
    const eliminated = new Set(state.eliminated_options || []);
    const letters = T.VALID_LETTERS.map((letter) => {
      const dis = eliminated.has(letter) ? "disabled" : "";
      return `<button class="btn btn-letter" data-action="commit" data-letter="${letter}" ${dis} ${
        busy ? "disabled" : ""
      }>${letter}</button>`;
    }).join("");
    return `<div class="commit-section">
      <div class="commit-prompt">Escull l'opció que creus correcta:</div>
      <div class="commit-letters">${letters}</div>
      <button class="btn btn-cancel" data-action="cancel-commit">← Tornar a raonar</button>
    </div>`;
  }

  // Panell dret amb IA: fil de xat + flash + input/resum
  function renderDialoguePanel() {
    const verdict = state.verdict_final;
    let html = `<section class="dialogue-panel">
      <h3 class="dialeg-title">Diàleg</h3>
      ${renderConversation()}
      ${renderFlash({ exclude: "commit_ok" })}`;

    if (verdict !== null) {
      html += `<hr class="divider"/>${renderTraceExpander()}`;
    } else if (state.mode === "reasoning") {
      const remaining = T.messagesRemaining(state);
      html += `
        <hr class="divider"/>
        <div class="message-form">
          <textarea data-role="message-input" placeholder="Escriu aquí la teva frase" ${
            busy ? "disabled" : ""
          }></textarea>
          <button class="btn btn-send btn-full" data-action="send" ${
            busy ? "disabled" : ""
          }>${busy && busyLabel === "send" ? "Un moment…" : "Enviar missatge"}</button>
          <div class="msg-hint-msgcount">Missatges restants: ${remaining}</div>
        </div>`;
    }
    html += `</section>`;
    return html;
  }

  // Sense IA: pistes (si n'hi ha) + flash + resum final
  function renderAiOffExtras() {
    const verdict = state.verdict_final;
    let html = `<section class="dialogue-panel">`;
    html += renderHintsOnly();
    html += renderFlash({ exclude: "commit_ok" });
    if (verdict !== null) {
      html += `<hr class="divider"/>${renderTraceExpander()}`;
    }
    html += `</section>`;
    return html;
  }

  function renderHintsOnly() {
    const hints = (state.conversation_history || []).filter(
      (t) => t.kind === "hint"
    );
    if (!hints.length) return "";
    return hints
      .map((turn) => {
        const badge = turn.source === "catalog" ? "📘" : "💡";
        return `<div class="chat-hint" style="margin-right:0"><strong>${badge}</strong><br/>${formatMd(
          turn.content
        )}</div>`;
      })
      .join("");
  }

  function renderConversation() {
    const history = state.conversation_history || [];
    if (!history.length) {
      return `<div class="chat-empty">Encara no heu començat a dialogar.</div>`;
    }
    let html = `<div class="chat-thread">`;
    let rendered = false;
    for (const turn of history) {
      const role = turn.role;
      const kind = turn.kind || "message";
      const content = formatMd(turn.content);
      if (kind === "hint") {
        const badge = turn.source === "catalog" ? "📘" : "💡";
        html += `<div class="chat-hint"><strong>${badge}</strong><br/>${content}</div>`;
        rendered = true;
      } else if (kind === "system_event") {
        continue; // context intern per a la IA; no es mostra
      } else if (role === "user") {
        if (rendered) html += `<hr class="turn-separator"/>`;
        html += `<div class="chat-user">${content}</div>`;
        rendered = true;
      } else {
        html += `<div class="chat-ai">${content}</div>`;
        rendered = true;
      }
    }
    html += `</div>`;
    return html;
  }

  function renderFlash({ only = null, exclude = null } = {}) {
    const onlySet = only ? new Set([].concat(only)) : null;
    const exclSet = exclude ? new Set([].concat(exclude)) : null;
    return (state.messages || [])
      .filter((m) => {
        const kind = m.kind || "warning";
        if (onlySet && !onlySet.has(kind)) return false;
        if (exclSet && exclSet.has(kind)) return false;
        return true;
      })
      .map((m) => `<div class="flash msg-${m.kind}">${formatMd(m.text)}</div>`)
      .join("");
  }

  function renderTraceExpander() {
    return `<details class="trace">
      <summary>📄 Veure el rastre JSON de la sessió</summary>
      <div class="trace-body">
        <pre class="trace-json">${esc(T.serializeTrace(state))}</pre>
        <button class="btn btn-download" data-action="download-trace">⬇ Descarregar rastre JSON</button>
      </div>
    </details>`;
  }

  function renderHistoryExpander() {
    const history = state.history || [];
    if (!history.length) return "";
    const rows = history
      .map((h, i) => {
        const ts = new Date((h.ts || 0) * 1000).toLocaleTimeString();
        const n = i + 1;
        if (h.type === "discuss") {
          return `<div class="event-row"><span class="ev-meta">${n}. [${ts}] Diàleg</span><br/>
            <em>Alumne:</em> ${esc(h.student)}<br/><em>IA:</em> ${esc(
            h.ai_response
          )}</div>`;
        } else if (h.type === "hint") {
          return `<div class="event-row"><span class="ev-meta">${n}. [${ts}] Pista (${esc(
            h.source
          )})</span><br/>${esc(h.content)}</div>`;
        } else if (h.type === "commit") {
          const emoji = h.correct ? "✅" : "❌";
          return `<div class="event-row"><span class="ev-meta">${n}. [${ts}] Commit <code>${esc(
            h.letter
          )}</code> ${emoji}</span></div>`;
        } else {
          return `<div class="event-row"><span class="ev-meta">${n}. [${ts}] ${esc(
            h.type
          )}</span></div>`;
        }
      })
      .join("");
    return `<details class="trace">
      <summary>📋 Rastre d'events (${history.length})</summary>
      <div class="trace-body">${rows}</div>
    </details>`;
  }

  function renderDebugState() {
    const dbg = Object.assign({}, state);
    delete dbg.problem;
    dbg.problem_id_only = state.problem.id;
    return `<details class="trace">
      <summary>🔍 Estat intern (debug)</summary>
      <div class="trace-body"><pre class="trace-json">${esc(
        JSON.stringify(dbg, null, 2)
      )}</pre></div>
    </details>`;
  }

  // ============================================================
  // ACCIONS
  // ============================================================
  function startProblem(pid) {
    if (!pid) return;
    try {
      state = T.newSessionState(pid);
      draftMessage = "";
      render();
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      alert("Error iniciant: " + e.message);
    }
  }

  async function doSend() {
    if (busy) return;
    busy = true;
    busyLabel = "send";
    render();
    state = await T.processMessage(state, draftMessage);
    draftMessage = "";
    busy = false;
    busyLabel = "";
    render();
  }

  async function doHint() {
    if (busy) return;
    const usesAI = willHintUseAI(state);
    if (usesAI) {
      busy = true;
      busyLabel = "hint";
      render();
    }
    state = await T.requestHint(state);
    busy = false;
    busyLabel = "";
    render();
  }

  async function doCommit(letter) {
    if (busy) return;
    state = await T.processCommit(state, letter);
    render();
  }

  function downloadTrace() {
    const blob = new Blob([T.serializeTrace(state)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trace_${state.session_id}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ============================================================
  // ESDEVENIMENTS (delegació)
  // ============================================================
  root.addEventListener("click", function (ev) {
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "pill") {
      const group = el.dataset.group;
      const value = el.dataset.value;
      if (group === "curs") selCurs = value;
      else if (group === "any") selAny = parseInt(value, 10);
      else if (group === "punts") {
        const v = parseInt(value, 10);
        if (selPunts.has(v)) selPunts.delete(v);
        else selPunts.add(v);
      }
      render();
      // Mantén el selector obert després de clicar un pill.
      const det = root.querySelector("details.selector");
      if (det) det.open = true;
    } else if (action === "start") {
      const sel = root.querySelector('[data-role="problem-select"]');
      startProblem(sel ? sel.value : selectedPid);
    } else if (action === "start-next") {
      const nextPid = T.nextProblemId(state.problem.id);
      startProblem(nextPid);
    } else if (action === "hint") {
      doHint();
    } else if (action === "enter-commit") {
      state = T.requestCommitMode(state);
      render();
    } else if (action === "cancel-commit") {
      state = T.cancelCommitMode(state);
      render();
    } else if (action === "commit") {
      if (el.disabled) return;
      doCommit(el.dataset.letter);
    } else if (action === "send") {
      doSend();
    } else if (action === "download-trace") {
      downloadTrace();
    }
  });

  // Canvi al desplegable de problema
  root.addEventListener("change", function (ev) {
    const el = ev.target.closest('[data-role="problem-select"]');
    if (el) selectedPid = el.value;
  });

  // Manté el text escrit i permet Ctrl+Enter per enviar
  root.addEventListener("input", function (ev) {
    const ta = ev.target.closest('[data-role="message-input"]');
    if (ta) draftMessage = ta.value;
  });
  root.addEventListener("keydown", function (ev) {
    const ta = ev.target.closest('[data-role="message-input"]');
    if (ta && (ev.ctrlKey || ev.metaKey) && ev.key === "Enter") {
      ev.preventDefault();
      doSend();
    }
  });

  // ============================================================
  // INICI
  // ============================================================
  document.body.classList.add(AI_ON ? "ai-on" : "ai-off");
  render();
})();
