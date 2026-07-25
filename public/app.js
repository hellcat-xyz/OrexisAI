'use strict';

document.addEventListener('DOMContentLoaded', () => {
    initializeWorkflows();
    initializeBilling();
});

function initializeWorkflows() {
    const runButtons = document.querySelectorAll('.run-btn');
    const modal = document.getElementById('executionModal');
    const closeModal = document.getElementById('closeModal');
    const closeResultBtn = document.getElementById('closeResultBtn');
    const stepsContainer = document.getElementById('executionSteps');
    const resultContainer = document.getElementById('executionResult');
    const workflowTitle = document.getElementById('workflowTitle');
    const spinner = document.querySelector('#executionModal .spinner');

    if (!modal || !closeModal || !closeResultBtn || !stepsContainer || !resultContainer || !workflowTitle || !spinner) {
        return;
    }

    const workflows = {
        marketing: {
            title: 'Running Weekly Marketing...',
            steps: [
                { title: 'Analyzing Sales Data', desc: 'Ingesting last 7 days of POS data to find top-selling items.', model: 'Data Analysis (Gemini 1.5 Pro)' },
                { title: 'Drafting Copy', desc: 'Writing engaging social media captions based on sales trends.', model: 'Text Generation (Gemini 1.5 Pro)' },
                { title: 'Generating Assets', desc: 'Creating custom flyer graphics for the top-selling pastries.', model: 'Image Generation (Imagen 3)' },
                { title: 'Checking Competitors', desc: 'Scraping local bakery prices to ensure competitive offers.', model: 'Web Scraping Agent' }
            ]
        },
        audit: {
            title: 'Running Competitor Audit...',
            steps: [
                { title: 'Identifying Competitors', desc: 'Finding bakeries within a 5-mile radius.', model: 'Search Agent' },
                { title: 'Scraping Menus', desc: 'Extracting pricing data from competitor websites.', model: 'Web Scraping Agent' },
                { title: 'Analyzing Price Gaps', desc: 'Comparing our prices vs market average.', model: 'Data Analysis (Gemini 1.5 Pro)' },
                { title: 'Generating Report', desc: 'Creating actionable pricing recommendations.', model: 'Text Generation (Gemini 1.5 Pro)' }
            ]
        },
        reviews: {
            title: 'Running Review Responder...',
            steps: [
                { title: 'Fetching Reviews', desc: 'Pulling new reviews from Google and Yelp.', model: 'API Integration Agent' },
                { title: 'Sentiment Analysis', desc: 'Categorizing reviews by positive, neutral, or negative.', model: 'Text Classification' },
                { title: 'Drafting Responses', desc: 'Writing personalized replies for each review.', model: 'Text Generation (Gemini 1.5 Pro)' }
            ]
        },
        inventory: {
            title: 'Running Inventory Predictor...',
            steps: [
                { title: 'Weather Forecast', desc: 'Retrieving 7-day weather forecast.', model: 'API Integration Agent' },
                { title: 'Historical Matching', desc: 'Finding similar past weeks in sales history.', model: 'Data Analysis (Gemini 1.5 Pro)' },
                { title: 'Generating Forecast', desc: 'Predicting flour, sugar, and butter needs.', model: 'Predictive Model' }
            ]
        }
    };

    let executionTimeout;
    let stepTimeouts = [];

    runButtons.forEach((button) => {
        button.addEventListener('click', () => startWorkflow(button.dataset.workflow));
    });
    closeModal.addEventListener('click', closeWorkflowModal);
    closeResultBtn.addEventListener('click', closeWorkflowModal);

    function startWorkflow(type) {
        const workflow = workflows[type];
        if (!workflow) return;

        workflowTitle.textContent = workflow.title;
        stepsContainer.innerHTML = '';
        stepsContainer.style.display = 'flex';
        resultContainer.classList.add('hidden');
        spinner.style.display = 'block';

        workflow.steps.forEach((step, index) => {
            const stepElement = document.createElement('div');
            stepElement.className = 'step';
            stepElement.id = `step-${index}`;
            stepElement.innerHTML = `
                <div class="step-icon"><i class="fa-solid fa-hourglass"></i></div>
                <div class="step-content">
                    <div class="step-title"></div>
                    <div class="step-desc"></div>
                    <div class="step-model"><i class="fa-solid fa-microchip"></i> <span></span></div>
                </div>`;
            stepElement.querySelector('.step-title').textContent = step.title;
            stepElement.querySelector('.step-desc').textContent = step.desc;
            stepElement.querySelector('.step-model span').textContent = step.model;
            stepsContainer.appendChild(stepElement);
        });

        openModal(modal);
        let totalDelay = 0;
        workflow.steps.forEach((step, index) => {
            const delay = totalDelay + 1500 + (Math.random() * 1000);
            stepTimeouts.push(setTimeout(() => activateStep(index), totalDelay));
            totalDelay = delay;
            stepTimeouts.push(setTimeout(() => completeStep(index), totalDelay));
        });

        executionTimeout = setTimeout(() => {
            stepsContainer.style.display = 'none';
            resultContainer.classList.remove('hidden');
            spinner.style.display = 'none';
            workflowTitle.textContent = 'Workflow Complete';
        }, totalDelay + 500);
    }

    function activateStep(index) {
        const step = document.getElementById(`step-${index}`);
        if (!step) return;
        step.classList.add('active');
        step.querySelector('.step-icon').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
    }

    function completeStep(index) {
        const step = document.getElementById(`step-${index}`);
        if (!step) return;
        step.classList.remove('active');
        step.classList.add('completed');
        step.querySelector('.step-icon').innerHTML = '<i class="fa-solid fa-check"></i>';
    }

    function closeWorkflowModal() {
        closeModalElement(modal);
        clearTimeout(executionTimeout);
        stepTimeouts.forEach(clearTimeout);
        stepTimeouts = [];
    }
}

