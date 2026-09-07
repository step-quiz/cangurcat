# Tutor Cangur — web estàtica (HTML vainilla)

Versió **estàtica** del Tutor Cangur: HTML + CSS + JS purs, sense Streamlit
i sense servidor. Es desplega tal qual a qualsevol hosting estàtic (per
exemple `cangur.step-quiz.net`) i funciona directament.

La lògica de Python **es manté intacta**: aquesta web no la substitueix,
la complementa. El catàleg de problemes (`problems_*.py`) continua sent
l'**única font de veritat**.

---

## Què funciona sense IA (per defecte)

Tota l'experiència determinista, idèntica a la versió Streamlit amb
`ENABLE_AI=0`:

- Selecció de problema (filtres Curs / Any / Punts + desplegable).
- Imatge de l'enunciat i targeta d'opcions A–E.
- **Pista inicial del catàleg** (`pista_inicial`), sense cost.
- **Comprovació A–E determinista** (sense límit d'intents; les lletres
  fallides queden tatxades).
- Botó "següent problema" dins el mateix curs/any.
- **Rastre JSON** de la sessió, descarregable.

El que necessita IA (xat lliure i pistes generades on-demand) queda
desactivat amb un missatge amable, exactament com a Streamlit.

---

## Arquitectura DRY

```
problems_*.py  ─┐  (font de veritat: 480 problemes)
                │
                ▼
        build_static.py            ← importa `problems`, NO duplica res
                │
                ▼
   web/data/problems.js            ← dades generades per al navegador
   web/data/img/*.jpg              ← imatges copiades

web/
├── index.html        Punt d'entrada (mount + scripts en ordre)
├── config.js         Porta ENABLE_AI (equival al secret de Streamlit)
├── css/styles.css    Port fidel del CSS de app.py
├── js/
│   ├── llm.js         Mirall de la porta IA de llm.py (discuss / generate_hint)
│   ├── tutor.js       Mirall FIDEL de la màquina d'estats de tutor.py
│   └── app.js         Controlador de la UI (equival a app.py, sense domini)
└── data/
    ├── problems.js    GENERAT — no editar a mà
    └── img/           480 imatges dels enunciats
```

Correspondència directa Python ↔ JS (mateixos noms):

| Python (`tutor.py`)      | JS (`tutor.js`)        |
| ------------------------ | ---------------------- |
| `new_session_state`      | `newSessionState`      |
| `process_message`        | `processMessage`       |
| `request_hint`           | `requestHint`          |
| `process_commit`         | `processCommit`        |
| `request_commit_mode`    | `requestCommitMode`    |
| `cancel_commit_mode`     | `cancelCommitMode`     |
| `build_trace` / `serialize_trace` | `buildTrace` / `serializeTrace` |

---

## Com regenerar la web (després d'editar el catàleg)

Sempre que canviïs `problems_1eso.py … problems_4eso.py`, torna a executar:

```bash
python build_static.py
```

Opcions:

```bash
python build_static.py --output-dir web      # carpeta de sortida (per defecte: web)
python build_static.py --skip-images          # regenera només les dades
python build_static.py --salt EL_TEU_SALT      # fixa el salt del hash de respostes
```

---

## Com provar-ho en local

Cal servir la carpeta (un servidor estàtic qualsevol):

```bash
cd web
python -m http.server 8000
# obre http://localhost:8000
```

> També funciona obrint `index.html` directament (`file://`), perquè les
> dades viatgen com a `problems.js` (no com a `fetch` d'un JSON, que el
> navegador bloquejaria en local).

## Com desplegar a `cangur.step-quiz.net`

Puja el **contingut** de `web/` a l'arrel del hosting estàtic (Netlify,
Cloudflare Pages, GitHub Pages, S3, Nginx…). No cal cap pas de build al
servidor: els artefactes ja estan generats.

---

## Com reactivar la IA en el futur

