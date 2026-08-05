'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const emailGroup = document.getElementById('emailGroup');
    const passwordGroup = document.getElementById('passwordGroup');
    const emailError = document.getElementById('emailError');
    const passwordError = document.getElementById('passwordError');
    const formError = document.getElementById('formError');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnSpinner = submitBtn.querySelector('.btn-spinner');
    const togglePassword = document.getElementById('togglePassword');
    const rememberMe = document.getElementById('rememberMe');
    const oauthButtons = document.querySelectorAll('[data-oauth-provider]');

    togglePassword.addEventListener('click', () => {
        const isPasswordHidden = passwordInput.type === 'password';
        passwordInput.type = isPasswordHidden ? 'text' : 'password';
        togglePassword.innerHTML = isPasswordHidden
            ? '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>'
            : '<i class="fa-solid fa-eye" aria-hidden="true"></i>';
        togglePassword.setAttribute('aria-label', isPasswordHidden ? 'Hide password' : 'Show password');
    });

    rememberMe.addEventListener('change', syncOAuthRememberPreference);
    syncOAuthRememberPreference();

    form.addEventListener('submit', (event) => {
        clearClientErrors();

        const email = emailInput.value.trim();
        const password = passwordInput.value;
        let isValid = true;

        if (!email) {
            showFieldError(emailGroup, emailError, 'Email is required.');
            isValid = false;
        } else if (!isValidEmail(email)) {
            showFieldError(emailGroup, emailError, 'Enter a valid email address.');
            isValid = false;
        }

        if (!password) {
            showFieldError(passwordGroup, passwordError, 'Password is required.');
            isValid = false;
        } else if (password.length < 8) {
            showFieldError(passwordGroup, passwordError, 'Password must be at least 8 characters.');
            isValid = false;
        }

        if (!window.OrexisAuthCaptcha?.validate()) {
            isValid = false;
        }

        if (!isValid) {
            event.preventDefault();
            return;
        }

        setLoading(true);
    });

    window.addEventListener('pageshow', () => setLoading(false));

    function syncOAuthRememberPreference() {
        oauthButtons.forEach((button) => {
            const provider = button.dataset.oauthProvider;
            button.href = rememberMe.checked ? `/auth/${provider}?remember=1` : `/auth/${provider}`;
        });
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    function showFieldError(group, errorElement, message) {
        group.classList.add('has-error');
        errorElement.textContent = message;
    }

    function clearClientErrors() {
        emailGroup.classList.remove('has-error');
        passwordGroup.classList.remove('has-error');
        emailError.textContent = '';
        passwordError.textContent = '';
        formError.textContent = '';
        formError.classList.remove('visible');
        window.OrexisAuthCaptcha?.clearError();
    }

    function setLoading(isLoading) {
        submitBtn.disabled = isLoading;
        btnText.textContent = isLoading ? 'Signing in...' : 'Sign In';
        btnSpinner.classList.toggle('hidden', !isLoading);
    }
});
