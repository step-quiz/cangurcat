#!/usr/bin/env python3
"""
problemes.py — manté data/problems.js, el catàleg de problemes de cangurcat.

Fins al 18/10/2026, data/problems.js el generava build_static.py a partir dels
problems_*.py del repositori tutor-cangur. Aquell script no és a cap
repositori i tutor-cangur només tenia l'edició 2026, així que ara la font és
data/problems.js mateix, i aquesta eina és la manera d'afegir-hi problemes
sense editar-lo a mà. Només fa servir la biblioteca estàndard.

ORDRES
  python3 eines/problemes.py comprova
      Revisa el catàleg: ids únics i coherents amb categoria/any/número, punts
      3/4/5, imatge present a data/img/, 30 problemes per categoria i edició,
      i que cada resposta xifrada correspongui exactament a una lletra A–E.
      Surt amb codi 1 si hi ha cap error. GitHub l'executa (tests.yml).

  python3 eines/problemes.py plantilla 2027 > noves.csv
      Escriu un CSV buit d'una edició nova (4 categories × 30 problemes),
      amb les columnes que cal omplir.

  python3 eines/problemes.py afegeix noves.csv
      Afegeix els problemes del CSV (columnes: categoria, any, numero, punts,
      tema, resposta, pista_inicial). La imatge ha de ser a
      data/img/CAN-<categoria>-<any>-<NN>.jpg. La resposta es desa xifrada
      com la resta. No sobreescriu cap problema que ja hi sigui.

  python3 eines/problemes.py respostes 2026 [1ESO]
      Mostra les respostes d'una edició (per al professorat).

FORMAT
  data/problems.js = capçalera de comentari + window.CANGUR_SALT = "…";
  + window.CANGUR_PROBLEMS = [ …objectes JSON… ];  ordenats per categoria,
  any i número. La resposta de cada problema és ans = sha256(SALT + id +
  lletra), la mateixa comprovació que fa js/tutor.js. És dissuasiva, no
  secreta: amb el salt (públic) es pot recuperar provant les cinc lletres,
  que és el que fan «comprova» i «respostes».
"""
import csv
import hashlib
import json
import os
import re
import sys

ARREL = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FITXER = os.path.join(ARREL, 'data', 'problems.js')
IMATGES = os.path.join(ARREL, 'data', 'img')
CATEGORIES = ['1ESO', '2ESO', '3ESO', '4ESO']
LLETRES = 'ABCDE'
CAPCALERA = (
    "/* Catàleg de problemes de cangurcat. NO editar a mà: es manté amb\n"
    "   eines/problemes.py (comprova, afegeix, plantilla, respostes).\n"
    "   La resposta de cada problema és ans = sha256(CANGUR_SALT + id + lletra). */\n"
)
COLUMNES = ['categoria', 'any', 'numero', 'punts', 'tema', 'resposta', 'pista_inicial']


def llegeix():
    text = open(FITXER, encoding='utf-8').read()
    salt = re.search(r'window\.CANGUR_SALT = "([0-9a-f]+)";', text).group(1)
    inici = text.index('window.CANGUR_PROBLEMS = ') + len('window.CANGUR_PROBLEMS = ')
    problemes = json.loads(text[inici:text.rstrip().rstrip(';').__len__()])
    capcalera = text[:text.index('window.CANGUR_SALT')]
    return capcalera, salt, problemes


def escriu(capcalera, salt, problemes):
    problemes.sort(key=lambda p: (p['categoria'], p['any'], p['numero']))
    cos = json.dumps(problemes, ensure_ascii=False, separators=(',', ':'))
    with open(FITXER, 'w', encoding='utf-8') as f:
        f.write(f'{capcalera}window.CANGUR_SALT = "{salt}";\nwindow.CANGUR_PROBLEMS = {cos};\n')


def xifra(salt, ident, lletra):
    return hashlib.sha256((salt + ident + lletra).encode('utf-8')).hexdigest()


def resposta(salt, p):
    """La lletra que correspon al hash, o None si no n'hi ha exactament una."""
    bones = [l for l in LLETRES if xifra(salt, p['id'], l) == p['ans']]
    return bones[0] if len(bones) == 1 else None


def ident(categoria, any_, numero):
    return f'CAN-{categoria}-{any_}-{int(numero):02d}'


