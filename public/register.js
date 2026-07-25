'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('registerForm');
    const usernameInput = document.getElementById('username');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const confirmPasswordInput = document.getElementById('confirmPassword');
    const formError = document.getElementById('formError');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnSpinner = submitBtn.querySelector('.btn-spinner');

    document.querySelectorAll('[data-password-toggle]').forEach((button) => {
        button.addEventListener('click', () => {
            const input = document.getElementById(button.dataset.passwordToggle);
            const isHidden = input.type === 'password';
            input.type = isHidden ? 'text' : 'password';
            button.innerHTML = isHidden
                ? '<i class="fa-solid fa-eye-slash" aria-hidden="true"></i>'
                : '<i class="fa-solid fa-eye" aria-hidden="true"></i>';
            button.setAttribute('aria-label', isHidden ? 'Hide password' : 'Show password');
        });
    });

    form.addEventListener('submit', (event) => {
        clearClientErrors();
        let isValid = true;
        const username = usernameInput.value.trim();
        const email = emailInput.value.trim();
        const password = passwordInput.value;
        const confirmPassword = confirmPasswordInput.value;

        if (!/^[A-Za-z0-9_]{3,32}$/.test(username)) {
            showFieldError('username', 'Username must be 3-32 letters, numbers, or underscores.');
            isValid = false;
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showFieldError('email', 'Enter a valid email address.');
            isValid = false;
        }

        if (password.length < 8) {
            showFieldError('password', 'Password must be at least 8 characters.');
            isValid = false;
        } else if (new TextEncoder().encode(password).length > 72) {
            showFieldError('password', 'Password must be no more than 72 UTF-8 bytes.');
            isValid = false;
        }

        if (confirmPassword !== password) {
            showFieldError('confirmPassword', 'Passwords do not match.');
            isValid = false;
        }

        if (!isValid) {
            event.preventDefault();
            return;
        }

        setLoading(true);
    });

    window.addEventListener('pageshow', () => setLoading(false));

    function showFieldError(fieldName, message) {
        document.getElementById(`${fieldName}Group`).classList.add('has-error');
        document.getElementById(`${fieldName}Error`).textContent = message;
    }

    function clearClientErrors() {
        ['username', 'email', 'password', 'confirmPassword'].forEach((fieldName) => {
            document.getElementById(`${fieldName}Group`).classList.remove('has-error');
            document.getElementById(`${fieldName}Error`).textContent = '';
        });
        formError.textContent = '';
        formError.classList.remove('visible');
    }

    function setLoading(isLoading) {
        submitBtn.disabled = isLoading;
        btnText.textContent = isLoading ? 'Creating account...' : 'Create Account';
        btnSpinner.classList.toggle('hidden', !isLoading);
    }
});
