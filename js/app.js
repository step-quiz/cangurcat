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
  let state = null; // estat del PROBLEMA actual (Tutor.newSessionState)
  let busy = false; // bloqueja accions mentre s'espera la IA
  let busyLabel = "";
  let draftMessage = ""; // preserva el text escrit entre re-renders
  // Estat del menú hamburguesa (NOMÉS visible en mòbil horitzontal). En
  // qualsevol altre context el CSS mostra tot el contingut i la hamburguesa
  // resta oculta, així que aquest flag no hi té cap efecte visible.
  let menuOpen = false;

  // ---- Estat de la SESSIÓ (acumula tots els problemes d'un mateix
  //      curs+convocatòria, per generar el codi de verificació) ----
  //   session = {
  //     curs, any, startedTs,
  //     problems: { [numero]: {answered, solved, solveCommits, hints} }
  //   }
  // S'inicia quan s'obre el primer problema i es REINICIA en canviar de
  // curs o de convocatòria. Veure codi.js per al format del codi.
  let session = null;
  let sessionFinished = false; // mostra el panell "Prova finalitzada"
  let lastCode = null; // { code, metrics } del darrer codi generat

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
  // SESSIÓ (acumulació entre problemes + codi de verificació)
  // ============================================================

  // Crea una sessió nova si no n'hi ha cap, o si el problema pertany a un
  // curs/convocatòria diferents (llavors es reinicia). El rellotge de la
  // sessió arrenca quan s'obre el PRIMER problema (= "entrar a la sessió").
  function ensureSession(problem) {
    if (
      !session ||
      session.curs !== problem.categoria ||
      session.any !== problem.any
    ) {
      session = {
        curs: problem.categoria,
        any: problem.any,
        startedTs: Date.now() / 1000,
        problems: {},
      };
      sessionFinished = false;
      lastCode = null;
    }
  }

  // Fusiona un registre previ amb l'estat viu d'un problema. "answered" i
  // "solved" són enganxosos (un cop certs, ho continuen sent) i les pistes
  // es queden amb el màxim; així, reobrir un problema dins la mateixa sessió
  // no fa perdre un encert ni el recompte de pistes (cas lineal: exacte).
  function mergeProblem(prev, st) {
    const base = prev || {
      answered: false,
      solved: false,
      solveCommits: null,
      hints: 0,
    };
    const nCommits = (st.commit_attempts || []).length;
    const solvedNow = st.verdict_final === "solved";
    return {
      answered: base.answered || nCommits > 0,
      solved: base.solved || solvedNow,
      solveCommits:
        base.solveCommits != null
          ? base.solveCommits
          : solvedNow
          ? nCommits
          : null,
      hints: Math.max(base.hints || 0, st.pistes_count || 0),
    };
  }

  // Persisteix el problema obert ACTUAL dins la sessió (abans de canviar de
  // problema o en finalitzar). Només si pertany al curs/any de la sessió.
  function recordCurrentProblem() {
    if (!session || !state) return;
    const p = state.problem;
    if (!p || p.categoria !== session.curs || p.any !== session.any) return;
    session.problems[p.numero] = mergeProblem(
      session.problems[p.numero],
      state
    );
  }

  // Totals VIUS de la sessió (no muta res): fusiona els problemes ja
  // registrats amb el problema obert actual, perquè els comptadors es vegin
  // sempre al dia. Retorna també el mapa de problemes per generar el codi.
  function sessionTotals() {
    const merged = {};
    if (session) {
      for (const n in session.problems) {
        merged[n] = Object.assign({}, session.problems[n]);
      }
      if (state) {
        const p = state.problem;
        if (p && p.categoria === session.curs && p.any === session.any) {
          merged[p.numero] = mergeProblem(merged[p.numero], state);
        }
      }
    }
    let answered = 0,
      solved = 0,
      hints = 0;
    for (const k in merged) {
      const r = merged[k];
      if (r.answered) answered++;
      if (r.solved) solved++;
      hints += r.hints || 0;
    }
    return { answered, solved, errors: answered - solved, hints, problems: merged };
  }

  function humanitzeDur(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    if (h > 0) return `${h} h ${m} min ${s} s`;
    if (m > 0) return `${m} min ${s} s`;
    return `${s} s`;
  }

  // Problema anterior dins el mateix curs+convocatòria.
  function prevProblemId(pid) {
    const available = T.getAvailableProblems();
    const idx = available.indexOf(pid);
    if (idx <= 0) return null;
    const prv = available[idx - 1];
    const cur = T.getProblem(pid);
    const pp = T.getProblem(prv);
    return pp.categoria === cur.categoria && pp.any === cur.any ? prv : null;
  }

  // Calcula i congela el codi de verificació de la sessió.
  function finishSession() {
    if (!session) return;
    recordCurrentProblem(); // assegura el problema obert
    const totals = sessionTotals();
    lastCode = window.Codi.generate({
      curs: session.curs,
      any: session.any,
      problems: totals.problems,
      durationSec: Date.now() / 1000 - session.startedTs,
    });
    sessionFinished = true;
    menuOpen = false;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function continuePractice() {
    sessionFinished = false; // conserva la sessió; pot seguir i regenerar
    lastCode = null;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function newSession() {
    session = null;
    state = null;
    sessionFinished = false;
    lastCode = null;
    draftMessage = "";
    menuOpen = false;
    render();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  // ============================================================
  // RENDER
  // ============================================================
  function render() {
    // Panell final "Prova finalitzada" (substitueix tota la vista).
    if (sessionFinished && lastCode) {
      root.innerHTML =
        renderOrientationHint() +
        `<h1 class="app-title">🦘 Prova Cangur</h1>` +
        renderFinishedPanel();
      return;
    }

    const parts = [];

    // Avís (només mòbil vertical) suggerint girar el dispositiu. NO esborra
    // res: és un banner fix que conviu amb tot el contingut.
    parts.push(renderOrientationHint());

    // Capçalera reagrupable: títol + subtítol de benvinguda + barra de
    // sessió + selector. En mòbil horitzontal es plega dins una hamburguesa
    // per deixar l'enunciat visible de seguida; a la resta de mides es
    // mostra tal com sempre.
    parts.push(renderTopChrome());

    if (state) {
      parts.push(renderSession());
    }

    root.innerHTML = parts.join("");

    // Restaura el text del missatge si n'hi havia (re-render no el perd).
    const ta = root.querySelector('[data-role="message-input"]');
    if (ta) ta.value = draftMessage;

    // Quan la hamburguesa està oberta (només té efecte visible en mòbil
    // horitzontal), el selector "Escull un problema" s'ha de veure ja
    // desplegat, no plegat.
    if (menuOpen) {
      const selDet = root.querySelector("details.selector");
      if (selDet) selDet.open = true;
    }
  }

  // Banner fix d'orientació: el CSS només el fa visible en mòbil vertical.
  function renderOrientationHint() {
    return `<div class="orientation-hint" role="note">
      🔄 Gira el mòbil en horitzontal: l'enunciat es veu molt més gran i clar.
    </div>`;
  }

  // Capçalera superior. La barra de sessió i el selector viuen dins un
  // contenidor plegable; el botó hamburguesa només apareix (via CSS) en
  // mòbil horitzontal. El títol s'amaga en aquell mateix context.
  function renderTopChrome() {
    const sessionBar = session ? renderSessionBar() : "";
    const selector = renderSelector();

    // Subtítol de benvinguda (només quan encara no s'ha obert cap problema).
    // Conté dues redaccions: el CSS mostra la que correspon al dispositiu
    // (escriptori/vertical vs. mòbil horitzontal amb hamburguesa).
    const subtitle = !state
      ? `<p class="app-subtitle">
           <span class="subtitle-default">👋 Et donem la benvinguda a la pràctica de Prova Cangur. Tria un problema aquí sota i prem <strong>🎯 Inicia el problema</strong>.</span>
           <span class="subtitle-landscape">👋 Et donem la benvinguda a la pràctica de Prova Cangur. Desplega el menú de la dreta, tria un problema i prem <strong>🎯 Inicia el problema</strong>.</span>
         </p>`
      : "";

    // Context compacte de la barra hamburguesa (només mòbil horitzontal):
    // si hi ha sessió, curs + convocatòria; si no, només la icona (sense la
    // paraula "Menú", que ja la mostra el botó de la dreta).
    let burgerCtx = "";
    if (session) {
      const cursLabel =
        (window.Codi.CURS_LABEL && window.Codi.CURS_LABEL[session.curs]) ||
        session.curs;
      burgerCtx = ` ${cursLabel} · ${session.any}`;
    }

    const openAttr = menuOpen ? "true" : "false";

    return `
      <div class="topchrome" data-open="${openAttr}" data-role="topchrome">
        <h1 class="app-title">🦘 Prova Cangur</h1>
        ${subtitle}
        <div class="burger-bar">
          <span class="burger-ctx">🦘${esc(burgerCtx)}</span>
          <button class="burger-btn" data-action="toggle-menu"
            aria-expanded="${openAttr}" aria-label="Obre o tanca el menú">
            <span class="burger-icon">${menuOpen ? "✕" : "☰"}</span>
            <span class="burger-text">${menuOpen ? "Tanca" : "Menú"}</span>
          </button>
        </div>
        <div class="topchrome-body" data-role="topchrome-body">
          ${sessionBar}
          ${selector}
        </div>
      </div>`;
  }

  // Barra superior de progrés de la sessió + botó per finalitzar i obtenir
  // el codi. Sempre visible mentre s'està practicant.
  function renderSessionBar() {
    const t = sessionTotals();
    const cursLabel =
      (window.Codi.CURS_LABEL && window.Codi.CURS_LABEL[session.curs]) ||
      session.curs;
    // "Preguntes treballades" = problemes que l'alumne ha obert en aquesta
    // sessió (els comptadors detallats —encerts, errors, pistes, temps—
    // segueixen viatjant dins el codi i es veuen a l'analitzador).
    const worked = Object.keys(t.problems).length;
    const workedLabel =
      worked === 1 ? "pregunta treballada" : "preguntes treballades";
    return `
      <div class="session-bar">
        <div class="sb-info">
          <span class="sb-title">Prova Cangur: ${esc(cursLabel)} (${session.any})</span>
          <span class="sb-ctx"><strong>${worked}</strong> ${workedLabel}</span>
        </div>
        <button class="btn btn-finish" data-action="finish-session" title="Genera el codi per lliurar al professorat">
          🏁 Finalitzar i obtenir el codi
        </button>
      </div>`;
  }

  // Panell "Prova finalitzada": resum + codi copiable (com a Competències
  // Bàsiques) + opcions per seguir practicant o començar de nou.
  function renderFinishedPanel() {
    const m = lastCode.metrics;
    return `
      <section class="finished-panel">
        <div class="finished-title">🎉 Prova finalitzada</div>
        <p class="finished-sub">Has completat la pràctica de:
          <strong>${esc(m.cursLabel)}</strong> · convocatòria <strong>${m.any}</strong></p>

        <div class="finished-stats">
          <div class="fs-item"><div class="fs-num">${m.answered}</div><div class="fs-lbl">respostes</div></div>
          <div class="fs-item"><div class="fs-num">${m.solved}</div><div class="fs-lbl">encerts</div></div>
          <div class="fs-item"><div class="fs-num">${m.errors}</div><div class="fs-lbl">errors</div></div>
          <div class="fs-item"><div class="fs-num">${m.hints}</div><div class="fs-lbl">pistes</div></div>
        </div>

        <div class="code-box">
          <p class="code-box-label">Clica damunt del codi següent:</p>
          <button class="code-btn" data-action="copy-code" data-code="${esc(
            lastCode.code
          )}">${esc(lastCode.code)}</button>
          <div class="copied-msg" data-role="copied-msg">Copiat! ✅</div>
        </div>

        <div class="code-box" data-role="forms-box" style="display:none">
          <p class="code-box-label">Clica l'enllaç següent per obrir el Google Forms:</p>
          <a class="btn btn-start btn-full" href="https://docs.google.com/forms/d/e/1FAIpQLSfGul0XzwH_SiJ8Vr8kOe_J5pHNFCohSk1tW1dpz8GZuB7f_Q/viewform" target="_blank" rel="noopener noreferrer">Enquesta</a>
        </div>

        <div class="finished-actions">
          <button class="btn btn-continue" data-action="continue-practice">↩︎ Seguir practicant</button>
          <button class="btn btn-newsession" data-action="new-session">🔄 Començar una sessió nova</button>
        </div>
      </section>`;
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

    // El rastre d'events queda reservat al mode debug (?debug=1); l'alumne
    // no l'ha de veure. La funcionalitat es manté intacta (renderHistoryExpander).
    let trailing = "";
    if (DEBUG) {
      trailing += `<hr class="divider"/>${renderHistoryExpander()}`;
      trailing += renderDebugState();
    }

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

    // Fletxes de navegació (esquerra i dreta del panell)
    const prevPid = prevProblemId(p.id);
    const nextPid = T.nextProblemId(p.id);
    return `<div class="problem-nav-row">
      <button class="nav-arrow nav-prev" data-action="nav-prev" ${prevPid ? `data-pid="${esc(prevPid)}"` : "disabled"} title="Problema anterior">«</button>
      ${html}
      <button class="nav-arrow nav-next" data-action="nav-next" ${nextPid ? `data-pid="${esc(nextPid)}"` : "disabled"} title="Problema següent">»</button>
    </div>`;
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
    // Un cop resolt, s'amaguen les pistes del fil (són soroll); la resta
    // del diàleg es conserva.
    let html = `<section class="dialogue-panel">
      <h3 class="dialeg-title">Diàleg</h3>
      ${renderConversation({ hideHints: verdict !== null })}
      ${verdict === null ? renderFlash({ exclude: "commit_ok" }) : ""}`;

    if (verdict !== null) {
      if (DEBUG) html += `<hr class="divider"/>${renderTraceExpander()}`;
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
    // Un cop resolt, la pista ja és soroll: no es mostra.
    if (verdict === null) {
      html += renderHintsOnly();
      html += renderFlash({ exclude: "commit_ok" });
    }
    if (verdict !== null && DEBUG) {
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
    const lastIdx = hints.length - 1;
    return hints
      .map((turn, i) => {
        const badge = turn.source === "catalog" ? "📘" : "💡";
        const anchor = i === lastIdx ? ' data-role="last-hint"' : "";
        return `<div class="chat-hint" style="margin-right:0"${anchor}><strong>${badge}</strong><br/>${formatMd(
          turn.content
        )}</div>`;
      })
      .join("");
  }

  function renderConversation({ hideHints = false } = {}) {
    const history = state.conversation_history || [];
    if (!history.length) {
      return `<div class="chat-empty">Encara no heu començat a dialogar.</div>`;
    }
    let html = `<div class="chat-thread">`;
    let rendered = false;
    // Índex de l'última pista, per ancorar-hi el scroll automàtic.
    let lastHintIdx = -1;
    for (let k = 0; k < history.length; k++) {
      if ((history[k].kind || "message") === "hint") lastHintIdx = k;
    }
    for (let hi = 0; hi < history.length; hi++) {
      const turn = history[hi];
      const role = turn.role;
      const kind = turn.kind || "message";
      const content = formatMd(turn.content);
      if (kind === "hint") {
        if (hideHints) continue; // resolt: la pista és soroll
        const badge = turn.source === "catalog" ? "📘" : "💡";
        const anchor = hi === lastHintIdx ? ' data-role="last-hint"' : "";
        html += `<div class="chat-hint"${anchor}><strong>${badge}</strong><br/>${content}</div>`;
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
      // Desa el problema que estàvem fent dins la sessió actual (si escau)
      // ABANS de substituir l'estat pel nou problema.
      recordCurrentProblem();
      state = T.newSessionState(pid);
      // Crea/continua/reinicia la sessió segons el curs+convocatòria.
      ensureSession(state.problem);
      draftMessage = "";
      menuOpen = false; // en obrir problema, plega sempre la hamburguesa
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
    scrollToLastHint();
  }

  // Després de demanar una pista, porta-la a la vista (sovint queda sota el
  // viewport). Espera un frame perquè el DOM ja estigui pintat.
  function scrollToLastHint() {
    requestAnimationFrame(() => {
      const el = root.querySelector('[data-role="last-hint"]');
      if (el && el.scrollIntoView) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    });
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

  // Copia el codi de verificació al porta-retalls amb feedback visual.
  function copyCode(btn, code) {
    // En clicar el codi, mostra la bombolla amb l'enllaç al Google Forms.
    // (Es revela sempre, encara que la còpia al porta-retalls falli.)
    const fb = root.querySelector('[data-role="forms-box"]');
    if (fb) fb.style.display = "";

    const done = () => {
      btn.classList.add("copied");
      const msg = btn.parentElement.querySelector('[data-role="copied-msg"]');
      if (msg) msg.classList.add("show");
      setTimeout(() => {
        btn.classList.remove("copied");
        if (msg) msg.classList.remove("show");
      }, 2500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(code).then(done, () => fallbackCopy(code, done));
    } else {
      fallbackCopy(code, done);
    }
  }

  function fallbackCopy(text, done) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      done();
    } catch (e) {
      /* sense porta-retalls: l'alumne pot seleccionar i copiar manualment */
    }
    ta.remove();
  }

  // ============================================================
  // ESDEVENIMENTS (delegació)
  // ============================================================
  root.addEventListener("click", function (ev) {
    const el = ev.target.closest("[data-action]");
    if (!el) return;
    const action = el.dataset.action;

    if (action === "toggle-menu") {
      menuOpen = !menuOpen;
      render();
      return;
    } else if (action === "pill") {
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
      // En obrir un problema, plega la hamburguesa: l'alumne vol veure
      // l'enunciat, no el menú.
      menuOpen = false;
      startProblem(sel ? sel.value : selectedPid);
    } else if (action === "start-next") {
      const nextPid = T.nextProblemId(state.problem.id);
      startProblem(nextPid);
    } else if (action === "nav-prev" || action === "nav-next") {
      const pid = el.dataset.pid;
      if (pid) startProblem(pid);
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
    } else if (action === "finish-session") {
      finishSession();
    } else if (action === "copy-code") {
      copyCode(el, el.dataset.code);
    } else if (action === "continue-practice") {
      continuePractice();
    } else if (action === "new-session") {
      newSession();
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
