'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createWorkflowService } = require('../workflows/service');

function createDatabase(reviews) {
    const calls = [];
    return {
        calls,
        async getOrCreateBusinessForUser() {
            return { id: '7', name: 'Verified Store', currency: 'USD', timezone: 'UTC', role: 'owner' };
        },
        async createWorkflowRun({ workflow, input }) {
            return {
                id: '201',
                business_id: '7',
                workflow_slug: workflow.slug,
                workflow_name: workflow.name,
                status: 'queued',
                input,
                records_analyzed: 0,
                progress_percentage: 0,
                created_at: new Date().toISOString(),
                steps: workflow.steps.map((step, index) => ({
                    step_key: step.key,
                    step_title: step.title,
                    step_order: index,
                    status: 'queued'
                }))
            };
        },
        async updateWorkflowRun(input) {
            calls.push(['run', input.status]);
            return {
                id: String(input.runId),
                business_id: '7',
                workflow_slug: 'review-responder',
                workflow_name: 'Review Responder',
                status: input.status,
                output: input.output || null,
                error_message: input.errorMessage || null,
                records_analyzed: input.recordsAnalyzed || 0,
                progress_percentage: input.progressPercentage || 0,
                current_step: input.currentStep || null,
                created_at: new Date().toISOString(),
                started_at: new Date().toISOString(),
                completed_at: ['completed', 'failed'].includes(input.status) ? new Date().toISOString() : null
            };
        },
        async updateWorkflowStep(input) { return input; },
        async updateWorkflowProgress(input) { return input; },
        async appendWorkflowLog(input) { return { id: 1, ...input, created_at: new Date().toISOString() }; },
        async touchWorkflowRun() {},
        async getReviewResponderData() {
            return {
                business: { id: '7', name: 'Verified Store', currency: 'USD', timezone: 'UTC' },
                retrievedAt: new Date().toISOString(),
                reviews
            };
        },
        async saveReviewDrafts({ drafts }) {
            calls.push(['save-drafts', drafts]);
            return drafts;
        }
    };
}

const unavailableAi = {
    getPublicConfiguration() {
        return { isConfigured: false, model: 'gemini-test' };
    },
    async generateReply() {
        throw new Error('generateReply should not be called when AI is unavailable');
    }
};

test('review responder creates provider-safe deterministic drafts when Gemini is unavailable', async () => {
    const database = createDatabase([
        {
            id: '10',
            external_id: 'google-10',
            provider: 'Google Reviews',
            rating: '2',
            review_text: 'Delivery was late and support was slow to reply.',
            review_status: 'published',
            response_status: 'unanswered',
            published_at: '2026-09-01T10:00:00.000Z',
            source_url: 'https://example.com/reviews/10',
            customer_name: null
        },
        {
            id: '11',
            external_id: 'google-11',
            provider: 'Google Reviews',
            rating: '5',
            review_text: 'Great product and fast service. I would recommend it.',
            review_status: 'published',
            response_status: 'unanswered',
            published_at: '2026-09-02T10:00:00.000Z',
            source_url: 'https://example.com/reviews/11',
            customer_name: null
        }
    ]);
    const service = createWorkflowService({ database, geminiService: unavailableAi, env: {} });
    const result = await service.execute({ userId: '5', slug: 'review-responder', input: {} });

    assert.equal(result.run.status, 'completed');
    assert.equal(result.output.generationMode, 'deterministic-provider-safe');
    assert.equal(result.output.aiInsights.status, 'unavailable');
    assert.equal(result.output.aiInsights.fallbackUsed, true);
    assert.equal(result.output.responseDrafts.length, 2);
    assert.ok(result.output.responseDrafts.every((draft) => typeof draft.response === 'string' && draft.response.length > 20));
    assert.match(result.output.responseDrafts[0].response, /really sorry|frustrating/i);
    assert.match(result.output.responseDrafts[1].response, /5-star review|great experience/i);
    assert.equal(database.calls.find((call) => call[0] === 'save-drafts')[1].length, 2);
});