def comprova():
    _, salt, problemes = llegeix()
    errors, vistos, per_edicio = [], set(), {}
    for p in problemes:
        i = p.get('id', '?')
        if i in vistos:
            errors.append(f'{i}: id repetit')
        vistos.add(i)
        if i != ident(p['categoria'], p['any'], p['numero']):
            errors.append(f'{i}: no quadra amb categoria {p["categoria"]}, any {p["any"]}, número {p["numero"]}')
        if p['categoria'] not in CATEGORIES:
            errors.append(f'{i}: categoria desconeguda {p["categoria"]}')
        if p['punts'] not in (3, 4, 5):
            errors.append(f'{i}: punts {p["punts"]} (han de ser 3, 4 o 5)')
        if not os.path.exists(os.path.join(IMATGES, p['imatge'])):
            errors.append(f'{i}: falta la imatge data/img/{p["imatge"]}')
        if resposta(salt, p) is None:
            errors.append(f'{i}: la resposta xifrada no correspon a cap lletra A–E')
        per_edicio.setdefault((p['any'], p['categoria']), 0)
        per_edicio[(p['any'], p['categoria'])] += 1
    for (any_, cat), n in sorted(per_edicio.items()):
        if n != 30:
            errors.append(f'edició {any_} {cat}: {n} problemes (n\'hi hauria d\'haver 30)')
    anys = sorted({a for a, _ in per_edicio})
    if errors:
        print(f'✗ {len(errors)} errors al catàleg:')
        for e in errors:
            print('  -', e)
        return 1
    print(f'✓ {len(problemes)} problemes correctes ({len(anys)} edicions: {", ".join(map(str, anys))}).')
    return 0


def plantilla(any_):
    w = csv.writer(sys.stdout)
    w.writerow(COLUMNES)
    for cat in CATEGORIES:
        for n in range(1, 31):
            punts = 3 if n <= 10 else 4 if n <= 20 else 5
            w.writerow([cat, any_, n, punts, '', '', ''])
    return 0


def afegeix(cami_csv):
    capcalera, salt, problemes = llegeix()
    existents = {p['id'] for p in problemes}
    nous, errors = [], []
    with open(cami_csv, encoding='utf-8-sig', newline='') as f:
        for fila, r in enumerate(csv.DictReader(f), start=2):
            falten = [c for c in COLUMNES if not (r.get(c) or '').strip()]
            if falten:
                errors.append(f'fila {fila}: falten {", ".join(falten)}')
                continue
            cat, any_, num = r['categoria'].strip(), int(r['any']), int(r['numero'])
            lletra = r['resposta'].strip().upper()
            i = ident(cat, any_, num)
            if cat not in CATEGORIES:
                errors.append(f'fila {fila}: categoria {cat} (ha de ser {", ".join(CATEGORIES)})')
            if lletra not in LLETRES:
                errors.append(f'fila {fila}: resposta «{lletra}» (ha de ser A–E)')
            if int(r['punts']) not in (3, 4, 5):
                errors.append(f'fila {fila}: punts {r["punts"]} (han de ser 3, 4 o 5)')
            if i in existents:
                errors.append(f'fila {fila}: {i} ja és al catàleg (no se sobreescriu)')
            if not os.path.exists(os.path.join(IMATGES, i + '.jpg')):
                errors.append(f'fila {fila}: falta la imatge data/img/{i}.jpg')
            nous.append({
                'id': i, 'categoria': cat, 'any': any_, 'numero': num, 'punts': int(r['punts']),
                'tema': r['tema'].strip(), 'imatge': i + '.jpg', 'enunciat': None,
                'opcions': {l: None for l in LLETRES}, 'pista_inicial': r['pista_inicial'].strip(),
                'ans': xifra(salt, i, lletra),
            })
            existents.add(i)
    if errors:
        print(f'✗ No s\'ha afegit res. {len(errors)} errors:')
        for e in errors:
            print('  -', e)
        return 1
    escriu(capcalera, salt, problemes + nous)
    print(f'✓ Afegits {len(nous)} problemes. Ara: python3 eines/problemes.py comprova')
    return 0


def respostes(any_, categoria=None):
    _, salt, problemes = llegeix()
    for p in problemes:
        if p['any'] == any_ and (categoria is None or p['categoria'] == categoria):
            print(f'{p["id"]}  {resposta(salt, p) or "?"}')
    return 0


def main(args):
    if not args or args[0] in ('-h', '--help'):
        print(__doc__)
        return 0
    ordre = args[0]
    if ordre == 'comprova':
        return comprova()
    if ordre == 'plantilla' and len(args) == 2:
        return plantilla(int(args[1]))
    if ordre == 'afegeix' and len(args) == 2:
        return afegeix(args[1])
    if ordre == 'respostes' and len(args) in (2, 3):
        return respostes(int(args[1]), args[2] if len(args) == 3 else None)
    print(__doc__)
    return 2


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
