# Gemini AI Agent setup

The AI Agent chat sends each saved conversation to Gemini from the Node.js server, then stores both the client command and Gemini reply in PostgreSQL.

1. Create a Gemini API key in Google AI Studio.
2. Copy `.env.example` to `.env`.
3. Add the key and restart the app:

```env
GEMINI_API_KEY=your_server_side_key
GEMINI_MODEL=gemini-2.5-flash
GEMINI_FALLBACK_MODELS=gemini-2.5-flash
```

Restart `npm start` after editing `.env`. The integration automatically falls back to `gemini-2.5-flash` when a configured newer model is unavailable. Never add the key to `public/app.js`, browser storage, or Git. When the key is missing, chat commands are still saved and the UI displays a setup error instead of exposing credentials.

---

# 🚀 Workflow-as-a-Service (WaaS) Aggregator — Detailed Build Roadmap

> **Core Promise**: "A button that does work." Abstract all AI complexity away from the end user. Sell *outcomes*, not tools.

---

## 🧠 Mental Model First

Before you write a line of code, internalize this distinction:

| AI Hub (what you're NOT building) | WaaS Platform (what you ARE building) |
|---|---|
| "Use GPT-4 here" | "Get your weekly marketing report done" |
| User stitches tools together | Platform stitches tools together |
| Sells access | Sells outcomes |
| Requires AI literacy | Requires zero AI knowledge |
| Commoditized, low margin | Defensible, high margin |

---

## 📐 Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                     USER LAYER (UI)                         │
│   Dashboard · Workflow Marketplace · Run History · Results  │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                  ORCHESTRATION LAYER                         │
│   Workflow Engine · DAG Runner · State Machine · Scheduler   │
└───────┬───────────────┬───────────────┬─────────────────────┘
        │               │               │
┌───────▼──┐     ┌──────▼──┐    ┌──────▼──────┐
│  MODEL   │     │  TOOL   │    │   DATA      │
│  ROUTER  │     │  LAYER  │    │   LAYER     │
│          │     │         │    │             │
│ Gemini   │     │Web Scrape│   │ User Files  │
│ GPT-4o   │     │Email    │    │ Integrations│
│ Claude   │     │Calendar │    │ Databases   │
│ DALL-E   │     │Sheets   │    │ APIs        │
│ Stable D │     │Notion   │    │             │
└──────────┘     └─────────┘    └─────────────┘
        │               │               │
┌───────▼───────────────▼───────────────▼─────────────────────┐
│              INFRASTRUCTURE LAYER                            │
│   Auth · Billing · Rate Limiting · Logging · Queue System   │
└─────────────────────────────────────────────────────────────┘
```

---

## 🗺️ Phase-by-Phase Roadmap

---

## Phase 0: Foundation & Research (Weeks 1–3)

### 0.1 Pick Your Niche (Critical Decision)
Don't build a general platform first. Pick ONE vertical and go deep.

**Ideal first niches** (high workflow pain, low AI literacy):
- 🥐 **Local food businesses** (bakeries, restaurants, cafes)
- 🏠 **Real estate agents** (listing descriptions, market reports)
- 🏋️ **Gyms / wellness studios** (class scheduling, member retention campaigns)
- 🛍️ **E-commerce SMBs** (product descriptions, ad copy, inventory alerts)
- 💇 **Salons / spas** (appointment reminders, review responses, promotions)

**How to choose**: Talk to 10 people in each vertical. Ask: *"What recurring tasks eat your week that you wish just... happened?"*

### 0.2 Map 5–10 "Golden Workflows"
These are the workflows you'll pre-build and sell. For a bakery, examples:

| Workflow Name | Steps Inside |
|---|---|
| Weekly Marketing Blast | Sales data → Insights → Flyer image → Email draft → Schedule send |
| Competitor Price Check | Scrape local menus → Compare prices → Recommend adjustments |
| Review Response Bot | Fetch new Google reviews → Draft personal replies → Post or queue |
| Low Stock Alert | Inventory input → AI-generated reorder suggestion → Supplier email |
| Social Content Week | Photo upload → Caption generation → Post schedule across platforms |

### 0.3 Tech Stack Decision

| Layer | Recommended Choice | Why |
|---|---|---|
| **Backend** | Python (FastAPI) or Node.js (Fastify) | Fast iteration, rich AI library support |
| **Workflow Engine** | [Temporal.io](https://temporal.io) or [Inngest](https://inngest.com) | Durable execution, retry logic, state management |
| **Frontend** | Next.js (React) | Fast dev, great ecosystem |
| **Database** | PostgreSQL + Redis | Relational data + fast job queues |
| **Queue** | BullMQ (Redis) or Temporal | Job scheduling and background tasks |
| **Auth** | Clerk or Auth0 | Fast auth, multi-tenant support |
| **Payments** | Stripe | Subscriptions + usage-based billing |
| **File Storage** | AWS S3 / Cloudflare R2 | Cheap object storage for user assets |
| **Hosting** | Railway / Render / Fly.io | Quick to start, scale when needed |

---

## Phase 1: The Execution Engine (Weeks 4–8)

This is your core moat. Everything else is built on top of this.

### 1.1 Build the Workflow DAG Runner

A workflow is a **Directed Acyclic Graph (DAG)** of steps. Each step has:
- An **input** (from user or previous step output)
- A **handler** (which model/tool to call)
- An **output** (passed to the next step)
- A **condition** (optional branching logic)

```python
# Example internal workflow definition (JSON/YAML)
{
  "workflow_id": "weekly_marketing",
  "name": "Weekly Marketing Blast",
  "steps": [
    {
      "id": "step_1",
      "name": "Analyze Sales",
      "type": "llm",
      "model": "gemini-1.5-pro",  # or "auto" for router
      "prompt_template": "Analyze this week's sales data: {{user.sales_csv}}. Return top 3 insights.",
      "output_key": "sales_insights"
    },
    {
      "id": "step_2",
      "name": "Generate Flyer",
      "type": "image_gen",
      "model": "dalle-3",
      "prompt_template": "Create a marketing flyer for a bakery promoting: {{step_1.sales_insights}}",
      "output_key": "flyer_image_url",
      "depends_on": ["step_1"]
    },
    {
      "id": "step_3",
      "name": "Draft Email",
      "type": "llm",
      "model": "gpt-4o-mini",
      "prompt_template": "Write a friendly weekly email for {{user.business_name}} using insights: {{step_1.sales_insights}}",
      "output_key": "email_draft",
      "depends_on": ["step_1"]
    },
    {
      "id": "step_4",
      "name": "Send Email",
      "type": "tool",
      "tool": "mailchimp_send",
      "inputs": { "content": "{{step_3.email_draft}}", "attachment": "{{step_2.flyer_image_url}}" },
      "depends_on": ["step_2", "step_3"]
    }
  ]
}
```

### 1.2 Build the Model Router

The router selects the best model per task based on:
- **Task type** (text, image, code, structured data)
- **Cost** (cheap model if quality threshold is met)
- **Speed** (user's chosen SLA)
- **Context window needed**
- **Capability flags** (vision, function calling, JSON mode)

```python
class ModelRouter:
    def select(self, task: Task) -> ModelConfig:
        if task.type == "image_generation":
            return ModelConfig("dalle-3") if task.quality == "high" else ModelConfig("sdxl")
        
        if task.type == "text" and task.context_tokens > 100_000:
            return ModelConfig("gemini-1.5-pro")  # long context
        
        if task.type == "text" and task.priority == "speed":
            return ModelConfig("gpt-4o-mini")  # fast + cheap
        
        if task.type == "reasoning":
            return ModelConfig("claude-3-5-sonnet")  # best reasoning
        
        return ModelConfig("gemini-1.5-flash")  # smart default
```

### 1.3 Build the Tool Layer

Tools are integrations that steps can call. Start with these:

| Priority | Tool | What it does |
|---|---|---|
| 🔴 Must-have | HTTP Request | Generic API calls |
| 🔴 Must-have | File Read/Write | Process user uploads |
| 🔴 Must-have | Web Scraper | Competitor/market data |
| 🟡 High value | Gmail / Outlook | Send emails |
| 🟡 High value | Google Sheets | Read/write business data |
| 🟡 High value | Mailchimp | Marketing campaigns |
| 🟢 Nice-to-have | Slack | Internal notifications |
| 🟢 Nice-to-have | Canva API | Graphic templates |
| 🟢 Nice-to-have | Google Calendar | Scheduling |

Use a **Tool Registry pattern**:
```python
tool_registry = {
    "web_scrape": WebScraperTool(),
    "send_email": EmailTool(),
    "read_sheet": GoogleSheetsTool(),
    "generate_image": ImageGenTool(),
    "http_request": HTTPTool(),
}
```

### 1.4 State Management & Durability
Use **Temporal.io** or **Inngest** so that:
- Workflows survive server restarts
- Failed steps auto-retry with backoff
- Long-running workflows (hours/days) work reliably
- You get full audit logs for free

---

## Phase 2: The User Experience (Weeks 9–13)

### 2.1 The "One Button" Dashboard

The entire UX philosophy: **make running a workflow feel like pressing play on Netflix**.

**Key UI screens:**

1. **Workflow Marketplace** — Browse pre-built workflows by category. Each has a description, estimated time, and "Run" button.
2. **Workflow Setup** — One-time onboarding: connect your Google account, upload your logo, enter your business name. Stored. Never asked again.
3. **Run History** — Timeline of every workflow run. Status (Running / Done / Error). Click to see full output.
4. **Results Viewer** — Show the actual output: the generated flyer, the email draft, the report. Let them download/approve/send.
5. **Schedule** — Set workflows to auto-run (weekly, daily, monthly).

### 2.2 Human-in-the-Loop (HITL) Steps
For sensitive actions (sending an email, posting to social media), add an **approval step**:
- Workflow pauses and sends the user a preview
- User clicks "Approve & Send" or "Edit"
- Workflow resumes

This builds trust and reduces errors.

### 2.3 Onboarding Flow
The onboarding should feel like answering 5 questions, not configuring a tool:

```
Welcome! Let's set up your first workflow.

1. What's your business name? [________]
2. What type of business? [Bakery ▼]
3. Connect your email: [Connect Gmail]
4. Upload your logo: [Upload File]
5. What's your biggest weekly headache? (select all that apply)
   ☐ Creating marketing content
   ☐ Responding to reviews
   ☐ Keeping track of competitors
   ☐ Writing product descriptions

→ [Generate My Workflows]
```

---

## Phase 3: The Business Model (Weeks 14–16)

### 3.1 Pricing Strategy

**Option A: Outcome-Based (Recommended)**
Charge per workflow run, not per month.
- "Run Weekly Marketing" = $4.99 per run
- Bundle: 10 runs/month = $39/month
- This ties your revenue directly to value delivered.

**Option B: Subscription Tiers**
- **Starter**: $29/month — 5 workflow runs/month, 3 workflows available
- **Growth**: $79/month — 25 runs/month, all workflows, priority queue
- **Pro**: $199/month — Unlimited runs, custom workflow builder, API access

**Option C: Hybrid (Best long-term)**
- Base subscription ($29/month) for access
- Credits ($0.10–$0.50 per step) consumed per run
- Top up credits like a prepaid card

### 3.2 Cost Structure (Know Your Unit Economics)

For a typical "Weekly Marketing" workflow:
| Step | Model | Est. Cost |
|---|---|---|
| Sales analysis | Gemini 1.5 Flash | ~$0.002 |
| Flyer generation | DALL-E 3 | ~$0.04 |
| Email draft | GPT-4o mini | ~$0.001 |
| Email send | Mailchimp API | ~$0.001 |
| **Total COGS** | | **~$0.045** |

If you charge $4.99 per run → **~99% gross margin** on AI costs. Infrastructure cuts this to ~85-90%, still excellent.

---

## Phase 4: Moat Building (Weeks 17–24)

### 4.1 The Workflow Marketplace (Platform Flywheel)
Open the platform to third-party workflow creators:
- Anyone can submit a workflow template
- Platform takes 30% revenue share
- Top workflows get featured placement
- Creates network effects: more workflows → more users → more creators

### 4.2 Business Context Memory
Store a growing profile of each business:
```
Business Profile for "Sarah's Bakery":
- Best-selling item: Sourdough ($340/week avg)
- Tone preference: Warm and friendly
- Brand colors: #F5A623, #FFFFFF
- Email open rate avg: 34%
- Competitor: "Corner Loaf" (scraped weekly)
- Peak sales day: Saturday
```
Each workflow run gets **smarter** because the AI has more context. This is a **compounding moat** — the longer they use your platform, the harder it is to leave.

### 4.3 The Custom Workflow Builder (No-Code)
A visual drag-and-drop editor where power users can:
- Chain steps together
- Set conditions ("If revenue < last week, run discount campaign")
- Define their own triggers (webhook, schedule, manual)
- Publish their workflow to the marketplace

This is your **enterprise/prosumer tier** unlock.

### 4.4 API Access (Developer Tier)
```bash
curl -X POST https://api.yourplatform.com/v1/workflows/weekly_marketing/run \
  -H "Authorization: Bearer YOUR_API_KEY" \
  -d '{"business_id": "biz_123", "trigger": "manual"}'
```
Lets agencies and developers embed your workflows in their own tools.

---

## Phase 5: Scale & Distribution (Month 6+)

### 5.1 Go-to-Market Strategy

**Week 1-4: Concierge Launch**
- Manually run workflows for your first 10 customers
- Don't build the platform yet — just do it by hand
- Learn what they actually need

**Month 2-3: Community Seeding**
- Local business Facebook groups
- Reddit (r/smallbusiness, r/entrepreneur)
- Product Hunt launch
- Partnerships with local business associations

**Month 4+: Content Moat**
- SEO content: "How bakeries can automate their marketing"
- YouTube: "I let AI run my bakery marketing for a month"
- Case studies: before/after for early customers

### 5.2 Vertical Expansion Playbook
Once you dominate one niche:
1. Identify which workflows transferred 80% unchanged to another vertical
2. Rebrand the landing page for that vertical
3. Repeat distribution strategy

Bakery → Restaurant → Cafe → Food Truck → Catering → All Food Businesses

---

## 🔧 Tech Build Order (Prioritized)

```
Sprint 1 (2 weeks): Core Engine
  ✅ Workflow DAG runner (hardcoded, no UI)
  ✅ 2 AI model integrations (Gemini + GPT-4o)
  ✅ 1 tool integration (web scraper)
  ✅ Run 1 workflow end-to-end via script

Sprint 2 (2 weeks): API Layer
  ✅ REST API for triggering workflows
  ✅ Job queue (BullMQ or Temporal)
  ✅ Basic auth (API keys)
  ✅ Result storage (S3 + Postgres)

Sprint 3 (2 weeks): Basic UI
  ✅ Login / signup
  ✅ Dashboard with 3 pre-built workflows
  ✅ "Run" button → shows result
  ✅ Run history

Sprint 4 (2 weeks): Billing & Onboarding
  ✅ Stripe integration
  ✅ Business profile setup
  ✅ Workflow scheduling (cron)
  ✅ Email notifications on completion

Sprint 5 (2 weeks): Polish & Launch
  ✅ Error handling + retries
  ✅ HITL approval steps
  ✅ Logging / monitoring (Datadog / Sentry)
  ✅ First 5 paid customers
```

---

## ⚠️ Critical Risks & Mitigations

| Risk | Likelihood | Mitigation |
|---|---|---|
| AI costs spike unexpectedly | Medium | Per-workflow cost caps; cheap model fallback |
| Workflow fails mid-run | High | Durable execution (Temporal); user gets partial results |
| Users don't trust AI output | High | HITL approval gates; confidence scores shown |
| Big players copy you | Medium | Vertical depth + business memory moat |
| Prompt injection attacks | Low-Medium | Sanitize all user inputs before template injection |
| API rate limits from AI providers | Medium | Multi-provider routing; request queuing |

---

## 🏁 Success Metrics to Track

| Metric | Target (Month 3) | Target (Month 6) |
|---|---|---|
| Paying customers | 25 | 150 |
| Workflows run / month | 200 | 2,000 |
| Workflow success rate | >90% | >95% |
| MRR | $1,500 | $12,000 |
| Average runs per customer/month | 8 | 13 |
| Customer churn rate | <10% | <5% |

---

## 🛠️ Recommended Starter Stack (Copy This)

```
Backend:       Python 3.12 + FastAPI
Workflow:      Temporal.io (self-hosted or cloud)
Frontend:      Next.js 14 + Tailwind CSS
Database:      PostgreSQL (Supabase for easy setup)
Cache/Queue:   Redis (Upstash for serverless)
Auth:          Clerk
Payments:      Stripe
File Storage:  Cloudflare R2
AI Models:     Gemini API + OpenAI API + Anthropic API
Web Scraping:  Playwright or Firecrawl
Email Tool:    Resend (for platform emails) + Gmail API (for user workflows)
Monitoring:    Sentry + Posthog
Hosting:       Railway (backend) + Vercel (frontend)
```

---

## 💡 The One Thing Most Builders Miss

> **The workflows ARE the product, not the engine.**

Most builders spend 80% of their time on the orchestration engine and 20% on workflows. It should be the opposite. Your engine can be simple. Your workflows must be **deeply specific, opinionated, and valuable**.

A generic "run any AI workflow" platform is invisible. A "Weekly Marketing Suite for Bakeries" is something a bakery owner will tell their friends about.

**Start with one workflow. Make it perfect. Then expand.**

---

## PostgreSQL, bcrypt, Google OAuth, and Discord OAuth

The app stores users in PostgreSQL. Password registrations use bcrypt hashes; plaintext passwords are never stored. Google and Discord identities are stored in a separate `oauth_accounts` table and linked to a user by verified email address. OAuth-only accounts keep `password_hash` as `NULL` rather than creating a fake local password.

### 1. Install and configure

1. Create a PostgreSQL database named `outcomeai`, or update `DATABASE_URL` for your database.
2. Keep your existing `.env` file and add the variables from `.env.oauth.example`.
3. Install dependencies and start the app:

```bash
npm install
npm start
```

The schema is applied automatically at startup. Existing installations are migrated so `users.password_hash` can be nullable for OAuth-only users.

### 2. Google OAuth setup

1. Create a Google Cloud OAuth client with application type **Web application**.
2. Add this exact authorized redirect URI for local development:

```text
http://localhost:3000/auth/google/callback
```

3. Put the generated values in `.env`:

```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
```

The app requests only `openid`, `email`, and `profile`, and it requires Google to return a verified email address.

### 3. Discord OAuth setup

1. Create an application in the Discord Developer Portal.
2. In OAuth2, add this exact redirect URI for local development:

```text
http://localhost:3000/auth/discord/callback
```

3. Put the application credentials in `.env`:

```env
DISCORD_CLIENT_ID=your-discord-client-id
DISCORD_CLIENT_SECRET=your-discord-client-secret
```

The app requests `identify` and `email` and requires Discord to return a verified email address.

### Production configuration

Set `APP_BASE_URL` to the public HTTPS origin, then register the matching callbacks with both providers:

```env
NODE_ENV=production
APP_BASE_URL=https://app.example.com
DATABASE_SSL=true
```

```text
https://app.example.com/auth/google/callback
https://app.example.com/auth/discord/callback
```

Keep OAuth client secrets only in environment variables. Do not commit `.env`. `APP_BASE_URL` must exactly match the origin used in the provider dashboards.

### Authentication behavior

- Email/password registration stores `username`, normalized `email`, and a bcrypt hash.
- Login compares the submitted password with `bcrypt.compare()`.
- Google and Discord callbacks use a short-lived, single-use OAuth `state` value.
- A verified provider email links to an existing user with that email, preventing duplicate accounts.
- Provider IDs are unique and stored in `oauth_accounts`.
- “Remember me” also applies to Google and Discord sign-in.
- `/dashboard` remains session protected and `/logout` invalidates the session.
- `/health` checks PostgreSQL connectivity.

For hosted PostgreSQL, set `DATABASE_SSL=true` when the provider requires TLS. Keep certificate verification enabled unless the provider explicitly documents otherwise.

Sessions and pending OAuth states are stored in memory in this working model. Use a shared session/state store such as Redis before running multiple application instances.

## Dashboard billing setup

The dashboard sidebar includes an **Upgrade** button with Free, Starter, Pro, and Business plans. Paid plans use a one-time checkout and activate access for 30 days after the server verifies the payment.

1. Copy the Razorpay Test Mode credentials into `.env`:

```env
RAZORPAY_KEY_ID=rzp_test_your_key_id
RAZORPAY_KEY_SECRET=your_test_key_secret
RAZORPAY_WEBHOOK_SECRET=your_long_random_webhook_secret
```

2. In Razorpay Dashboard, enable automatic payment capture. After deployment, create a webhook pointing to `https://your-domain.example/api/payments/razorpay/webhook`. Local checkout and server-side status reconciliation work without a public webhook URL.
3. Use the exact same value from `RAZORPAY_WEBHOOK_SECRET` as the webhook secret in the Razorpay Dashboard. Subscribe to `payment.authorized`, `payment.captured`, `payment.failed`, `order.paid`, `refund.created`, `refund.processed`, and `refund.failed`.
4. Add PayPal sandbox credentials as `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`, with `PAYPAL_MODE=sandbox`, only when PayPal is needed.
5. Restart the application. Database initialization automatically creates the billing, refund, and idempotent webhook-event tables.
6. Complete a Test Mode payment. The checkout callback verifies the payment signature immediately, while the signed webhook confirms the payment even if the browser is closed before the callback finishes.

Plan names, pricing, and features are centralized in `plans.js`. Razorpay amounts are stored in INR paise and PayPal amounts are stored in USD cents. The Razorpay Key Secret and webhook secret remain server-side; only the public Razorpay Key ID is sent to Checkout. Do not reuse the API Key Secret as the webhook secret.

## Persistent AI-agent chat history

The dashboard includes an **AI Agent** workspace and a ChatGPT-style recent-chat list in the sidebar. Conversations and every client command are stored in PostgreSQL in `chat_conversations` and `chat_messages`; the tables are created automatically when the server starts.

Authenticated endpoints:

- `GET /api/chats` and `POST /api/chats`
- `GET /api/chats/:id/messages` and `POST /api/chats/:id/messages`
- `PATCH /api/chats/:id` and `DELETE /api/chats/:id`

All reads and writes are scoped to the signed-in user. Deleting a user or conversation cascades to its stored messages.