test('review responder still rejects an empty review source instead of fabricating reviews', async () => {
    const database = createDatabase([]);
    const service = createWorkflowService({ database, geminiService: unavailableAi, env: {} });
    await assert.rejects(
        () => service.execute({ userId: '5', slug: 'review-responder', input: {} }),
        (error) => error.code === 'REVIEW_DATA_UNAVAILABLE'
    );
});


test('review responder respects star rating, keeps text concerns, and produces distinct human replies for conflicting inputs', async () => {
    const sharedText = 'The delivery was late and the product packaging was damaged. Customer support took too long to reply.';
    const database = createDatabase([
        { id: '20', external_id: 'google-20', provider: 'Google Reviews', rating: '2', review_text: sharedText, review_status: 'published', response_status: 'unanswered', published_at: '2026-09-03T10:00:00.000Z', source_url: 'https://example.com/reviews/20', customer_name: null },
        { id: '21', external_id: 'google-21', provider: 'Google Reviews', rating: '5', review_text: sharedText, review_status: 'published', response_status: 'unanswered', published_at: '2026-09-04T10:00:00.000Z', source_url: 'https://example.com/reviews/21', customer_name: null }
    ]);
    const service = createWorkflowService({ database, geminiService: unavailableAi, env: {} });
    const result = await service.execute({ userId: '5', slug: 'review-responder', input: {} });

    const lowAnalysis = result.output.calculatedMetrics.find((item) => item.reviewId === 20);
    const highAnalysis = result.output.calculatedMetrics.find((item) => item.reviewId === 21);
    assert.equal(lowAnalysis.sentiment, 'negative');
    assert.equal(highAnalysis.sentiment, 'positive');
    assert.equal(highAnalysis.ratingTextConflict, true);
    assert.deepEqual(highAnalysis.issueDetails, ['delayed delivery', 'damaged packaging', 'slow support response']);

    const lowDraft = result.output.responseDrafts.find((item) => item.id === 20).response;
    const highDraft = result.output.responseDrafts.find((item) => item.id === 21).response;
    assert.notEqual(lowDraft, highDraft);
    assert.match(lowDraft, /really sorry/i);
    assert.match(lowDraft, /delayed delivery/i);
    assert.match(lowDraft, /damaged packaging/i);
    assert.match(lowDraft, /slow support response/i);
    assert.match(lowDraft, /additional details/i);
    assert.match(highDraft, /5-star rating/i);
    assert.match(highDraft, /truly appreciate your support/i);
    assert.match(highDraft, /do not want to brush those aside/i);
    assert.match(highDraft, /additional details/i);
});

test('review responder rejects duplicated robotic AI drafts and falls back to rating-aware human drafts', async () => {
    const database = createDatabase([
        { id: '30', external_id: 'google-30', provider: 'Google Reviews', rating: '2', review_text: 'Delivery was late and support was slow to reply.', review_status: 'published', response_status: 'unanswered', published_at: '2026-09-05T10:00:00.000Z', source_url: null, customer_name: null },
        { id: '31', external_id: 'google-31', provider: 'Google Reviews', rating: '5', review_text: 'Amazing quality and really fast delivery. I would recommend it.', review_status: 'published', response_status: 'unanswered', published_at: '2026-09-06T10:00:00.000Z', source_url: null, customer_name: null }
    ]);
    const roboticAi = {
        getPublicConfiguration() { return { isConfigured: true, model: 'gemini-test' }; },
        async generateReply() {
            return { model: 'gemini-test', content: JSON.stringify({ drafts: [
                { id: 30, externalId: 'google-30', response: 'Hello, thank you for sharing your feedback. We note your comments and appreciate the review.' },
                { id: 31, externalId: 'google-31', response: 'Hello, thank you for sharing your feedback. We note your comments and appreciate the review.' }
            ] }) };
        }
    };
    const service = createWorkflowService({ database, geminiService: roboticAi, env: {} });
    const result = await service.execute({ userId: '5', slug: 'review-responder', input: {} });

    assert.equal(result.output.generationMode, 'mixed');
    assert.equal(result.output.aiInsights.fallbackUsed, true);
    assert.notEqual(result.output.responseDrafts[0].response, result.output.responseDrafts[1].response);
    assert.match(result.output.responseDrafts[0].response, /really sorry/i);
    assert.match(result.output.responseDrafts[1].response, /5-star review|great experience/i);
});
