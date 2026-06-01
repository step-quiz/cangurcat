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
