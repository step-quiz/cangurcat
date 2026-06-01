/*
 * llm.js — Mirall de la porta `ENABLE_AI` de llm.py.
 *
 * Manté l'estructura per poder REACTIVAR la IA en el futur sense tocar
 * res més. Per defecte (ENABLE_AI != "1") qualsevol crida llança
 * AIDisabledError, exactament com a Python; la màquina d'estats (tutor.js)
 * ho captura i mostra un missatge amable, igual que tutor.py.
 *
 * Nota: en un lloc estàtic no es pot cridar Gemini directament (la API key
 * quedaria exposada). Quan ENABLE_AI="1", aquestes funcions criden un
 * AI_ENDPOINT (un proxy server-side que pot reutilitzar el llm.py original).
 * Per això, a diferència de Python, NO passem la ruta de la imatge: el
 * servidor la resol pel problem_id (té accés a data/).
 */
window.LLM = (function () {
  "use strict";

  const CFG = window.CANGUR_CONFIG || {};

  const AI_DISABLED_MSG =
    "Les crides a la IA estan desactivades en aquest desplegament. " +
    'Per activar-les, posa ENABLE_AI: "1" a config.js i configura un AI_ENDPOINT.';

  class AIDisabledError extends Error {
    constructor(message) {
      super(message);
      this.name = "AIDisabledError";
    }
  }

  function isAiEnabled() {
    return String(CFG.ENABLE_AI || "").trim() === "1";
  }

  function _requireEndpoint() {
    if (!CFG.AI_ENDPOINT) {
      throw new Error(
        'ENABLE_AI="1" però falta AI_ENDPOINT a config.js. Configura el ' +
          "proxy server-side que parla amb la IA."
      );
    }
  }

  async function _postAi(payload) {
    _requireEndpoint();
    const res = await fetch(CFG.AI_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error("El servidor de la IA ha respost amb estat " + res.status);
    }
    return res.json();
  }

  // Diàleg socràtic. Retorna [text, mode] (mode: "S" | "D" | null).
  async function discuss(problem, priorConversation, studentText) {
    if (!isAiEnabled()) throw new AIDisabledError(AI_DISABLED_MSG);
    const data = await _postAi({
      op: "discuss",
      problem_id: problem.id,
      conversation: priorConversation,
      message: studentText,
      model: CFG.MODEL,
    });
    return [data.text, data.mode ?? null];
  }

  // Pista generada on-demand. Retorna el text de la pista.
  async function generateHint(problem, conversation) {
    if (!isAiEnabled()) throw new AIDisabledError(AI_DISABLED_MSG);
    const data = await _postAi({
      op: "hint",
      problem_id: problem.id,
      conversation: conversation,
      model: CFG.MODEL,
    });
    return data.text;
  }

  return {
    AIDisabledError,
    AI_DISABLED_MSG,
    isAiEnabled,
    discuss,
    generateHint,
  };
})();