function initializeBilling() {
    const upgradeButton = document.getElementById('upgradeButton');
    const upgradeModal = document.getElementById('upgradeModal');
    const closeUpgradeModal = document.getElementById('closeUpgradeModal');
    const paymentMessage = document.getElementById('paymentMessage');
    const razorpayButtons = document.querySelectorAll('.razorpay-pay-btn');
    const paypalSlots = document.querySelectorAll('.paypal-button-slot[data-plan-id]');

    if (!upgradeButton || !upgradeModal || !closeUpgradeModal || !paymentMessage) {
        return;
    }

    let paypalLoadingPromise;
    let paypalRendered = false;

    upgradeButton.addEventListener('click', async () => {
        openModal(upgradeModal);
        if (document.body.dataset.paypalConfigured === 'true' && !paypalRendered) {
            try {
                await renderPayPalButtons();
            } catch (error) {
                showPaymentMessage(error.message, 'error');
            }
        }
    });
    closeUpgradeModal.addEventListener('click', () => closeModalElement(upgradeModal));
    upgradeModal.addEventListener('click', (event) => {
        if (event.target === upgradeModal) closeModalElement(upgradeModal);
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && upgradeModal.classList.contains('active')) {
            closeModalElement(upgradeModal);
        }
    });

    razorpayButtons.forEach((button) => {
        button.addEventListener('click', () => startRazorpayCheckout(button));
    });

    async function startRazorpayCheckout(button) {
        const planId = button.dataset.planId;
        setButtonBusy(button, true, 'Opening Razorpay…');
        clearPaymentMessage();
        try {
            const order = await postJson('/api/payments/razorpay/order', { planId });
            await loadExternalScript('https://checkout.razorpay.com/v1/checkout.js', 'razorpay-checkout-sdk');
            if (typeof window.Razorpay !== 'function') {
                throw new Error('Razorpay Checkout could not be loaded.');
            }

            const checkout = new window.Razorpay({
                key: order.keyId,
                amount: order.amount,
                currency: order.currency,
                name: 'OutcomeAI',
                description: `${order.plan.name} plan - 30 days`,
                order_id: order.orderId,
                prefill: { email: document.body.dataset.userEmail || '' },
                theme: { color: '#6366f1' },
                handler: async (response) => {
                    try {
                        const result = await postJson('/api/payments/razorpay/verify', {
                            planId,
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature
                        });
                        paymentSucceeded(result.plan);
                    } catch (error) {
                        showPaymentMessage(error.message, 'error');
                    }
                },
                modal: {
                    ondismiss: () => showPaymentMessage('Razorpay checkout was closed. No plan changes were made.', 'neutral')
                }
            });
            checkout.on('payment.failed', (response) => {
                const message = response?.error?.description || 'Razorpay payment failed.';
                showPaymentMessage(message, 'error');
            });
            checkout.open();
        } catch (error) {
            showPaymentMessage(error.message, 'error');
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function renderPayPalButtons() {
        if (paypalRendered) return;
        if (!paypalLoadingPromise) {
            const clientId = document.body.dataset.paypalClientId;
            const sdkUrl = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
            paypalLoadingPromise = loadExternalScript(sdkUrl, 'paypal-checkout-sdk');
        }
        await paypalLoadingPromise;
        if (!window.paypal?.Buttons) {
            throw new Error('PayPal Checkout could not be loaded.');
        }

        for (const slot of paypalSlots) {
            const planId = slot.dataset.planId;
            slot.innerHTML = '';
            const buttons = window.paypal.Buttons({
                fundingSource: window.paypal.FUNDING.PAYPAL,
                style: { layout: 'vertical', shape: 'rect', height: 40, label: 'paypal' },
                createOrder: async () => {
                    clearPaymentMessage();
                    const order = await postJson('/api/payments/paypal/order', { planId });
                    return order.orderId;
                },
                onApprove: async (data) => {
                    const result = await postJson('/api/payments/paypal/capture', {
                        planId,
                        orderId: data.orderID
                    });
                    paymentSucceeded(result.plan);
                },
                onCancel: () => showPaymentMessage('PayPal checkout was cancelled. No plan changes were made.', 'neutral'),
                onError: (error) => {
                    console.error('PayPal checkout error:', error);
                    showPaymentMessage('PayPal could not complete the checkout. Please try again.', 'error');
                }
            });

            if (buttons.isEligible()) {
                await buttons.render(slot);
            } else {
                slot.innerHTML = '<button class="plan-disabled-btn" type="button" disabled>PayPal unavailable</button>';
            }
        }
        paypalRendered = true;
    }

    function paymentSucceeded(plan) {
        showPaymentMessage(`${plan.name} is now active on your account.`, 'success');
        document.getElementById('currentPlanName').textContent = `${plan.name} plan`;
        const pill = upgradeButton.querySelector('.upgrade-pill');
        if (pill) pill.textContent = plan.name;
        document.querySelectorAll('.plan-card').forEach((card) => {
            card.classList.toggle('current', card.dataset.planCard === plan.id);
        });
    }

    function showPaymentMessage(message, type) {
        paymentMessage.textContent = message;
        paymentMessage.className = `payment-message visible ${type}`;
    }

    function clearPaymentMessage() {
        paymentMessage.textContent = '';
        paymentMessage.className = 'payment-message';
    }
}

async function postJson(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    let value = {};
    try {
        value = await response.json();
    } catch {
        throw new Error('The server returned an invalid payment response.');
    }
    if (!response.ok) {
        throw new Error(value.error || 'Payment request failed.');
    }
    return value;
}

function loadExternalScript(src, id) {
    const existing = document.getElementById(id);
    if (existing) {
        if (existing.dataset.loaded === 'true') return Promise.resolve();
        return new Promise((resolve, reject) => {
            existing.addEventListener('load', resolve, { once: true });
            existing.addEventListener('error', () => reject(new Error('Payment checkout failed to load.')), { once: true });
        });
    }

    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.id = id;
        script.src = src;
        script.async = true;
        const cspNonce = document.body.dataset.cspNonce;
        if (cspNonce) {
            script.nonce = cspNonce;
            script.dataset.cspNonce = cspNonce;
        }
        script.addEventListener('load', () => {
            script.dataset.loaded = 'true';
            resolve();
        }, { once: true });
        script.addEventListener('error', () => reject(new Error('Payment checkout failed to load.')), { once: true });
        document.head.appendChild(script);
    });
}

function setButtonBusy(button, isBusy, busyText = 'Processing…') {
    if (isBusy) {
        button.dataset.originalText = button.innerHTML;
        button.disabled = true;
        button.textContent = busyText;
    } else {
        button.disabled = false;
        if (button.dataset.originalText) {
            button.innerHTML = button.dataset.originalText;
            delete button.dataset.originalText;
        }
    }
}

function openModal(modal) {
    modal.classList.add('active');
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('modal-open');
}

function closeModalElement(modal) {
    modal.classList.remove('active');
    modal.setAttribute('aria-hidden', 'true');
    if (!document.querySelector('.modal-overlay.active')) {
        document.body.classList.remove('modal-open');
    }
}
