// public/js/register.js
//
// Live feedback on the Register page: as the player types, each password
// requirement turns green/red, and a mismatch warning appears if the
// confirm-password field doesn't match. This is UX only -- the real check
// happens server-side (server/utils/password.js), and these rules must be
// kept in sync with that file by hand since there's no bundler here to
// share one copy between server and browser.

document.addEventListener('DOMContentLoaded', () => {
    const password = document.getElementById('register-password');
    const confirmPassword = document.getElementById('register-confirm');
    const mismatchWarning = document.getElementById('confirm-mismatch');
    const requirementsList = document.getElementById('password-requirements');

    if (!password || !confirmPassword) return; // not on the Register page

    const requirements = [
        { id: 'req-length', test: (value) => value.length >= 6 },
        { id: 'req-upper', test: (value) => /[A-Z]/.test(value) },
        { id: 'req-number', test: (value) => /[0-9]/.test(value) },
        { id: 'req-special', test: (value) => /[^A-Za-z0-9]/.test(value) },
    ];

    function updateRequirements() {
        const value = password.value;
        for (const { id, test } of requirements) {
            const item = document.getElementById(id);
            const met = test(value);
            item.classList.toggle('text-danger', !met);
            item.classList.toggle('text-success', met);
        }
    }

    function updateMismatchWarning() {
        const typedConfirmation = confirmPassword.value.length > 0;
        mismatchWarning.hidden = !typedConfirmation || confirmPassword.value === password.value;
    }

    // Shown once the player focuses the field, so the page doesn't open
    // with four red bullet points before they've typed anything. It stays
    // visible after that -- useful as a running checklist, not something
    // that should vanish again if they tab away to Confirm Password.
    password.addEventListener('focus', () => {
        requirementsList.hidden = false;
    });

    password.addEventListener('input', () => {
        updateRequirements();
        updateMismatchWarning();
    });
    confirmPassword.addEventListener('input', updateMismatchWarning);
});