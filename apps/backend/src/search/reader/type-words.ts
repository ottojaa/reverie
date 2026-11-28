/** The words that name a file type, in English and Finnish. Listed form by form: stems would also match ordinary words. */
const TYPE_FORMS = {
    photo: [
        'photo photos picture pictures image images',
        'kuva kuvaa kuvan kuvat kuvia kuvien kuvasta kuvista kuvassa kuvissa kuvilta',
        'valokuva valokuvaa valokuvan valokuvat valokuvia valokuvien valokuvasta valokuvista valokuvassa valokuvissa',
    ],
    document: [
        'document documents doc docs',
        'dokumentti dokumenttia dokumentin dokumentit dokumentteja dokumenttien dokumentista dokumenteista dokumenteissa',
        'asiakirja asiakirjaa asiakirjan asiakirjat asiakirjoja asiakirjojen asiakirjasta asiakirjoista asiakirjoissa',
    ],
    receipt: ['receipt receipts', 'kuitti kuittia kuitin kuitit kuitteja kuittien kuitista kuiteista kuitissa kuiteissa kuitilta kuiteilta'],
    screenshot: [
        'screenshot screenshots screenshotit screenshotteja',
        'kuvakaappaus kuvakaappausta kuvakaappauksen kuvakaappaukset kuvakaappauksia kuvakaappausten kuvakaappauksista kuvakaappauksissa',
        'ruutukaappaus ruutukaappausta ruutukaappauksen ruutukaappaukset ruutukaappauksia ruutukaappauksista',
        'näyttökuva näyttökuvan näyttökuvat näyttökuvia näyttökuvista näyttökuvissa',
    ],
    video: ['video videos', 'videoa videon videot videoita videoiden videosta videoista videossa videoissa'],
};

/** Real words one letter away from a form above, which are therefore not typos of it. */
const NOT_TYPOS = new Set(
    'pictured imaged photon photons receipe receipes kuvata kuvasto kuvastaa kuvion valokuvata kuiten kiitti kiitin kiitit kuutti kuutin kuutit'.split(' '),
);

/** Shorter words are too close to other words for a typo to be told apart. */
const TYPO_MIN_LENGTH = 6;

const FORMS: ReadonlyMap<string, string> = new Map(
    Object.entries(TYPE_FORMS).flatMap(([type, lines]) => lines.flatMap((line) => line.split(' ')).map((form) => [form, type] as const)),
);

/** Whether one inserted, deleted or substituted letter turns `a` into `b`. */
function isOneLetterOff(a: string, b: string): boolean {
    if (a === b || Math.abs(a.length - b.length) > 1) return false;

    const at = [...a].findIndex((letter, i) => letter !== b[i]);
    const first = at === -1 ? a.length : at;
    const skipA = a.length >= b.length ? 1 : 0;
    const skipB = b.length >= a.length ? 1 : 0;

    return a.slice(first + skipA) === b.slice(first + skipB);
}

/** Whether `word` is `form` mistyped. A first letter is rarely wrong, and "luvassa" is not "kuvassa". */
function isTypoOf(word: string, form: string): boolean {
    return form.length >= TYPO_MIN_LENGTH && form[0] === word[0] && isOneLetterOff(word, form);
}

/** The file type a lowercase word names, allowing one typo in a long word; null for any other word. */
export function toTypeValue(word: string): string | null {
    const exact = FORMS.get(word);

    if (exact) return exact;

    if (NOT_TYPOS.has(word) || !/^\p{L}+$/u.test(word)) return null;

    const near = [...FORMS].filter(([form]) => isTypoOf(word, form));
    const [type, ...otherTypes] = new Set(near.map(([, value]) => value));

    return type && otherTypes.length === 0 ? type : null;
}
