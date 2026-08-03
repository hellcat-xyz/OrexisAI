'use strict';

document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('[data-toggle-password]').forEach((button) => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.togglePassword);
            if (!input) return;
            const hidden = input.type === 'password';
            input.type = hidden ? 'text' : 'password';
            button.innerHTML = hidden
                ? '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>'
                : '<i class="fa-solid fa-eye" aria-hidden="true"></i>';
            button.setAttribute('aria-label', hidden ? 'Hide password' : 'Show password');
        });
    });

    const forgotForm = document.getElementById('forgotPasswordForm');
    if (forgotForm) initializeForgotForm(forgotForm);

    const resetForm = document.getElementById('resetPasswordForm');
    if (resetForm) initializeResetForm(resetForm);
});

function initializeForgotForm(form) {
    const email = document.getElementById('email');
    const group = document.getElementById('emailGroup');
    const fieldError = document.getElementById('emailError');
    form.addEventListener('submit', (event) => {
        clearErrors();
        const value = email.value.trim();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) {
            event.preventDefault();
            showError(group, fieldError, value ? 'Enter a valid email address.' : 'Email is required.');
            return;
        }
        setLoading(form, true, 'Sending…', 'Send reset link');
    });
    window.addEventListener('pageshow', () => setLoading(form, false, 'Sending…', 'Send reset link'));
}

function initializeResetForm(form) {
    const password = document.getElementById('password');
    const confirmPassword = document.getElementById('confirmPassword');
    const passwordGroup = document.getElementById('passwordGroup');
    const confirmGroup = document.getElementById('confirmPasswordGroup');
    const passwordError = document.getElementById('passwordError');
    const confirmError = document.getElementById('confirmPasswordError');

    form.addEventListener('submit', (event) => {
        clearErrors();
        let valid = true;
        const strengthError = passwordStrengthError(password.value);
        if (strengthError) {
            showError(passwordGroup, passwordError, strengthError);
            valid = false;
        }
        if (password.value !== confirmPassword.value) {
            showError(confirmGroup, confirmError, 'Passwords do not match.');
            valid = false;
        }
        if (!valid) {
            event.preventDefault();
            return;
        }
        setLoading(form, true, 'Updating…', 'Update password');
    });
    window.addEventListener('pageshow', () => setLoading(form, false, 'Updating…', 'Update password'));
}

function passwordStrengthError(value) {
    if (!value) return 'Password is required.';
    if (Array.from(value).length < 10) return 'Use at least 10 characters.';
    if (new TextEncoder().encode(value).length > 72) return 'Password must be no more than 72 UTF-8 bytes.';
    if (!/[a-z]/.test(value) || !/[A-Z]/.test(value) || !/\d/.test(value)) {
        return 'Include uppercase, lowercase, and a number.';
    }
    return '';
}

function showError(group, field, message) {
    group?.classList.add('has-error');
    if (field) field.textContent = message;
}

function clearErrors() {
    document.querySelectorAll('.form-group.has-error').forEach((group) => group.classList.remove('has-error'));
    document.querySelectorAll('.field-error').forEach((field) => { field.textContent = ''; });
    const formError = document.getElementById('formError');
    if (formError) {
        formError.textContent = '';
        formError.classList.remove('visible');
    }
}

function setLoading(form, loading, loadingText, idleText) {
    const button = form.querySelector('#submitBtn');
    if (!button) return;
    button.disabled = loading;
    button.querySelector('.btn-text').textContent = loading ? loadingText : idleText;
    button.querySelector('.btn-spinner')?.classList.toggle('hidden', !loading);
}
