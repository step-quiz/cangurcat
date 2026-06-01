/*
 * tutor.js — Mirall fidel de tutor.py (la màquina d'estats).
 *
 * Mateixos noms de funcions i de camps que la versió Python, perquè
 * sigui evident que són paral·lels i fàcils de mantenir sincronitzats.
 * Tota la lògica DETERMINISTA (selecció, commit A-E, eliminades, pista
 * inicial del catàleg, rastre) viu aquí i NO necessita IA.
 *
 * Diferència tècnica respecte de Python: la comprovació de la lletra es
 * fa contra un HASH (la resposta en clar no és al client), de manera que
 * `processCommit` i `checkChoice` són asíncrones.
 */
window.Tutor = (function () {
  "use strict";

  // Constants — idèntiques a tutor.py
  const MIN_MESSAGE_CHARS = 2;
  const MAX_STUDENT_MESSAGES = 10;
  const VALID_LETTERS = ["A", "B", "C", "D", "E"];

  // ---- Catàleg (carregat des de data/problems.js) ----
  const _ALL = window.CANGUR_PROBLEMS || [];
  const _BY_ID = new Map(_ALL.map((p) => [p.id, p]));

  function getProblem(id) {
    return _BY_ID.get(id) || null;
  }

  function getAvailableProblems() {
    // L'array ja ve ordenat per id des de build_static.py.
    return _ALL.map((p) => p.id);
  }

  function getProblemsByPunts(punts) {
    return _ALL.filter((p) => p.punts === punts).map((p) => p.id);
  }

  // ---- Utils ----
  function _now() {
    return Date.now() / 1000; // segons, com time.time() de Python
  }

  function _randHex(nChars) {
    const bytes = new Uint8Array(Math.ceil(nChars / 2));
    crypto.getRandomValues(bytes);
    return [...bytes]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, nChars);
  }

  function _clone(obj) {
    // Anàleg de copy.deepcopy per a estats (objectes/arrays plans).
    return typeof structuredClone === "function"
      ? structuredClone(obj)
      : JSON.parse(JSON.stringify(obj));
  }

  async function _sha256Hex(str) {
    const buf = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(str)
    );
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  // Comprovació determinista de lletra (contra el hash; sense IA).
  async function checkChoice(letter, problem) {
    if (!letter || !problem || !problem.ans) return false;
    const l = String(letter).trim().toUpperCase();
    if (!VALID_LETTERS.includes(l)) return false;
    const h = await _sha256Hex(window.CANGUR_SALT + problem.id + l);
    return h === problem.ans;
  }

  // ---- Construcció d'un estat nou ----
  function newSessionState(problemId) {
    const problem = getProblem(problemId);
    if (problem === null) {
      throw new Error("Problema desconegut: " + problemId);
    }
    const sessionId = _randHex(12);
    return {
      session_id: sessionId,
      student_id: null,
      problem_id: problemId,
      problem: _clone(problem),
      started_at: new Date().toISOString(),
      started_at_ts: _now(),

      mode: "reasoning", // "reasoning" | "committing"
      eliminated_options: [],
      commit_letter: null,
      commit_attempts: [],

      conversation_history: [],
      pistes_count: 0,

      verdict_final: null, // null | "solved"

      messages: [],
      history: [],
    };
  }

  // ---- Helper de missatges flash UI ----
  function _pushMsg(state, kind, text, persistent = false) {
    state.messages.push({ kind, text, persistent, ts: _now() });
  }

  function _keepPersistent(state) {
    state.messages = state.messages.filter((m) => m.persistent);
  }

  // ---- Comptadors de missatges de l'alumne ----
  function countStudentMessages(state) {
    return (state.conversation_history || []).filter(
      (t) => t.kind === "message" && t.role === "user"
    ).length;
  }

  function messagesRemaining(state) {
    return Math.max(0, MAX_STUDENT_MESSAGES - countStudentMessages(state));
  }

  function canSendMessage(state) {
    return messagesRemaining(state) > 0;
  }

  // ---- Torn de diàleg (NECESSITA IA) ----
  async function processMessage(state, studentText) {
    state = _clone(state);
    _keepPersistent(state);

    if (state.verdict_final !== null) return state;

    if (!canSendMessage(state)) {
      _pushMsg(
        state,
        "warning",
        `Has fet servir els ${MAX_STUDENT_MESSAGES} missatges per a aquest ` +
          `problema. Pots demanar una pista o respondre amb el botó ` +
          `'Ja tinc la resposta' quan vulguis.`,
        true
      );
      return state;
    }

    const s = (studentText || "").trim();
    if (s.length < MIN_MESSAGE_CHARS) {
      _pushMsg(state, "warning", "El missatge és massa curt. Escriu una mica més.");
      return state;
    }

    const problem = state.problem;
    const priorConversation = [...state.conversation_history];

    state.conversation_history.push({
      role: "user",
      kind: "message",
      content: s,
      ts: _now(),
    });

    let aiText, aiMode;
    try {
      [aiText, aiMode] = await window.LLM.discuss(problem, priorConversation, s);
    } catch (e) {
      state.conversation_history.pop();
      if (e instanceof window.LLM.AIDisabledError) {
        _pushMsg(state, "info", e.message);
      } else {
        _pushMsg(state, "warning", "Error de connexió amb la IA: " + e.message);
      }
      return state;
    }

    state.conversation_history.push({
      role: "assistant",
      kind: "message",
      content: aiText,
      mode: aiMode,
      ts: _now(),
    });

    state.history.push({
      type: "discuss",
      student: s,
      ai_response: aiText,
      mode: aiMode,
      ts: _now(),
    });
    return state;
  }

  // ---- Demanar pista (catàleg gratis; següents NECESSITEN IA) ----
  async function requestHint(state) {
    state = _clone(state);
    _keepPersistent(state);

    if (state.verdict_final !== null) return state;

    const problem = state.problem;
    let hintText, source;

    if (state.pistes_count === 0 && problem.pista_inicial) {
      hintText = problem.pista_inicial;
      source = "catalog";
    } else {
      try {
        hintText = await window.LLM.generateHint(
          problem,
          state.conversation_history
        );
      } catch (e) {
        if (e instanceof window.LLM.AIDisabledError) {
          _pushMsg(state, "info", e.message);
        } else {
          _pushMsg(state, "warning", "Error en generar pista: " + e.message);
        }
        return state;
      }
      source = "ia";
    }

    state.conversation_history.push({
      role: "assistant",
      kind: "hint",
      content: hintText,
      source: source,
      ts: _now(),
    });
    state.pistes_count += 1;

    state.history.push({
      type: "hint",
      source: source,
      content: hintText,
      ts: _now(),
    });
    return state;
  }

  // ---- Commit d'una lletra (DETERMINISTA, sense IA) ----
  async function processCommit(state, letter) {
    state = _clone(state);
    _keepPersistent(state);

    if (state.verdict_final !== null) return state;

    const chosen = (letter || "").trim().toUpperCase();
    if (!VALID_LETTERS.includes(chosen)) {
      _pushMsg(
        state,
        "warning",
        `Lletra invàlida: ${letter}. Tria una de les opcions A-E.`
      );
      return state;
    }

    const correct = await checkChoice(chosen, state.problem);
    state.commit_attempts.push(chosen);
    state.history.push({
      type: "commit",
      letter: chosen,
      correct: correct,
      ts: _now(),
    });

    if (correct) {
      state.commit_letter = chosen;
      state.verdict_final = "solved";
      const nIntents = state.commit_attempts.length;
      if (nIntents === 1) {
        _pushMsg(
          state,
          "commit_ok",
          `🎉 Correcte! La resposta correcta és **${chosen}**. ` +
            `Ho has aconseguit a la primera. Molt bé!`
        );
      } else {
        _pushMsg(
          state,
          "commit_ok",
          `🎉 Correcte! La resposta correcta és **${chosen}**. ` +
            `Ho has aconseguit en ${nIntents} intents.`
        );
      }
      state.conversation_history.push({
        role: "user",
        kind: "system_event",
        content: `L'alumne ha comprovat la lletra ${chosen} i és correcta. Sessió completada.`,
        ts: _now(),
      });
      return state;
    }

    // Commit incorrecte
    if (!state.eliminated_options.includes(chosen)) {
      state.eliminated_options.push(chosen);
    }
    state.mode = "reasoning";

    state.conversation_history.push({
      role: "user",
      kind: "system_event",
      content:
        `L'alumne ha comprovat la lletra ${chosen} i el comprovador ` +
        `determinista ha indicat que no és correcta. L'alumne pot ` +
        `seguir raonant i tornar-ho a provar.`,
      ts: _now(),
    });

    const nIntents = state.commit_attempts.length;
    _pushMsg(
      state,
      "commit_fail",
      `❌ La lletra **${chosen}** no és correcta. ` +
        `Pots seguir raonant i tornar-ho a intentar. (Intents fets: ${nIntents}.)`,
      true
    );
    return state;
  }

  // ---- Transicions de mode ----
  function requestCommitMode(state) {
    state = _clone(state);
    if (state.verdict_final !== null) return state;
    state.mode = "committing";
    state.history.push({ type: "enter_commit_mode", ts: _now() });
    return state;
  }

  function cancelCommitMode(state) {
    state = _clone(state);
    if (state.verdict_final !== null) return state;
    state.mode = "reasoning";
    state.history.push({ type: "cancel_commit_mode", ts: _now() });
    return state;
  }

  // ---- Següent problema (mateix curs + any) ----
  function nextProblemId(currentPid) {
    const available = getAvailableProblems();
    const idx = available.indexOf(currentPid);
    if (idx === -1 || idx + 1 >= available.length) return null;
    const nxt = available[idx + 1];
    const cur = getProblem(currentPid);
    const np = getProblem(nxt);
    const sameCourse = np.categoria === cur.categoria && np.any === cur.any;
    return sameCourse ? nxt : null;
  }

  // ---- Rastre JSON per al professor ----
  function buildTrace(state) {
    const duration = _now() - state.started_at_ts;
    const problem = state.problem;

    let nPistesCatalog = 0;
    let nPistesIa = 0;
    for (const t of state.conversation_history) {
      if (t.kind === "hint") {
        if (t.source === "catalog") nPistesCatalog++;
        else nPistesIa++;
      }
    }

    const nDialegTurns = state.conversation_history.filter(
      (t) => t.kind === "message" && t.role === "user"
    ).length;

    const nModeS = state.conversation_history.filter(
      (t) => t.role === "assistant" && t.mode === "S"
    ).length;
    const nModeD = state.conversation_history.filter(
      (t) => t.role === "assistant" && t.mode === "D"
    ).length;

    let modeFinal = null;
    for (let i = state.conversation_history.length - 1; i >= 0; i--) {
      const t = state.conversation_history[i];
      if (t.role === "assistant" && "mode" in t) {
        modeFinal = t.mode;
        break;
      }
    }

    const nCommits = state.commit_attempts.length;
    return {
      session_id: state.session_id,
      problema: {
        id: state.problem_id,
        categoria: problem.categoria,
        any: problem.any,
        numero: problem.numero,
        punts: problem.punts,
        tema: problem.tema,
        imatge: problem.imatge,
        // La resposta correcta NO és al client en clar (només el hash).
        resposta_correcta: null,
      },
      started_at: state.started_at,
      durada_segons: Math.round(duration * 10) / 10,

      n_dialeg_turns: nDialegTurns,
      n_mode_S: nModeS,
      n_mode_D: nModeD,
      mode_final: modeFinal,
      conversation_history: state.conversation_history,

      n_pistes_total: state.pistes_count,
      n_pistes_catalog: nPistesCatalog,
      n_pistes_ia: nPistesIa,

      commit_attempts: [...state.commit_attempts],
      n_commits: nCommits,
      eliminated_options: [...state.eliminated_options],
      commit_letter_final: state.commit_letter,

      torns: state.history,

      veredicte_final: state.verdict_final || "en_curs",
    };
  }

  function serializeTrace(state) {
    return JSON.stringify(buildTrace(state), null, 2);
  }

  return {
    MIN_MESSAGE_CHARS,
    MAX_STUDENT_MESSAGES,
    VALID_LETTERS,
    getProblem,
    getAvailableProblems,
    getProblemsByPunts,
    checkChoice,
    newSessionState,
    countStudentMessages,
    messagesRemaining,
    canSendMessage,
    processMessage,
    requestHint,
    processCommit,
    requestCommitMode,
    cancelCommitMode,
    nextProblemId,
    buildTrace,
    serializeTrace,
  };
})();