Un lloc estàtic **no pot guardar la API key** (s'exposaria al navegador).
Per tant, reactivar el xat necessita un petit **proxy server-side** que
reutilitzi el teu `llm.py`. Un cop el tinguis:

1. A `config.js`, posa:
   ```js
   ENABLE_AI: "1",
   AI_ENDPOINT: "https://api.step-quiz.net/cangur/ai",
   ```
2. L'endpoint ha d'acceptar `POST` amb JSON:
   - `{ op: "discuss", problem_id, conversation, message, model }` → `{ text, mode }`
   - `{ op: "hint", problem_id, conversation, model }` → `{ text }`

   El servidor resol la imatge pel `problem_id` (té accés a `data/`) i
   crida `llm.discuss` / `llm.generate_hint`. Amb això, la columna de
   diàleg i les pistes IA tornen a aparèixer sense tocar res més del
   frontend.

---

## El compromís de la versió estàtica (important)

Sense servidor, la comprovació A–E s'ha de poder fer al navegador, així
que la **clau de respostes ha de viatjar al client**. Per evitar la
lectura casual de la solució:

- Les respostes s'envien com a **hash** `sha256(salt + id + lletra)`; la
  lletra correcta **no apareix en clar** a cap fitxer.
- S'**exclouen** del client els camps que serien "spoilers" i que només
  consumeix la IA al servidor: `expected_reasoning`,
  `comentaris_distractors`, `errors_típics`, `dependencies`.

Això atura el cop d'ull casual, però **no és a prova d'un alumne decidit**
(només hi ha 5 opcions i el salt és al JS). Per a integritat real
d'examen cal el backend amb IA, que es manté intacte i a punt per
reactivar.

> Nota menor: la versió Streamlit retallava un 5% els marges laterals
> blancs de cada imatge. Aquí es mostra la imatge sencera (més robust amb
> 480 imatges diferents). Es pot tornar a afegir al `build_static.py` si
> es vol.

---

## Codi de verificació i lliurament (Google Form)

En acabar la pràctica, l'alumne prem **🏁 Finalitzar i obtenir el codi** i
obté un **codi compacte** que copia i lliura mitjançant un **Google Form
autenticat** (domini educatiu). Així, aquest lloc estàtic **no gestiona ni
desa cap dada personal**: la privacitat queda sota la responsabilitat del
Google Form. És el mateix patró que el projecte de Competències Bàsiques.

La lògica del codi viu a `js/codi.js` (font única de l'especificació, que
**genera i descodifica** el codi amb la mateixa funció de control).

### Format del codi (`CG`, 10 segments)

```
{L}{salt}-{DDMM}-{HHMM}-CG-{curs}-{QQ}-{AA}-{PP}-{TTTTT}-{R(30)}
```

| Camp     | Significat                                                            |
| -------- | --------------------------------------------------------------------- |
| `L`      | lletra de control (checksum tipus DNI, alfabet de 23 lletres)         |
| `salt`   | `cursChar` + 2 últimes xifres de la **convocatòria** (a=1ESO…d=4ESO)  |
| `DDMM`   | dia i mes reals de generació del codi                                 |
| `HHMM`   | hora i minut reals de generació del codi                              |
| `CG`     | codi d'exercici (**C**an**G**ur)                                      |
| `curs`   | 1–4 (1ESO–4ESO; redundant amb el salt, però llegible)                 |
| `QQ`     | nombre de problemes **respostos** (amb almenys un commit)             |
| `AA`     | nombre d'**encerts** (resolts)                                        |
| `PP`     | nombre de **pistes** demanades en total                               |
| `TTTTT`  | **durada** de la sessió en segons (del 1r problema obert → codi)      |
| `R`      | 30 xifres, una per problema (índex = `numero`−1 dins el curs/any)     |

Codificació de cada xifra de `R`: `0` = no respost · `1`–`8` = resolt al
N-è commit (`1` = a la primera) · `9` = respost però no resolt. Els
**errors** són `QQ − AA` (= nombre de `9` a `R`).

> El checksum es calcula sobre `QQ+AA+PP+curs+dd+mm+hh+min+salt[0]` (mòdul
> 23). Igual que a Competències Bàsiques, **no cobreix la cadena `R`**; per
> això l'analitzador fa una **verificació creuada** addicional (comprova
> que els comptadors `QQ`/`AA` quadrin amb el detall per problema de `R`) i
> marca com a invàlid qualsevol codi manipulat.

### Acumulació de la sessió

La sessió **acumula tots els problemes d'un mateix curs + convocatòria**. El
rellotge arrenca quan s'obre el primer problema. Si l'alumne **canvia de
curs o de convocatòria**, la sessió es **reinicia**. Després de generar el
codi pot **seguir practicant** i tornar-lo a generar (s'actualitza), o
**començar una sessió nova**. Reobrir un problema ja fet no fa perdre
l'encert: un cop resolt, queda resolt.

---

## Analitzador (professorat) — `analitzador-cangur.html`

Eina **independent** i autònoma (un sol fitxer HTML, s'obre al navegador
sense servidor) per llegir el **CSV/TSV** que el Google Form ha bolcat amb
les respostes. Mostra una taula amb una fila per lliurament:

- **Estat** (✅ vàlid · ⚠️ sospitós · ❌ invàlid), **Dia** i **Hora** d'enviament, **Alumne**.
- **Curs**, **Convocatòria**, **Respostes**, **Encerts**, **Errors**, **Pistes**, **Durada**.
- **Δt**: minuts entre la generació del codi i l'enviament del formulari (senyal antifrau; ⚠️ si supera 15 min).
- **Resultats**: tira de 30 cel·les amb el detall per problema (desplega la fila per veure-la amb el número d'intent).

Filtres per alumne, curs, convocatòria, dia i estat; estadístiques
agregades; i **exportació** d'un CSV de resum. Cada fila es valida amb el
checksum **i** amb la verificació creuada de `R`.

> Es manté com a eina **separada** de l'analitzador de Competències
> Bàsiques (que té llicència CC BY-NC-ND i columnes diferents). La lògica de
> descodificació del codi és idèntica a `js/codi.js`, per garantir paritat.

<!-- atribucio-centre:inici -->

---

Material desenvolupat per **David Arso Civil** per al Departament de Matemàtiques de l'INS Miquel Tarradell.
Contingut sota CC BY-NC-SA 4.0, codi sota llicència MIT. Vegeu [`LLICENCIA.md`](LLICENCIA.md).

<!-- atribucio-centre:final -->
