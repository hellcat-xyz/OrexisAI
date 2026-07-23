'use strict';

document.addEventListener('DOMContentLoaded', () => {
    const runButtons = document.querySelectorAll('.run-btn');
    const modal = document.getElementById('executionModal');
    const closeModal = document.getElementById('closeModal');
    const closeResultBtn = document.getElementById('closeResultBtn');
    const stepsContainer = document.getElementById('executionSteps');
    const resultContainer = document.getElementById('executionResult');
    const workflowTitle = document.getElementById('workflowTitle');
    const spinner = document.querySelector('.spinner');

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

    runButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const type = btn.getAttribute('data-workflow');
            startWorkflow(type);
        });
    });

    closeModal.addEventListener('click', () => {
        closeWorkflowModal();
    });
    
    closeResultBtn.addEventListener('click', () => {
        closeWorkflowModal();
    });

    function startWorkflow(type) {
        const workflow = workflows[type];
        if (!workflow) return;

        workflowTitle.innerText = workflow.title;
        stepsContainer.innerHTML = '';
        stepsContainer.style.display = 'flex';
        resultContainer.classList.add('hidden');
        spinner.style.display = 'block';
        
        workflow.steps.forEach((step, index) => {
            const stepEl = document.createElement('div');
            stepEl.className = 'step';
            stepEl.id = `step-${index}`;
            stepEl.innerHTML = `
                <div class="step-icon"><i class="fa-solid fa-hourglass"></i></div>
                <div class="step-content">
                    <div class="step-title">${step.title}</div>
                    <div class="step-desc">${step.desc}</div>
                    <div class="step-model"><i class="fa-solid fa-microchip"></i> ${step.model}</div>
                </div>
            `;
            stepsContainer.appendChild(stepEl);
        });

        modal.classList.add('active');
        modal.setAttribute('aria-hidden', 'false');

        // Simulate execution
        let totalDelay = 0;
        workflow.steps.forEach((step, index) => {
            const delay = totalDelay + 1500 + (Math.random() * 1000); // 1.5-2.5 seconds per step
            
            stepTimeouts.push(setTimeout(() => {
                activateStep(index);
            }, totalDelay));

            totalDelay = delay;

            stepTimeouts.push(setTimeout(() => {
                completeStep(index);
            }, totalDelay));
        });

        // Show result
        executionTimeout = setTimeout(() => {
            stepsContainer.style.display = 'none';
            resultContainer.classList.remove('hidden');
            spinner.style.display = 'none';
            workflowTitle.innerText = 'Workflow Complete';
        }, totalDelay + 500);
    }

    function activateStep(index) {
        const step = document.getElementById(`step-${index}`);
        if(step) {
            step.classList.add('active');
            step.querySelector('.step-icon').innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i>';
        }
    }

    function completeStep(index) {
        const step = document.getElementById(`step-${index}`);
        if(step) {
            step.classList.remove('active');
            step.classList.add('completed');
            step.querySelector('.step-icon').innerHTML = '<i class="fa-solid fa-check"></i>';
        }
    }

    function closeWorkflowModal() {
        modal.classList.remove('active');
        modal.setAttribute('aria-hidden', 'true');
        clearTimeout(executionTimeout);
        stepTimeouts.forEach(t => clearTimeout(t));
        stepTimeouts = [];
    }
});
