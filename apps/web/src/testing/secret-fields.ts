/** What decides whether a browser or a password manager takes a field for a login password, and whether it is masked. */
export function toSecretMarkup(field: HTMLInputElement) {
    return {
        type: field.type,
        autocomplete: field.getAttribute('autocomplete'),
        isMasked: field.type === 'password' || field.classList.contains('[-webkit-text-security:disc]'),
        isIgnoredByManagers: field.hasAttribute('data-1p-ignore') && field.hasAttribute('data-bwignore'),
        textHelp: [field.getAttribute('spellcheck'), field.getAttribute('autocapitalize'), field.getAttribute('autocorrect')],
        isCopyBlocked: ['copy', 'cut', 'dragstart'].every((type) => !field.dispatchEvent(new Event(type, { bubbles: true, cancelable: true }))),
        formAutocomplete: field.form?.getAttribute('autocomplete') ?? null,
    };
}

/** A lock PIN or lock password: nothing a browser would save or fill as this site's login. */
export const LOCK_SECRET_MARKUP = {
    type: 'text',
    autocomplete: 'one-time-code',
    isMasked: true,
    isIgnoredByManagers: true,
    textHelp: ['false', 'none', 'off'],
    isCopyBlocked: true,
    formAutocomplete: 'off',
};

/** The account password: a password field that a password manager fills. */
export const ACCOUNT_PASSWORD_MARKUP = {
    type: 'password',
    autocomplete: 'current-password',
    isMasked: true,
    isIgnoredByManagers: false,
    textHelp: [null, null, null],
    isCopyBlocked: false,
    formAutocomplete: null,
};
