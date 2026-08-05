'use strict';

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}

function renderRegisterPage({ error = '', username = '', email = '' } = {}) {
    const errorClass = error ? 'visible' : '';

    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <script src="/theme-bootstrap.js"></script>
    <title>Create Account - OrexisAI</title>
    <link rel="stylesheet" href="/style.css">
    <link rel="stylesheet" href="/login.css">
    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet">
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
</head>
<body class="auth-body">
    <main class="auth-container">
        <section class="auth-panel glass-panel" aria-labelledby="registerTitle">
            <div class="logo auth-logo">
                <i class="fa-solid fa-layer-group" aria-hidden="true"></i>
                <span>OrexisAI</span>
            </div>

            <h1 class="auth-title" id="registerTitle">Create your account</h1>
            <p class="auth-subtitle">Register with a username, email, and password.</p>

            <form id="registerForm" class="auth-form" method="post" action="/register" novalidate>
                <div class="form-group" id="usernameGroup">
                    <label for="username">Username</label>
                    <div class="input-wrapper">
                        <i class="fa-solid fa-user" aria-hidden="true"></i>
                        <input type="text" id="username" name="username" placeholder="your_username" autocomplete="username" minlength="3" maxlength="32" pattern="[A-Za-z0-9_]+" value="${escapeHtml(username)}" required autofocus>
                    </div>
                    <span class="field-error" id="usernameError" aria-live="polite"></span>
                </div>

                <div class="form-group" id="emailGroup">
                    <label for="email">Email</label>
                    <div class="input-wrapper">
                        <i class="fa-solid fa-envelope" aria-hidden="true"></i>
                        <input type="email" id="email" name="email" placeholder="you@company.com" autocomplete="email" maxlength="254" value="${escapeHtml(email)}" required>
                    </div>
                    <span class="field-error" id="emailError" aria-live="polite"></span>
                </div>

                <div class="form-group" id="passwordGroup">
                    <label for="password">Password</label>
                    <div class="input-wrapper">
                        <i class="fa-solid fa-lock" aria-hidden="true"></i>
                        <input type="password" id="password" name="password" placeholder="At least 8 characters" autocomplete="new-password" minlength="8" maxlength="72" required>
                        <button type="button" class="toggle-password" data-password-toggle="password" aria-label="Show password">
                            <i class="fa-solid fa-eye" aria-hidden="true"></i>
                        </button>
                    </div>
                    <span class="field-error" id="passwordError" aria-live="polite"></span>
                </div>

                <div class="form-group" id="confirmPasswordGroup">
                    <label for="confirmPassword">Confirm password</label>
                    <div class="input-wrapper">
                        <i class="fa-solid fa-shield-halved" aria-hidden="true"></i>
                        <input type="password" id="confirmPassword" name="confirmPassword" placeholder="Repeat your password" autocomplete="new-password" minlength="8" maxlength="72" required>
                        <button type="button" class="toggle-password" data-password-toggle="confirmPassword" aria-label="Show password">
                            <i class="fa-solid fa-eye" aria-hidden="true"></i>
                        </button>
                    </div>
                    <span class="field-error" id="confirmPasswordError" aria-live="polite"></span>
                </div>

                <div class="form-error ${errorClass}" id="formError" role="alert">${escapeHtml(error)}</div>

                <button type="submit" class="auth-submit-btn" id="submitBtn">
                    <span class="btn-text">Create Account</span>
                    <i class="fa-solid fa-spinner fa-spin btn-spinner hidden" aria-hidden="true"></i>
                </button>
            </form>

            <p class="auth-footer">Already registered? <a href="/login">Sign in</a></p>
        </section>
    </main>

    <script src="/register.js" defer></script>
</body>
</html>`;
}

module.exports = { renderRegisterPage };
