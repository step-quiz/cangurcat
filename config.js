/*
 * config.js — Configuració del Tutor Cangur (web estàtica).
 *
 * Aquest és l'ÚNIC lloc que cal tocar per canviar el comportament global.
 * És l'equivalent del secret `ENABLE_AI` de Streamlit.
 */
window.CANGUR_CONFIG = {
  // "1" activa el diàleg amb la IA (xat + pistes generades on-demand),
  // exactament com ENABLE_AI=1 a la versió Streamlit. Per defecte "0":
  // la web funciona 100% sense IA (selecció, imatge, pista del catàleg,
  // comprovació A-E, rastre JSON).
  ENABLE_AI: "0",

  // Endpoint d'un proxy server-side que parla amb Gemini/Claude.
  // OBLIGATORI si ENABLE_AI="1". Un lloc estàtic NO pot guardar la API key
  // (s'exposaria al navegador), així que la crida ha de passar per un petit
  // backend (p.ex. una Cloud Function / Worker) que reutilitzi llm.py.
  // Exemple: "https://api.step-quiz.net/cangur/ai"
  AI_ENDPOINT: null,

  // Model (informatiu; es passa al proxy perquè decideixi).
  MODEL: "gemini-2.5-flash",
};
