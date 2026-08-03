'use strict';

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderForgotPasswordPage({ error = '', success = '', email = '' } = {}) {
    return renderAuthShell({
        title: 'Forgot password - OrexisAI',
        heading: 'Reset your password',
        subtitle: 'Enter your registered email and we’ll send a secure reset link.',
        error,
        success,
        body: `
            <form id="forgotPasswordForm" class="auth-form" method="post" action="/forgot-password" novalidate>
                <div class="form-group" id="emailGroup">
                    <label for="email">Email</label>
                    <div class="input-wrapper">
                        <i class="fa-solid fa-envelope" aria-hidden="true"></i>
                        <input type="email" id="email" name="email" placeholder="you@company.com" autocomplete="email" maxlength="254" value="${escapeHtml(email)}" required autofocus>
                    </div>
                    <span class="field-error" id="emailError" aria-live="polite"></span>
                </div>
                <button type="submit" class="auth-submit-btn" id="submitBtn">
                    <span class="btn-text">Send reset link</span>
                    <i class="fa-solid fa-spinner fa-spin btn-spinner hidden" aria-hidden="true"></i>
                </button>
            </form>`,
        footer: '<a href="/login"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Login</a>',
        script: '/password-recovery.js'
    });
}

function renderResetPasswordPage({ token = '', error = '', success = '', state = 'ready' } = {}) {
    const isReady = state === 'ready';
    const isSuccess = state === 'success';
    const body = isReady ? `
        <form id="resetPasswordForm" class="auth-form" method="post" action="/reset-password" novalidate>
            <input type="hidden" name="token" value="${escapeHtml(token)}">
            <div class="form-group" id="passwordGroup">
                <label for="password">New password</label>
                <div class="input-wrapper">
                    <i class="fa-solid fa-lock" aria-hidden="true"></i>
                    <input type="password" id="password" name="password" placeholder="Create a strong password" autocomplete="new-password" minlength="10" maxlength="72" required autofocus>
                    <button type="button" class="toggle-password" data-toggle-password="password" aria-label="Show password"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>
                </div>
                <span class="field-error" id="passwordError" aria-live="polite"></span>
                <span class="password-hint">Use 10+ characters with uppercase, lowercase, and a number.</span>
            </div>
            <div class="form-group" id="confirmPasswordGroup">
                <label for="confirmPassword">Confirm new password</label>
                <div class="input-wrapper">
                    <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
                    <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Repeat your new password" autocomplete="new-password" minlength="10" maxlength="72" required>
                    <button type="button" class="toggle-password" data-toggle-password="confirmPassword" aria-label="Show password"><i class="fa-solid fa-eye" aria-hidden="true"></i></button>
                </div>
                <span class="field-error" id="confirmPasswordError" aria-live="polite"></span>
            </div>
            <button type="submit" class="auth-submit-btn" id="submitBtn">
                <span class="btn-text">Update password</span>
                <i class="fa-solid fa-spinner fa-spin btn-spinner hidden" aria-hidden="true"></i>
            </button>
        </form>` : `
        <div class="recovery-state ${isSuccess ? 'success' : 'error'}">
            <i class="fa-solid ${isSuccess ? 'fa-circle-check' : 'fa-link-slash'}" aria-hidden="true"></i>
            <p>${escapeHtml(isSuccess ? success : error)}</p>
            <a class="auth-submit-btn recovery-action" href="${isSuccess ? '/login' : '/forgot-password'}">${isSuccess ? 'Return to Login' : 'Request a new link'}</a>
        </div>`;

    return renderAuthShell({
        title: 'Reset password - OrexisAI',
        heading: isSuccess ? 'Password updated' : state === 'ready' ? 'Choose a new password' : 'Reset link unavailable',
        subtitle: isSuccess ? 'Your password was changed securely.' : state === 'ready' ? 'This secure link can be used only once.' : 'The link may be invalid, expired, or already used.',
        error: state === 'ready' ? error : '',
        success: '',
        body,
        footer: isReady ? '<a href="/login"><i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Back to Login</a>' : '',
        script: isReady ? '/password-recovery.js' : ''
    });
}

function renderAuthShell({ title, heading, subtitle, error, success, body, footer, script }) {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/style.css">
    <link rel="stylesheet" href="/login.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="auth-body">
    <main class="auth-container">
        <section class="auth-panel glass-panel" aria-labelledby="recoveryTitle">
            <div class="logo auth-logo outcome-brand-lockup" aria-label="OrexisAI">
                <span class="outcome-brand-o" aria-hidden="true">O</span>
                <span class="outcome-brand-word-mask" aria-hidden="true"><span class="outcome-brand-word">rexis<span class="outcome-brand-ai">AI</span></span></span>
            </div>
            <h1 class="auth-title" id="recoveryTitle">${escapeHtml(heading)}</h1>
            <p class="auth-subtitle">${escapeHtml(subtitle)}</p>
            <div class="form-error ${error ? 'visible' : ''}" id="formError" role="alert">${escapeHtml(error)}</div>
            <div class="form-success ${success ? 'visible' : ''}" role="status">${escapeHtml(success)}</div>
            ${body}
            ${footer ? `<p class="auth-footer recovery-footer">${footer}</p>` : ''}
        </section>
    </main>
    ${script ? `<script src="${script}" defer></script>` : ''}
</body>
</html>`;
}

module.exports = { renderForgotPasswordPage, renderResetPasswordPage };
