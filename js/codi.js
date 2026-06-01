/*
 * codi.js — Codi de verificació del Tutor Cangur (format "CG").
 *
 * Mateixa filosofia que el projecte Step Quiz / Competències Bàsiques:
 * en acabar la sessió, l'alumne obté un codi compacte que copia i lliura
 * (via Google Form autenticat). El lloc estàtic NO guarda cap dada
 * personal; la privacitat queda al Google Form (domini educatiu).
 *
 * Reusa la lletra de control tipus DNI i el patró general del codi v2 de
 * Competències Bàsiques, però amb camps propis de Cangur (4 cursos +
 * pistes + durada de la sessió).
 *
 * FORMAT (10 segments separats per "-"):
 *
 *   {L}{salt}-{DDMM}-{HHMM}-CG-{curs}-{QQ}-{AA}-{PP}-{TTTTT}-{R(30)}
 *
 *   L       lletra de control (checksum tipus DNI, alfabet de 23 lletres)
 *   salt    cursChar + any2  → cursChar: a=1ESO, b=2ESO, c=3ESO, d=4ESO
 *                              any2: 2 últimes xifres de la CONVOCATÒRIA (ex. 26)
 *   DDMM    dia i mes reals de generació del codi
 *   HHMM    hora i minut reals de generació del codi
 *   CG      codi d'exercici (CanGur)
 *   curs    1..4  (1ESO..4ESO; redundant amb salt[0], llegible)
 *   QQ      nombre de problemes RESPOSTOS (amb ≥1 commit), 00-99
 *   AA      nombre d'ENCERTS (resolts), 00-99
 *   PP      nombre de PISTES demanades en total, 00-99
 *   TTTTT   DURADA de la sessió en segons (entrada → generació codi), 00000-99999
 *   R       30 xifres, una per problema (índex = numero-1 dins el curs/any):
 *               0 = no respost (cap commit)
 *               1-8 = resolt al N-è commit (1 = a la primera; topall 8)
 *               9 = respost (≥1 commit) però NO resolt
 *
 *   Errors (respostos i no resolts) = QQ − AA = nombre de '9' a R.
 *
 * El checksum es calcula sobre QQ+AA+PP+curs+dd+mm+hh+min+salt.charCodeAt(0),
 * de manera idèntica a l'analitzador (analitzador-cangur.html).
 */
