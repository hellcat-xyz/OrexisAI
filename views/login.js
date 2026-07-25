'use strict';

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderLoginPage({ error = '', success = '', email = '' } = {}) {
    const errorClass = error ? 'visible' : '';
    const successClass = success ? 'visible' : '';

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Sign In - OutcomeAI</title>
    <link rel="stylesheet" href="/style.css">
    <link rel="stylesheet" href="/login.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="auth-body">
    <main class="auth-container">
        <section class="auth-panel glass-panel" aria-labelledby="loginTitle">
            <div class="logo auth-logo">
                <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
                <span>OutcomeAI</span>
            </div>

            <h1 class="auth-title" id="loginTitle">Welcome back</h1>
            <p class="auth-subtitle">Sign in to keep your workflows running.</p>

            <form id="loginForm" class="auth-form" method="post" action="/login" novalidate>
                <div class="form-group" id="emailGroup">
                    <label for="email">Email</label>
                    <div class="input-wrapper">
                        <i class="fa-solid fa-envelope" aria-hidden="true"></i>
                        <input type="email" id="email" name="email" placeholder="you@company.com" autocomplete="email" maxlength="254" value="${escapeHtml(email)}" required autofocus>
                    </div>
                    <span class="field-error" id="emailError" aria-live="polite"></span>
                </div>

                <div class="form-group" id="passwordGroup">
                    <label for="password">Password</label>
                    <div class="input-wrapper">
                        <i class="fa-solid fa-lock" aria-hidden="true"></i>
                        <input type="password" id="password" name="password" placeholder="Enter your password" autocomplete="current-password" minlength="8" maxlength="72" required>
                        <button type="button" class="toggle-password" id="togglePassword" aria-label="Show password">
                            <i class="fa-solid fa-eye" aria-hidden="true"></i>
                        </button>
                    </div>
                    <span class="field-error" id="passwordError" aria-live="polite"></span>
                </div>

                <div class="form-row">
                    <label class="checkbox-label">
                        <input type="checkbox" id="rememberMe" name="rememberMe">
                        <span>Remember me</span>
                    </label>
                </div>

                <div class="form-error ${errorClass}" id="formError" role="alert">${escapeHtml(error)}</div>
                <div class="form-success ${successClass}" role="status">${escapeHtml(success)}</div>

                <button type="submit" class="auth-submit-btn" id="submitBtn">
                    <span class="btn-text">Sign In</span>
                    <i class="fa-solid fa-spinner fa-spin btn-spinner hidden" aria-hidden="true"></i>
                </button>
            </form>

            <p class="auth-footer">No account yet? <a href="/register">Create one</a></p>
        </section>
    </main>

    <script src="/login.js" defer></script>
</body>
</html>`;
}

module.exports = { renderLoginPage };
