'use strict';

(() => {
    const CAPTCHA_REQUIRED_MESSAGE = 'Please complete the security verification and try again.';
    const CAPTCHA_UNAVAILABLE_MESSAGE = 'Security verification is temporarily unavailable. Please try again.';
    let widgetId = null;
    let container = null;
    let errorElement = null;
    let group = null;

    function setError(message) {
        if (!group || !errorElement) return;
        group.classList.add('has-error');
        errorElement.textContent = message;
    }

    function clearError() {
        if (!group || !errorElement) return;
        group.classList.remove('has-error');
        errorElement.textContent = '';
    }

    function getResponse() {
        if (widgetId === null || !window.hcaptcha || typeof window.hcaptcha.getResponse !== 'function') return '';
        return String(window.hcaptcha.getResponse(widgetId) || '').trim();
    }

    function validate() {
        if (!container || container.dataset.hcaptchaConfigured !== 'true') {
            setError(CAPTCHA_UNAVAILABLE_MESSAGE);
            return false;
        }
        if (!getResponse()) {
            setError(CAPTCHA_REQUIRED_MESSAGE);
            return false;
        }
        clearError();
        return true;
    }

    function reset() {
        if (widgetId !== null && window.hcaptcha && typeof window.hcaptcha.reset === 'function') {
            window.hcaptcha.reset(widgetId);
        }
        clearError();
    }

    window.OrexisAuthCaptcha = Object.freeze({ validate, clearError, reset, getResponse });

    window.orexisHcaptchaReady = () => {
        container = document.querySelector('[data-auth-hcaptcha]');
        group = document.getElementById('captchaGroup');
        errorElement = document.getElementById('captchaError');
        if (!container || !window.hcaptcha || container.dataset.hcaptchaConfigured !== 'true') return;

        const sitekey = String(container.dataset.sitekey || '').trim();
        if (!sitekey) {
            setError(CAPTCHA_UNAVAILABLE_MESSAGE);
            return;
        }

        widgetId = window.hcaptcha.render(container, {
            sitekey,
            theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
            size: window.matchMedia('(max-width: 380px)').matches ? 'compact' : 'normal',
            callback: clearError,
            'expired-callback': () => setError(CAPTCHA_REQUIRED_MESSAGE),
            'chalexpired-callback': () => setError(CAPTCHA_REQUIRED_MESSAGE),
            'error-callback': () => setError(CAPTCHA_UNAVAILABLE_MESSAGE)
        });
    };

    document.addEventListener('DOMContentLoaded', () => {
        container = document.querySelector('[data-auth-hcaptcha]');
        group = document.getElementById('captchaGroup');
        errorElement = document.getElementById('captchaError');
        const apiScript = document.getElementById('hcaptchaApi');
        apiScript?.addEventListener('error', () => setError(CAPTCHA_UNAVAILABLE_MESSAGE));
    });

    window.addEventListener('pageshow', (event) => {
        if (event.persisted) reset();
    });
})();
