document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('loginForm');
    const emailInput = document.getElementById('email');
    const passwordInput = document.getElementById('password');
    const emailGroup = emailInput.closest('.form-group');
    const passwordGroup = passwordInput.closest('.form-group');
    const emailError = document.getElementById('emailError');
    const passwordError = document.getElementById('passwordError');
    const formError = document.getElementById('formError');
    const submitBtn = document.getElementById('submitBtn');
    const btnText = submitBtn.querySelector('.btn-text');
    const btnSpinner = submitBtn.querySelector('.btn-spinner');
    const togglePassword = document.getElementById('togglePassword');

    // If a session already exists, skip straight to the dashboard.
    if (sessionStorage.getItem('outcomeai_auth') === 'true') {
        window.location.href = 'index.html';
        return;
    }

    togglePassword.addEventListener('click', () => {
        const isPassword = passwordInput.type === 'password';
        passwordInput.type = isPassword ? 'text' : 'password';
        togglePassword.innerHTML = isPassword
            ? '<i class="fa-solid fa-eye-slash"></i>'
            : '<i class="fa-solid fa-eye"></i>';
        togglePassword.setAttribute('aria-label', isPassword ? 'Hide password' : 'Show password');
    });

    form.addEventListener('submit', (e) => {
        e.preventDefault();
        clearErrors();

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

        if (!isValid) return;

        setLoading(true);

        // Simulated authentication call. Wire this up to your real
        // auth endpoint (e.g. POST /api/login) when one is available.
        setTimeout(() => {
            authenticate(email, password)
                .then(() => {
                    const remember = document.getElementById('rememberMe').checked;
                    sessionStorage.setItem('outcomeai_auth', 'true');
                    sessionStorage.setItem('outcomeai_user_email', email);
                    if (remember) {
                        localStorage.setItem('outcomeai_remember_email', email);
                    }
                    window.location.href = 'index.html';
                })
                .catch((err) => {
                    setLoading(false);
                    formError.textContent = err.message || 'Unable to sign in. Please try again.';
                    formError.classList.add('visible');
                });
        }, 700);
    });

    // Pre-fill the email if the user previously checked "Remember me".
    const rememberedEmail = localStorage.getItem('outcomeai_remember_email');
    if (rememberedEmail) {
        emailInput.value = rememberedEmail;
        document.getElementById('rememberMe').checked = true;
    }

    function authenticate(email, password) {
        // Placeholder mock: accepts any well-formed email/password pair.
        // Replace with a real API call, e.g.:
        //
        // return fetch('/api/login', {
        //     method: 'POST',
        //     headers: { 'Content-Type': 'application/json' },
        //     body: JSON.stringify({ email, password })
        // }).then(res => {
        //     if (!res.ok) throw new Error('Invalid email or password.');
        //     return res.json();
        // });
        return new Promise((resolve, reject) => {
            if (isValidEmail(email) && password.length >= 8) {
                resolve({ email });
            } else {
                reject(new Error('Invalid email or password.'));
            }
        });
    }

    function isValidEmail(value) {
        return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
    }

    function showFieldError(group, errorEl, message) {
        group.classList.add('has-error');
        errorEl.textContent = message;
    }

    function clearErrors() {
        emailGroup.classList.remove('has-error');
        passwordGroup.classList.remove('has-error');
        emailError.textContent = '';
        passwordError.textContent = '';
        formError.textContent = '';
        formError.classList.remove('visible');
    }

    function setLoading(isLoading) {
        submitBtn.disabled = isLoading;
        btnText.textContent = isLoading ? 'Signing in...' : 'Sign In';
        btnSpinner.classList.toggle('hidden', !isLoading);
    }
});