window.Codi = (function () {
  "use strict";

  const LC = "TRWAGMYFPDXBNJZSQVHLCKE"; // mateix alfabet que Competències Bàsiques
  const EX_CODE = "CG";
  const CURS_CHARS = { "1ESO": "a", "2ESO": "b", "3ESO": "c", "4ESO": "d" };
  const CHAR_CURS = { a: "1ESO", b: "2ESO", c: "3ESO", d: "4ESO" };
  const CURS_LABEL = {
    "1ESO": "1r ESO",
    "2ESO": "2n ESO",
    "3ESO": "3r ESO",
    "4ESO": "4t ESO",
  };

  const pad = (n, w) => String(n).padStart(w, "0");
  const cap99 = (n) => Math.max(0, Math.min(99, n | 0));
  const cap8 = (n) => Math.max(1, Math.min(8, n | 0));

  function cursNum(curs) {
    return { "1ESO": 1, "2ESO": 2, "3ESO": 3, "4ESO": 4 }[curs] || 0;
  }

  function checksumLetter(qq, aa, pp, cnum, dd, mm, hh, min, saltChar0) {
    const suma = qq + aa + pp + cnum + dd + mm + hh + min + saltChar0;
    return LC.charAt(suma % 23);
  }

  /*
   * Construeix la cadena R (30 xifres) a partir dels registres de problemes
   * de la sessió. `problems` és un objecte { [numero]: {answered, solved,
   * solveCommits} }. numero va d'1 a 30.
   */
  function buildResults(problems) {
    const chars = [];
    for (let n = 1; n <= 30; n++) {
      const r = problems[n];
      if (!r || !r.answered) {
        chars.push("0");
      } else if (r.solved) {
        chars.push(String(cap8(r.solveCommits || 1)));
      } else {
        chars.push("9");
      }
    }
    return chars.join("");
  }

  /*
   * Genera el codi a partir de les mètriques de la sessió.
   *   m = { curs, any, problems, durationSec, now? }
   * Retorna { code, metrics } amb les mètriques agregades (per mostrar-les).
   */
  function generate(m) {
    const problems = m.problems || {};
    const results = buildResults(problems);

    // Agregats derivats dels registres (font única de veritat).
    let answered = 0,
      solved = 0,
      hints = 0;
    for (let n = 1; n <= 30; n++) {
      const r = problems[n];
      if (!r) continue;
      if (r.answered) answered++;
      if (r.solved) solved++;
      hints += r.hints || 0;
    }

    const cnum = cursNum(m.curs);
    const cursChar = CURS_CHARS[m.curs] || "a";
    const any2 = String(m.any).slice(-2);
    const salt = cursChar + any2;

    const now = m.now || new Date();
    const dd = pad(now.getDate(), 2);
    const mm = pad(now.getMonth() + 1, 2);
    const hh = pad(now.getHours(), 2);
    const min = pad(now.getMinutes(), 2);

    const qq = cap99(answered);
    const aa = cap99(solved);
    const pp = cap99(hints);
    const ttttt = pad(Math.max(0, Math.min(99999, Math.round(m.durationSec || 0))), 5);

    const lletra = checksumLetter(
      qq, aa, pp, cnum,
      parseInt(dd, 10), parseInt(mm, 10), parseInt(hh, 10), parseInt(min, 10),
      salt.charCodeAt(0)
    );

    const code = `${lletra}${salt}-${dd}${mm}-${hh}${min}-${EX_CODE}-${cnum}-${pad(
      qq, 2
    )}-${pad(aa, 2)}-${pad(pp, 2)}-${ttttt}-${results}`;

    return {
      code,
      metrics: {
        curs: m.curs,
        cursLabel: CURS_LABEL[m.curs] || m.curs,
        any: m.any,
        answered: qq,
        solved: aa,
        errors: qq - aa,
        hints: pp,
        durationSec: Math.round(m.durationSec || 0),
        results,
      },
    };
  }

  /*
   * Descodifica un codi CG. Retorna un objecte amb `valid`/`checksumOk` i els
   * camps. Idèntic a la lògica de l'analitzador (per garantir paritat).
   */
  function parse(raw) {
    if (!raw || !raw.trim()) return { format: "empty", valid: false, error: "Buit" };
    const code = raw.trim();
    const p = code.split("-");
    const ok10 =
      p.length === 10 &&
      /^[A-Z][a-d]\d{2}$/.test(p[0]) &&
      /^\d{4}$/.test(p[1]) &&
      /^\d{4}$/.test(p[2]) &&
      p[3] === "CG" &&
      /^[1-4]$/.test(p[4]) &&
      /^\d{2}$/.test(p[5]) &&
      /^\d{2}$/.test(p[6]) &&
      /^\d{2}$/.test(p[7]) &&
      /^\d{5}$/.test(p[8]) &&
      /^[0-9]{30}$/.test(p[9]);
    if (!ok10) {
      return { format: "unknown", valid: false, checksumOk: false, error: "Format desconegut" };
    }
    const ltr = p[0][0];
    const salt = p[0].slice(1);
    const cursChar = salt[0];
    const any2 = salt.slice(1);
    const dd = +p[1].slice(0, 2),
      mm = +p[1].slice(2, 4),
      hh = +p[2].slice(0, 2),
      mn = +p[2].slice(2, 4);
    const cnum = +p[4];
    const qq = +p[5],
      aa = +p[6],
      pp = +p[7],
      dur = +p[8];
    const results = p[9];
    const expected = checksumLetter(qq, aa, pp, cnum, dd, mm, hh, mn, salt.charCodeAt(0));
    const checksumOk = expected === ltr;

    return {
      format: "cg",
      valid: checksumOk,
      checksumOk,
      exerciseCode: "CG",
      exercise: "cangur",
      curs: CHAR_CURS[cursChar] || null,
      cursLabel: CURS_LABEL[CHAR_CURS[cursChar]] || null,
      any: /^\d{2}$/.test(any2) ? "20" + any2 : null,
      answered: qq,
      solved: aa,
      errors: qq - aa,
      hints: pp,
      durationSec: dur,
      results,
      resultsArray: results.split("").map(Number),
      day: dd,
      month: mm,
      hour: hh,
      minute: mn,
      error: checksumOk ? null : "Checksum invàlid",
    };
  }

  return { LC, EX_CODE, generate, parse, buildResults, CURS_LABEL };
})();
