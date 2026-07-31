'use strict';

const VIEW_METADATA = Object.freeze({
    hub: {
        kicker: 'Outcome workspace',
        title: 'Ready-to-Run Outcomes',
        subtitle: 'Choose a business result. OrexisAI handles the models, tools, and routing behind it.',
        search: 'Search outcomes...'
    },
    agent: {
        kicker: 'AI agent',
        title: 'Command Center',
        subtitle: 'Give the agent a task and reopen every saved command from your conversation history.',
        search: 'Search this conversation...'
    },
    marketing: {
        kicker: 'Marketing workspace',
        title: 'Marketing Outcomes',
        subtitle: 'Launch complete campaigns and growth tasks without managing separate AI tools.',
        search: 'Search marketing outcomes...'
    },
    analytics: {
        kicker: 'Business intelligence',
        title: 'Analytics & Decisions',
        subtitle: 'See what changed, understand why, and turn the signal into a recommended action.',
        search: 'Search metrics and reports...'
    },
    crm: {
        kicker: 'Customer workspace',
        title: 'CRM Outcomes',
        subtitle: 'Move leads, follow-ups, and retention work forward with outcome-based automation.',
        search: 'Search customers and CRM outcomes...'
    },
    settings: {
        kicker: 'Account',
        title: 'Profile & Settings',
        subtitle: 'Manage your business context, workflow preferences, integrations, and billing.',
        search: 'Search settings...'
    }
});

const STORAGE_KEYS = Object.freeze({
    activeView: 'outcomeai.activeView',
    activeChat: 'outcomeai.activeChat',
    integrations: 'outcomeai.integrations',
    settings: 'outcomeai.workspaceSettings',
    sidebarCollapsed: 'outcomeai.sidebarCollapsed'
});

const ACCENT_PRESETS = Object.freeze({
    indigo: { base: '#6366f1', hover: '#4f46e5', rgb: '99, 102, 241', gradient: 'linear-gradient(135deg, #6366f1, #a855f7)' },
    blue: { base: '#3b82f6', hover: '#2563eb', rgb: '59, 130, 246', gradient: 'linear-gradient(135deg, #3b82f6, #06b6d4)' },
    emerald: { base: '#10b981', hover: '#059669', rgb: '16, 185, 129', gradient: 'linear-gradient(135deg, #10b981, #14b8a6)' },
    rose: { base: '#f43f5e', hover: '#e11d48', rgb: '244, 63, 94', gradient: 'linear-gradient(135deg, #f43f5e, #a855f7)' },
    amber: { base: '#f59e0b', hover: '#d97706', rgb: '245, 158, 11', gradient: 'linear-gradient(135deg, #f59e0b, #ef4444)' }
});

document.addEventListener('DOMContentLoaded', () => {
    initializeLoginBrandReveal();
    initializeSidebarNavigation();
    initializeWorkspaceSearch();
    initializeAgentChat();
    initializeWorkflows();
    initializeFeatureCardShaderAnimation();
    initializeSettings();
    initializeBilling();
});

function initializeFeatureCardShaderAnimation() {
    const cards = Array.from(document.querySelectorAll('.workflow-card'));
    if (cards.length === 0) return;

    const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const palettes = Object.freeze({
        'gradient-1': ['99, 102, 241', '168, 85, 247'],
        'gradient-2': ['16, 185, 129', '59, 130, 246'],
        'gradient-3': ['245, 158, 11', '239, 68, 68'],
        'gradient-4': ['236, 72, 153', '139, 92, 246']
    });

    cards.forEach((card, index) => {
        if (card.dataset.featureShaderReady === 'true') return;
        card.dataset.featureShaderReady = 'true';

        const icon = card.querySelector('.card-icon');
        const paletteName = Object.keys(palettes).find((name) => icon?.classList.contains(name));
        const [colorA, colorB] = palettes[paletteName] || palettes['gradient-1'];
        card.style.setProperty('--feature-shader-a', colorA);
        card.style.setProperty('--feature-shader-b', colorB);
        card.style.setProperty('--feature-shader-delay', `${-(index % 6) * 0.84}s`);

        let animationFrame = 0;
        let latestPointer = null;

        const resetPointer = () => {
            latestPointer = null;
            if (animationFrame) window.cancelAnimationFrame(animationFrame);
            animationFrame = 0;
            card.classList.remove('is-shader-active');
            card.style.setProperty('--feature-pointer-x', '50%');
            card.style.setProperty('--feature-pointer-y', '50%');
            card.style.setProperty('--feature-tilt-x', '0deg');
            card.style.setProperty('--feature-tilt-y', '0deg');
        };

        const renderPointer = () => {
            animationFrame = 0;
            if (!latestPointer || prefersReducedMotion.matches || document.documentElement.dataset.motion === 'reduced') {
                return;
            }

            const rect = card.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;
            const x = Math.min(1, Math.max(0, (latestPointer.clientX - rect.left) / rect.width));
            const y = Math.min(1, Math.max(0, (latestPointer.clientY - rect.top) / rect.height));
            const tiltX = (0.5 - y) * 4.2;
            const tiltY = (x - 0.5) * 5.2;

            card.style.setProperty('--feature-pointer-x', `${(x * 100).toFixed(2)}%`);
            card.style.setProperty('--feature-pointer-y', `${(y * 100).toFixed(2)}%`);
            card.style.setProperty('--feature-tilt-x', `${tiltX.toFixed(2)}deg`);
            card.style.setProperty('--feature-tilt-y', `${tiltY.toFixed(2)}deg`);
        };

        const queuePointerRender = (event) => {
            if (event.pointerType === 'touch') return;
            latestPointer = event;
            card.classList.add('is-shader-active');
            if (!animationFrame) animationFrame = window.requestAnimationFrame(renderPointer);
        };

        card.addEventListener('pointerenter', queuePointerRender, { passive: true });
        card.addEventListener('pointermove', queuePointerRender, { passive: true });
        card.addEventListener('pointerleave', resetPointer, { passive: true });
        card.addEventListener('pointercancel', resetPointer, { passive: true });
        card.addEventListener('focusin', () => card.classList.add('is-shader-active'));
        card.addEventListener('focusout', (event) => {
            if (!card.contains(event.relatedTarget)) resetPointer();
        });
        prefersReducedMotion.addEventListener?.('change', resetPointer);
    });
}

function initializeLoginBrandReveal() {
    const intro = document.getElementById('loginBrandIntro');
    const skipButton = document.getElementById('loginBrandSkip');
    if (!intro) return;

    let removed = false;
    let removalTimer = null;
    document.body.classList.add('login-intro-active');

    const removeIntro = () => {
        if (removed) return;
        removed = true;
        window.clearTimeout(removalTimer);
        intro.remove();
        document.body.classList.remove('login-intro-active');
        document.removeEventListener('keydown', handleKeydown);
    };

    const skipIntro = () => {
        if (removed || intro.classList.contains('is-skipping')) return;
        intro.classList.add('is-skipping');
        window.setTimeout(removeIntro, 240);
    };

    const handleKeydown = (event) => {
        if (event.key === 'Escape') {
            event.preventDefault();
            skipIntro();
        }
    };

    intro.addEventListener('animationend', (event) => {
        if (event.target === intro && event.animationName === 'outcome-login-intro-exit') {
            removeIntro();
        }
    });
    skipButton?.addEventListener('click', skipIntro);
    document.addEventListener('keydown', handleKeydown);
    removalTimer = window.setTimeout(removeIntro, 3600);
}

function initializeSidebarNavigation() {
    const sidebar = document.getElementById('sidebar');
    const sidebarToggle = document.getElementById('sidebarToggle');
    const profileButton = document.getElementById('profileButton');
    const profileMenu = document.getElementById('profileMenu');
    const pageKicker = document.getElementById('pageKicker');
    const pageTitle = document.getElementById('pageTitle');
    const pageSubtitle = document.getElementById('pageSubtitle');
    const searchInput = document.getElementById('workspaceSearch');
    const views = Array.from(document.querySelectorAll('.dashboard-view[data-view]'));
    const viewTriggers = Array.from(document.querySelectorAll('[data-view-target]'));
    const primaryNavItems = Array.from(document.querySelectorAll('.nav-menu [data-view-target]'));

    if (!sidebar || !sidebarToggle || !profileButton || !profileMenu || !pageKicker || !pageTitle || !pageSubtitle || !searchInput || views.length === 0) {
        return;
    }

    const availableViews = new Set(views.map((view) => view.dataset.view));
    const savedSettings = safeJsonParse(safeStorageGet(STORAGE_KEYS.settings), {});
    const savedView = safeStorageGet(STORAGE_KEYS.activeView);
    const preferredView = availableViews.has(savedSettings.defaultWorkspace) ? savedSettings.defaultWorkspace : savedView;
    const initialView = availableViews.has(preferredView) ? preferredView : 'hub';
    const savedCollapsedState = safeStorageGet(STORAGE_KEYS.sidebarCollapsed);
    const collapsed = typeof savedSettings.sidebarDefaultCollapsed === 'boolean'
        ? savedSettings.sidebarDefaultCollapsed
        : savedCollapsedState === 'true';

    setSidebarCollapsed(collapsed);
    activateView(initialView, false);

    sidebarToggle.addEventListener('click', () => {
        setSidebarCollapsed(!sidebar.classList.contains('collapsed'));
    });

    viewTriggers.forEach((trigger) => {
        trigger.addEventListener('click', () => activateView(trigger.dataset.viewTarget, true));
    });

    profileButton.addEventListener('click', (event) => {
        event.stopPropagation();
        setProfileMenuOpen(profileMenu.getAttribute('aria-hidden') === 'true');
    });

    profileMenu.addEventListener('click', (event) => event.stopPropagation());
    document.addEventListener('click', () => setProfileMenuOpen(false));
    document.addEventListener('outcomeai:close-profile-menu', () => setProfileMenuOpen(false));
    document.addEventListener('outcomeai:navigate', (event) => {
        if (availableViews.has(event.detail?.view)) activateView(event.detail.view, true);
    });
    document.addEventListener('outcomeai:set-sidebar-collapsed', (event) => {
        setSidebarCollapsed(Boolean(event.detail?.collapsed));
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') setProfileMenuOpen(false);
    });

    function activateView(viewName, shouldFocus) {
        if (!availableViews.has(viewName)) return;
        const metadata = VIEW_METADATA[viewName] || VIEW_METADATA.hub;

        views.forEach((view) => {
            const isActive = view.dataset.view === viewName;
            view.classList.toggle('active', isActive);
            view.hidden = !isActive;
        });
        primaryNavItems.forEach((item) => {
            const isActive = item.dataset.viewTarget === viewName;
            item.classList.toggle('active', isActive);
            if (isActive) item.setAttribute('aria-current', 'page');
            else item.removeAttribute('aria-current');
        });

        pageKicker.textContent = metadata.kicker;
        pageTitle.textContent = metadata.title;
        pageSubtitle.textContent = metadata.subtitle;
        searchInput.placeholder = metadata.search;
        searchInput.value = '';
        searchInput.dispatchEvent(new Event('input'));
        safeStorageSet(STORAGE_KEYS.activeView, viewName);
        setProfileMenuOpen(false);
        document.dispatchEvent(new CustomEvent('outcomeai:view-changed', { detail: { view: viewName } }));

        const mainContent = document.querySelector('.main-content');
        if (mainContent) mainContent.scrollTo({ top: 0, behavior: shouldFocus ? 'smooth' : 'auto' });
        if (shouldFocus) pageTitle.focus?.({ preventScroll: true });
    }

    function setSidebarCollapsed(isCollapsed) {
        sidebar.classList.toggle('collapsed', isCollapsed);
        sidebarToggle.setAttribute('aria-expanded', String(!isCollapsed));
        sidebarToggle.setAttribute('aria-label', isCollapsed ? 'Expand sidebar' : 'Collapse sidebar');
        const icon = sidebarToggle.querySelector('i');
        if (icon) icon.className = `fa-solid ${isCollapsed ? 'fa-angles-right' : 'fa-angles-left'}`;
        safeStorageSet(STORAGE_KEYS.sidebarCollapsed, String(isCollapsed));
        if (isCollapsed) setProfileMenuOpen(false);
    }

    function setProfileMenuOpen(isOpen) {
        profileMenu.classList.toggle('open', isOpen);
        profileMenu.setAttribute('aria-hidden', String(!isOpen));
        profileButton.setAttribute('aria-expanded', String(isOpen));
    }
}

function initializeWorkspaceSearch() {
    const searchInput = document.getElementById('workspaceSearch');
    const clearButton = document.getElementById('clearSearchButton');
    const emptyState = document.getElementById('searchEmptyState');
    const settingsResults = document.getElementById('settingsSearchResults');
    const settingsResultsList = document.getElementById('settingsSearchResultsList');
    const settingsResultCount = document.getElementById('settingsSearchResultCount');
    if (!searchInput || !clearButton || !emptyState) return;

    searchInput.addEventListener('input', applySearch);
    clearButton.addEventListener('click', () => {
        searchInput.value = '';
        applySearch();
        searchInput.focus();
    });
    settingsResultsList?.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-setting-result-target]');
        if (!trigger) return;
        const target = document.getElementById(trigger.dataset.settingResultTarget);
        if (!target) return;

        target.scrollIntoView({ behavior: 'smooth', block: 'center' });
        target.classList.remove('setting-search-focus');
        requestAnimationFrame(() => target.classList.add('setting-search-focus'));
        window.setTimeout(() => target.classList.remove('setting-search-focus'), 1800);
        window.setTimeout(() => {
            const control = target.matches('input, select, textarea, button')
                ? target
                : target.querySelector('input, select, textarea, button');
            control?.focus({ preventScroll: true });
        }, 420);
    });
    document.addEventListener('outcomeai:view-changed', applySearch);
    applySearch();

    function applySearch() {
        const query = searchInput.value.trim().toLowerCase();
        const activeView = document.querySelector('.dashboard-view.active');
        if (!activeView) return;

        document.querySelectorAll('.search-hidden').forEach((item) => item.classList.remove('search-hidden'));
        document.querySelectorAll('.setting-search-match').forEach((item) => item.classList.remove('setting-search-match'));
        clearButton.hidden = query.length === 0;

        if (activeView.dataset.view === 'settings' && settingsResults && settingsResultsList && settingsResultCount) {
            applySettingsSearch(query, activeView);
            return;
        }

        if (settingsResults) settingsResults.hidden = true;
        const items = Array.from(activeView.querySelectorAll('.searchable-item'));
        let visibleCount = 0;

        items.forEach((item) => {
            const searchableText = `${item.dataset.searchText || ''} ${item.textContent || ''}`.toLowerCase();
            const isVisible = !query || searchableText.includes(query);
            item.classList.toggle('search-hidden', !isVisible);
            if (isVisible) visibleCount += 1;
        });

        emptyState.hidden = query.length === 0 || visibleCount > 0;
    }

    function applySettingsSearch(query, activeView) {
        settingsResultsList.replaceChildren();
        emptyState.hidden = true;

        if (!query) {
            settingsResults.hidden = true;
            settingsResultCount.textContent = '0 results';
            return;
        }

        const tokens = query.split(/\s+/).filter(Boolean);
        const matches = Array.from(activeView.querySelectorAll('[data-setting-item]'))
            .map((item) => {
                const title = item.dataset.settingTitle || '';
                const category = item.dataset.settingCategory || 'Settings';
                const description = item.dataset.settingDescription || '';
                const searchableText = `${title} ${category} ${description} ${item.textContent || ''}`.toLowerCase();
                if (!tokens.every((token) => searchableText.includes(token))) return null;

                const normalizedTitle = title.toLowerCase();
                const normalizedCategory = category.toLowerCase();
                let score = 30;
                if (normalizedTitle === query) score = 0;
                else if (normalizedTitle.startsWith(query)) score = 4;
                else if (normalizedTitle.includes(query)) score = 8;
                else if (normalizedCategory.includes(query)) score = 14;
                score += Math.min(searchableText.indexOf(tokens[0]), 20);
                return { item, title, category, description, score };
            })
            .filter(Boolean)
            .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));

        settingsResults.hidden = false;
        settingsResultCount.textContent = `${matches.length} ${matches.length === 1 ? 'result' : 'results'}`;

        if (matches.length === 0) {
            const noResults = document.createElement('div');
            noResults.className = 'settings-search-no-results';
            noResults.innerHTML = '<i class="fa-solid fa-magnifying-glass" aria-hidden="true"></i><div><strong>No setting found</strong><span>Try words such as theme, notifications, sidebar, language, privacy, or billing.</span></div>';
            settingsResultsList.appendChild(noResults);
            return;
        }

        matches.slice(0, 10).forEach(({ item, title, category, description }) => {
            item.classList.add('setting-search-match');
            const result = document.createElement('button');
            result.type = 'button';
            result.className = 'settings-search-result';
            result.dataset.settingResultTarget = item.id;

            const copy = document.createElement('span');
            copy.className = 'settings-search-result-copy';
            const categoryLabel = document.createElement('small');
            categoryLabel.textContent = category;
            const titleLabel = document.createElement('strong');
            titleLabel.textContent = title;
            const descriptionLabel = document.createElement('span');
            descriptionLabel.textContent = description;
            copy.append(categoryLabel, titleLabel, descriptionLabel);

            const arrow = document.createElement('i');
            arrow.className = 'fa-solid fa-arrow-down';
            arrow.setAttribute('aria-hidden', 'true');
            result.append(copy, arrow);
            settingsResultsList.appendChild(result);
        });
    }
}

function renderAgentMessageContent(container, rawContent, useMarkdown) {
    const content = String(rawContent ?? '');
    container.replaceChildren();

    if (!useMarkdown) {
        const paragraph = document.createElement('p');
        paragraph.className = 'agent-message-paragraph';
        paragraph.textContent = content;
        container.appendChild(paragraph);
        return;
    }

    renderAgentMarkdown(container, content);
}

function renderAgentMarkdown(container, source) {
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    let index = 0;

    while (index < lines.length) {
        const line = lines[index];
        const trimmed = line.trim();

        if (!trimmed) {
            index += 1;
            continue;
        }

        const fenceMatch = trimmed.match(/^```([\w+-]*)\s*$/);
        if (fenceMatch) {
            const codeLines = [];
            index += 1;
            while (index < lines.length && !/^```\s*$/.test(lines[index].trim())) {
                codeLines.push(lines[index]);
                index += 1;
            }
            if (index < lines.length) index += 1;

            const pre = document.createElement('pre');
            const code = document.createElement('code');
            if (fenceMatch[1]) code.dataset.language = fenceMatch[1];
            code.textContent = codeLines.join('\n');
            pre.appendChild(code);
            container.appendChild(pre);
            continue;
        }

        const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
        if (headingMatch) {
            const headingLevel = Math.min(5, headingMatch[1].length + 2);
            const heading = document.createElement(`h${headingLevel}`);
            appendAgentInlineMarkdown(heading, headingMatch[2]);
            container.appendChild(heading);
            index += 1;
            continue;
        }

        if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)) {
            container.appendChild(document.createElement('hr'));
            index += 1;
            continue;
        }

        const listMatch = line.match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
        if (listMatch) {
            const ordered = /^\d/.test(listMatch[1]);
            const list = document.createElement(ordered ? 'ol' : 'ul');
            if (ordered) list.start = Number.parseInt(listMatch[1], 10) || 1;

            while (index < lines.length) {
                const itemMatch = lines[index].match(/^\s*([-+*]|\d+[.)])\s+(.+)$/);
                if (!itemMatch || /^\d/.test(itemMatch[1]) !== ordered) break;

                const itemParts = [itemMatch[2].trim()];
                index += 1;
                while (index < lines.length && /^\s{2,}\S/.test(lines[index]) && !isAgentMarkdownBlockStart(lines[index])) {
                    itemParts.push(lines[index].trim());
                    index += 1;
                }

                const item = document.createElement('li');
                appendAgentInlineMarkdown(item, itemParts.join(' '));
                list.appendChild(item);
            }

            container.appendChild(list);
            continue;
        }

        if (/^>\s?/.test(trimmed)) {
            const quoteLines = [];
            while (index < lines.length && /^\s*>/.test(lines[index])) {
                quoteLines.push(lines[index].replace(/^\s*>\s?/, '').trim());
                index += 1;
            }
            const quote = document.createElement('blockquote');
            appendAgentInlineMarkdown(quote, quoteLines.join(' '));
            container.appendChild(quote);
            continue;
        }

        const paragraphLines = [trimmed];
        index += 1;
        while (index < lines.length && lines[index].trim() && !isAgentMarkdownBlockStart(lines[index])) {
            paragraphLines.push(lines[index].trim());
            index += 1;
        }

        const paragraph = document.createElement('p');
        appendAgentInlineMarkdown(paragraph, paragraphLines.join(' '));
        container.appendChild(paragraph);
    }

    if (!container.childNodes.length) {
        const paragraph = document.createElement('p');
        paragraph.textContent = source;
        container.appendChild(paragraph);
    }
}

function isAgentMarkdownBlockStart(line) {
    const trimmed = line.trim();
    return /^```/.test(trimmed)
        || /^#{1,4}\s+/.test(trimmed)
        || /^(?:-{3,}|\*{3,}|_{3,})$/.test(trimmed)
        || /^\s*([-+*]|\d+[.)])\s+/.test(line)
        || /^\s*>/.test(line);
}

function appendAgentInlineMarkdown(parent, source) {
    const pattern = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__|~~[^~\n]+?~~|\[[^\]\n]+\]\((?:https?:\/\/|mailto:)[^)\s]+\)|\*[^*\n]+?\*|_[^_\n]+?_)/g;
    let cursor = 0;
    let match;

    while ((match = pattern.exec(source)) !== null) {
        if (match.index > cursor) {
            parent.appendChild(document.createTextNode(source.slice(cursor, match.index)));
        }

        const token = match[0];
        let element;
        let innerText;

        if (token.startsWith('**') || token.startsWith('__')) {
            element = document.createElement('strong');
            innerText = token.slice(2, -2);
            appendAgentInlineMarkdown(element, innerText);
        } else if (token.startsWith('~~')) {
            element = document.createElement('del');
            innerText = token.slice(2, -2);
            appendAgentInlineMarkdown(element, innerText);
        } else if (token.startsWith('`')) {
            element = document.createElement('code');
            element.textContent = token.slice(1, -1);
        } else if (token.startsWith('[')) {
            const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
            element = document.createElement('a');
            element.textContent = linkMatch?.[1] || token;
            element.href = linkMatch?.[2] || '#';
            element.rel = 'noopener noreferrer';
            if (element.protocol === 'http:' || element.protocol === 'https:') element.target = '_blank';
        } else {
            element = document.createElement('em');
            innerText = token.slice(1, -1);
            appendAgentInlineMarkdown(element, innerText);
        }

        parent.appendChild(element);
        cursor = pattern.lastIndex;
    }

    if (cursor < source.length) {
        parent.appendChild(document.createTextNode(source.slice(cursor)));
    }
}

function initializeAgentChat() {
    const historyList = document.getElementById('chatHistoryList');
    const newChatButton = document.getElementById('newChatButton');
    const recentChatsButton = document.getElementById('recentChatsButton');
    const recentChatsCount = document.getElementById('recentChatsCount');
    const historyModal = document.getElementById('recentChatsModal');
    const closeHistoryModalButton = document.getElementById('closeRecentChatsModal');
    const syncStatus = document.getElementById('chatSyncStatus');
    const messageList = document.getElementById('agentMessageList');
    const emptyState = document.getElementById('agentEmptyState');
    const chatShell = messageList?.closest('.agent-chat-shell');
    const commandForm = document.getElementById('agentCommandForm');
    const commandInput = document.getElementById('agentCommandInput');
    const sendButton = document.getElementById('agentSendButton');
    const activeTitle = document.getElementById('activeChatTitle');
    const renameButton = document.getElementById('renameChatButton');
    const deleteButton = document.getElementById('deleteChatButton');
    const titleEditor = document.getElementById('chatTitleEditor');
    const titleInput = document.getElementById('chatTitleInput');
    const cancelRenameButton = document.getElementById('cancelChatRenameButton');
    const cameraButton = document.getElementById('agentCameraButton');
    const folderButton = document.getElementById('agentFolderButton');
    const cameraCaptureInput = document.getElementById('agentCameraCaptureInput');
    const folderInput = document.getElementById('agentFolderInput');
    const uploadStatus = document.getElementById('agentUploadStatus');
    const attachmentList = document.getElementById('agentAttachmentList');
    const cameraModal = document.getElementById('cameraModal');
    const cameraModalContent = cameraModal?.querySelector('.camera-modal-content');
    const closeCameraButton = document.getElementById('closeCameraModal');
    const cameraVideo = document.getElementById('cameraVideo');
    const cameraPreview = document.getElementById('cameraPreview');
    const cameraPlaceholder = document.getElementById('cameraPlaceholder');
    const cameraCanvas = document.getElementById('cameraCanvas');
    const cameraStatus = document.getElementById('cameraStatus');
    const cameraCaptureButton = document.getElementById('cameraCaptureButton');
    const cameraRetakeButton = document.getElementById('cameraRetakeButton');
    const cameraUploadButton = document.getElementById('cameraUploadButton');
    const cameraFallbackButton = document.getElementById('cameraFallbackButton');

    if (!historyList || !newChatButton || !recentChatsButton || !recentChatsCount || !historyModal
        || !closeHistoryModalButton || !messageList || !emptyState || !commandForm || !commandInput
        || !sendButton || !activeTitle || !renameButton || !deleteButton || !titleEditor || !titleInput
        || !cameraButton || !folderButton || !cameraCaptureInput || !folderInput || !uploadStatus
        || !attachmentList || !cameraModal || !cameraModalContent || !closeCameraButton || !cameraVideo
        || !cameraPreview || !cameraPlaceholder || !cameraCanvas || !cameraStatus || !cameraCaptureButton
        || !cameraRetakeButton || !cameraUploadButton || !cameraFallbackButton) {
        return;
    }

    const MAX_UPLOAD_FILE_BYTES = 25 * 1024 * 1024;
    const MAX_UPLOAD_BATCH_BYTES = 250 * 1024 * 1024;
    const MAX_UPLOAD_BATCH_FILES = 250;
    const MAX_PENDING_UPLOAD_GROUPS = 10;
    let conversations = [];
    let activeConversationId = null;
    let requestInFlight = false;
    let uploadInFlight = false;
    let pendingUploads = [];
    let cameraStream = null;
    let cameraFile = null;
    let cameraPreviewUrl = '';
    let cameraMode = 'stream';
    let cameraReturnFocus = null;
    let cameraRequestId = 0;
    let deleteConfirmationTimer = null;
    let syncTimer = null;
    let uploadStatusTimer = null;
    let welcomeOrbVisible = true;
    let welcomeTransitionTimer = null;

    historyList.addEventListener('click', (event) => {
        const trigger = event.target.closest('[data-chat-id]');
        if (!trigger) return;
        closeHistoryModal(false);
        openConversation(Number(trigger.dataset.chatId), true);
    });

    recentChatsButton.addEventListener('click', openHistoryModal);
    closeHistoryModalButton.addEventListener('click', () => closeHistoryModal(true));
    historyModal.addEventListener('click', (event) => {
        if (event.target === historyModal) closeHistoryModal(true);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && historyModal.classList.contains('active')) {
            event.preventDefault();
            closeHistoryModal(true);
        }
    });

    newChatButton.addEventListener('click', () => createConversation(true));
    commandInput.addEventListener('input', () => {
        resizeComposer();
        updateComposerControls();
    });
    commandInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            if (!sendButton.disabled) commandForm.requestSubmit();
        }
    });
    commandForm.addEventListener('submit', sendCommand);
    cameraButton.addEventListener('click', openCamera);
    folderButton.addEventListener('click', chooseFolder);
    cameraCaptureInput.addEventListener('change', handleNativeCameraSelection);
    folderInput.addEventListener('change', handleFolderSelection);
    closeCameraButton.addEventListener('click', () => closeCameraModal(true));
    cameraCaptureButton.addEventListener('click', captureCameraFrame);
    cameraRetakeButton.addEventListener('click', retakeCameraPhoto);
    cameraUploadButton.addEventListener('click', uploadCameraPhoto);
    cameraFallbackButton.addEventListener('click', openNativeCameraPicker);
    attachmentList.addEventListener('click', (event) => {
        const removeButton = event.target.closest('[data-remove-upload]');
        if (!removeButton || requestInFlight || uploadInFlight) return;
        pendingUploads = pendingUploads.filter((item) => item.id !== removeButton.dataset.removeUpload);
        renderPendingUploads();
        updateComposerControls();
    });
    cameraModal.addEventListener('click', (event) => {
        if (event.target === cameraModal) closeCameraModal(true);
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && cameraModal.classList.contains('active')) {
            event.preventDefault();
            closeCameraModal(true);
        }
    });

    document.querySelectorAll('[data-agent-suggestion]').forEach((button) => {
        button.addEventListener('click', () => {
            commandInput.value = button.dataset.agentSuggestion || '';
            commandInput.dispatchEvent(new Event('input'));
            commandInput.focus();
        });
    });

    renameButton.addEventListener('click', beginRename);
    cancelRenameButton?.addEventListener('click', cancelRename);
    titleEditor.addEventListener('submit', saveRename);
    deleteButton.addEventListener('click', requestDelete);

    document.addEventListener('orexisai:welcome-orb-removed', finishWelcomeTransition);
    loadConversations();

    function showWelcomeOrb() {
        const orb = document.getElementById('outcomeAgentOrb');
        if (welcomeOrbVisible && orb?.isConnected) return;

        welcomeOrbVisible = true;
        window.clearTimeout(welcomeTransitionTimer);
        chatShell?.classList.remove('agent-conversation-entering', 'agent-conversation-active');
        document.dispatchEvent(new CustomEvent('orexisai:show-welcome-orb'));
    }

    function dismissWelcomeOrb(animate = true) {
        if (!welcomeOrbVisible) return;
        welcomeOrbVisible = false;

        const orb = document.getElementById('outcomeAgentOrb');
        const shouldAnimate = animate
            && !window.matchMedia('(prefers-reduced-motion: reduce)').matches
            && Boolean(orb);

        chatShell?.classList.toggle('agent-conversation-entering', shouldAnimate);
        chatShell?.classList.toggle('agent-conversation-active', !shouldAnimate);

        if (!orb) {
            finishWelcomeTransition();
            return;
        }

        document.dispatchEvent(new CustomEvent('orexisai:dismiss-welcome-orb', {
            detail: { animate: shouldAnimate }
        }));

        if (shouldAnimate) {
            window.clearTimeout(welcomeTransitionTimer);
            welcomeTransitionTimer = window.setTimeout(finishWelcomeTransition, 900);
        }
    }

    function finishWelcomeTransition() {
        window.clearTimeout(welcomeTransitionTimer);
        chatShell?.classList.remove('agent-conversation-entering');
        chatShell?.classList.add('agent-conversation-active');
    }

    function openHistoryModal() {
        openModal(historyModal);
        recentChatsButton.setAttribute('aria-expanded', 'true');
        window.setTimeout(() => closeHistoryModalButton.focus({ preventScroll: true }), 0);
    }

    function closeHistoryModal(restoreFocus) {
        if (!historyModal.classList.contains('active')) return;
        closeModalElement(historyModal);
        recentChatsButton.setAttribute('aria-expanded', 'false');
        if (restoreFocus) recentChatsButton.focus({ preventScroll: true });
    }

    async function loadConversations() {
        setHistoryState('loading');
        try {
            const result = await requestJson('/api/chats');
            conversations = Array.isArray(result.conversations) ? result.conversations : [];
            renderHistory();
            if (activeConversationId && !conversations.some((item) => item.id === activeConversationId)) {
                clearConversation();
            }
            if (!activeConversationId && conversations.length > 0) {
                const savedConversationId = Number(safeStorageGet(STORAGE_KEYS.activeChat));
                const preferredConversation = conversations.find((item) => item.id === savedConversationId) || conversations[0];
                if (document.querySelector('.dashboard-view[data-view="agent"]')?.classList.contains('active')) {
                    await openConversation(preferredConversation.id, false);
                }
            }
        } catch (error) {
            setHistoryState('error', error.message);
        }
    }

    async function createConversation(shouldNavigate) {
        if (requestInFlight) return null;
        setBusy(true);
        try {
            const result = await requestJson('/api/chats', {
                method: 'POST',
                body: { title: 'New chat' }
            });
            const conversation = result.conversation;
            conversations = [conversation, ...conversations.filter((item) => item.id !== conversation.id)];
            activeConversationId = conversation.id;
            renderHistory();
            renderMessages([]);
            updateActiveConversation(conversation);
            setSyncStatus('Saved', 'success');
            if (shouldNavigate) {
                document.dispatchEvent(new CustomEvent('outcomeai:navigate', { detail: { view: 'agent' } }));
                commandInput.focus();
            }
            return conversation;
        } catch (error) {
            setSyncStatus(error.message, 'error');
            return null;
        } finally {
            setBusy(false);
        }
    }

    async function openConversation(conversationId, shouldNavigate) {
        if (!Number.isInteger(conversationId) || conversationId < 1 || requestInFlight) return;
        activeConversationId = conversationId;
        renderHistory();
        setConversationLoading();
        if (shouldNavigate) {
            document.dispatchEvent(new CustomEvent('outcomeai:navigate', { detail: { view: 'agent' } }));
        }
        try {
            const result = await requestJson(`/api/chats/${conversationId}/messages`);
            const conversation = result.conversation;
            conversations = conversations.map((item) => item.id === conversation.id ? { ...item, ...conversation } : item);
            updateActiveConversation(conversation);
            renderMessages(result.messages || []);
            renderHistory();
        } catch (error) {
            if (activeConversationId === conversationId) clearConversation();
            setSyncStatus(error.message, 'error');
            await loadConversations();
        }
    }

    async function sendCommand(event) {
        event.preventDefault();
        const draft = commandInput.value.trim();
        if ((!draft && pendingUploads.length === 0) || requestInFlight || uploadInFlight) return;
        const uploadsForCommand = pendingUploads.map((item) => ({ ...item, files: [...item.files] }));
        const content = buildCommandContent(draft, uploadsForCommand);
        if (content.length > 4000) {
            setUploadStatus('Shorten the message before sending; upload references exceed the 4,000-character limit.', 'error');
            return;
        }

        let conversationId = activeConversationId;
        if (!conversationId) {
            const conversation = await createConversation(false);
            conversationId = conversation?.id;
        }
        if (!conversationId) return;

        const previousConversation = conversations.find((item) => item.id === conversationId);
        setBusy(true);
        const pendingMessage = appendMessage({
            role: 'user',
            content,
            createdAt: new Date().toISOString(),
            pendingLabel: 'Saving command…'
        }, true);
        const pendingReply = appendMessage({
            role: 'assistant',
            content: 'Thinking…',
            createdAt: new Date().toISOString(),
            pendingLabel: 'Gemini is generating a reply…'
        }, true);
        commandInput.value = '';
        pendingUploads = [];
        renderPendingUploads();
        commandInput.dispatchEvent(new Event('input'));

        try {
            const result = await requestJson(`/api/chats/${conversationId}/messages`, {
                method: 'POST',
                body: { content }
            });
            pendingMessage?.remove();
            pendingReply?.remove();
            appendMessage(result.userMessage, false);
            appendMessage(result.assistantMessage, false);

            const conversation = result.conversation;
            const messageCount = Number(previousConversation?.messageCount || 0) + 2;
            conversations = [
                {
                    ...previousConversation,
                    ...conversation,
                    messageCount,
                    lastMessage: result.assistantMessage?.content || content
                },
                ...conversations.filter((item) => item.id !== conversation.id)
            ];
            updateActiveConversation(conversation);
            renderHistory();
            setSyncStatus('Gemini replied · saved to PostgreSQL', 'success');
        } catch (error) {
            pendingMessage?.remove();
            pendingReply?.remove();

            if (error.payload?.commandSaved && error.payload.userMessage) {
                appendMessage(error.payload.userMessage, false);
                const technicalDetail = error.payload?.details && error.payload.details !== error.message
                    ? `\n\nDevelopment detail: ${error.payload.details}`
                    : '';
                appendMessage({
                    role: 'assistant',
                    content: `${error.message}${technicalDetail}`,
                    createdAt: new Date().toISOString(),
                    transientError: true
                }, false);
                const conversation = error.payload.conversation || previousConversation;
                if (conversation) {
                    conversations = [
                        {
                            ...previousConversation,
                            ...conversation,
                            messageCount: Number(previousConversation?.messageCount || 0) + 1,
                            lastMessage: content
                        },
                        ...conversations.filter((item) => item.id !== conversation.id)
                    ];
                    updateActiveConversation(conversation);
                    renderHistory();
                }
                setSyncStatus('Command saved · Gemini reply failed', 'error');
            } else {
                if (!messageList.querySelector('.agent-message')) emptyState.hidden = false;
                commandInput.value = draft;
                pendingUploads = uploadsForCommand;
                renderPendingUploads();
                commandInput.dispatchEvent(new Event('input'));
                setSyncStatus(error.message, 'error');
            }
        } finally {
            setBusy(false);
            commandInput.focus();
        }
    }

    function updateComposerControls() {
        const isBusy = requestInFlight || uploadInFlight;
        const hasContent = commandInput.value.trim().length > 0 || pendingUploads.length > 0;
        sendButton.disabled = isBusy || !hasContent;
        cameraButton.disabled = isBusy || pendingUploads.length >= MAX_PENDING_UPLOAD_GROUPS;
        folderButton.disabled = isBusy || pendingUploads.length >= MAX_PENDING_UPLOAD_GROUPS;
        attachmentList.querySelectorAll('[data-remove-upload]').forEach((button) => {
            button.disabled = isBusy;
        });
    }

    function setUploadStatus(message, state = '', persist = false) {
        window.clearTimeout(uploadStatusTimer);
        uploadStatus.textContent = message;
        if (state) uploadStatus.dataset.state = state;
        else delete uploadStatus.dataset.state;
        if (message && !persist && state !== 'loading') {
            uploadStatusTimer = window.setTimeout(() => {
                uploadStatus.textContent = '';
                delete uploadStatus.dataset.state;
            }, state === 'error' ? 6500 : 4000);
        }
    }

    function renderPendingUploads() {
        attachmentList.replaceChildren();
        attachmentList.hidden = pendingUploads.length === 0;

        pendingUploads.forEach((upload) => {
            const card = document.createElement('div');
            card.className = 'agent-attachment-card';

            const preview = document.createElement('span');
            preview.className = 'agent-attachment-preview';
            if (upload.kind === 'camera' && upload.files[0]?.url) {
                const image = document.createElement('img');
                image.src = upload.files[0].url;
                image.alt = '';
                preview.appendChild(image);
            } else {
                preview.innerHTML = '<i class="fa-solid fa-folder-tree" aria-hidden="true"></i>';
            }

            const copy = document.createElement('span');
            copy.className = 'agent-attachment-copy';
            const title = document.createElement('strong');
            title.textContent = upload.label;
            const detail = document.createElement('small');
            detail.textContent = upload.kind === 'camera'
                ? `${formatFileSize(upload.totalBytes)} · saved`
                : `${upload.files.length} file${upload.files.length === 1 ? '' : 's'} · ${formatFileSize(upload.totalBytes)}`;
            copy.append(title, detail);

            const remove = document.createElement('button');
            remove.type = 'button';
            remove.className = 'agent-attachment-remove';
            remove.dataset.removeUpload = upload.id;
            remove.setAttribute('aria-label', `Remove ${upload.label} from this message`);
            remove.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
            card.append(preview, copy, remove);
            attachmentList.appendChild(card);
        });
    }

    function buildCommandContent(draft, uploads) {
        const lines = uploads.map((upload) => {
            if (upload.kind === 'camera') {
                return `- Captured photo "${upload.label}" saved at ${upload.files[0]?.url || `upload batch ${upload.batchId}`}`;
            }
            return `- Folder "${upload.label}" uploaded with ${upload.files.length} file${upload.files.length === 1 ? '' : 's'} (upload batch ${upload.batchId})`;
        });
        const base = draft || 'Use the uploaded files for this request.';
        return lines.length > 0 ? `${base}\n\nUploaded files:\n${lines.join('\n')}` : base;
    }

    async function openCamera() {
        if (requestInFlight || uploadInFlight || pendingUploads.length >= MAX_PENDING_UPLOAD_GROUPS) return;
        cameraReturnFocus = cameraButton;
        resetCameraPreview();
        openModal(cameraModal);
        cameraModalContent.focus({ preventScroll: true });

        if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            setCameraStatus('Live camera preview is unavailable in this browser. Use the device camera picker instead.', 'error');
            cameraPlaceholder.querySelector('span').textContent = 'Live preview is not supported here.';
            cameraFallbackButton.hidden = false;
            cameraCaptureButton.hidden = true;
            return;
        }

        cameraMode = 'stream';
        await startCameraStream();
    }

    async function startCameraStream() {
        const requestId = ++cameraRequestId;
        stopCameraStream();
        clearCameraPreviewUrl();
        cameraFile = null;
        cameraMode = 'stream';
        cameraVideo.hidden = true;
        cameraPreview.hidden = true;
        cameraPlaceholder.hidden = false;
        cameraPlaceholder.querySelector('span').textContent = 'Requesting camera permission…';
        cameraCaptureButton.hidden = false;
        cameraCaptureButton.disabled = true;
        cameraRetakeButton.hidden = true;
        cameraUploadButton.hidden = true;
        cameraFallbackButton.hidden = true;
        setCameraStatus('Allow camera access when your browser asks.', '');

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: {
                    facingMode: { ideal: 'environment' },
                    width: { ideal: 1920 },
                    height: { ideal: 1080 }
                },
                audio: false
            });
            if (requestId !== cameraRequestId || !cameraModal.classList.contains('active')) {
                stream.getTracks().forEach((track) => track.stop());
                return;
            }
            cameraStream = stream;
            cameraVideo.srcObject = cameraStream;
            await cameraVideo.play();
            cameraPlaceholder.hidden = true;
            cameraVideo.hidden = false;
            cameraCaptureButton.disabled = false;
            setCameraStatus('Camera ready. Capture when the frame looks right.', 'success');
        } catch (error) {
            if (requestId !== cameraRequestId || !cameraModal.classList.contains('active')) return;
            stopCameraStream();
            cameraPlaceholder.hidden = false;
            cameraPlaceholder.querySelector('span').textContent = 'Camera could not be opened.';
            cameraCaptureButton.hidden = true;
            cameraFallbackButton.hidden = false;
            setCameraStatus(cameraPermissionMessage(error), 'error');
        }
    }

    function cameraPermissionMessage(error) {
        if (error?.name === 'NotAllowedError' || error?.name === 'SecurityError') {
            return 'Camera access was denied. Allow camera permission in browser settings, or use the camera picker.';
        }
        if (error?.name === 'NotFoundError' || error?.name === 'OverconstrainedError') {
            return 'No compatible camera was found on this device.';
        }
        if (error?.name === 'NotReadableError' || error?.name === 'AbortError') {
            return 'The camera is busy or unavailable. Close other camera apps and try again.';
        }
        return 'The camera could not be opened. Try the device camera picker instead.';
    }

    async function captureCameraFrame() {
        if (!cameraStream || !cameraVideo.videoWidth || !cameraVideo.videoHeight) {
            setCameraStatus('The camera is not ready yet.', 'error');
            return;
        }

        cameraCaptureButton.disabled = true;
        try {
            const maximumDimension = 4096;
            const scale = Math.min(1, maximumDimension / Math.max(cameraVideo.videoWidth, cameraVideo.videoHeight));
            cameraCanvas.width = Math.max(1, Math.round(cameraVideo.videoWidth * scale));
            cameraCanvas.height = Math.max(1, Math.round(cameraVideo.videoHeight * scale));
            const context = cameraCanvas.getContext('2d', { alpha: false });
            if (!context) throw new Error('Canvas is unavailable.');
            context.drawImage(cameraVideo, 0, 0, cameraCanvas.width, cameraCanvas.height);
            const blob = await new Promise((resolve, reject) => {
                cameraCanvas.toBlob((value) => value ? resolve(value) : reject(new Error('Photo capture failed.')), 'image/jpeg', 0.9);
            });
            if (blob.size > MAX_UPLOAD_FILE_BYTES) {
                throw new Error('The captured photo is larger than 25 MB. Retake it at a lower resolution.');
            }
            cameraFile = new File([blob], `camera-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`, {
                type: 'image/jpeg',
                lastModified: Date.now()
            });
            cameraMode = 'stream';
            showCameraPreview(cameraFile);
            stopCameraStream();
            setCameraStatus('Photo captured. Review it, then upload or retake.', 'success');
        } catch (error) {
            cameraCaptureButton.disabled = false;
            setCameraStatus(error.message || 'The photo could not be captured.', 'error');
        }
    }

    function openNativeCameraPicker() {
        if (uploadInFlight) return;
        cameraCaptureInput.value = '';
        cameraCaptureInput.click();
    }

    function handleNativeCameraSelection() {
        const file = cameraCaptureInput.files?.[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
            setCameraStatus('Choose an image captured by your device camera.', 'error');
            return;
        }
        if (file.size > MAX_UPLOAD_FILE_BYTES) {
            setCameraStatus('The selected photo is larger than 25 MB.', 'error');
            return;
        }
        cameraReturnFocus = cameraButton;
        if (!cameraModal.classList.contains('active')) openModal(cameraModal);
        stopCameraStream();
        cameraMode = 'native';
        cameraFile = file;
        showCameraPreview(file);
        setCameraStatus('Photo selected. Review it, then upload or retake.', 'success');
    }

    function showCameraPreview(file) {
        clearCameraPreviewUrl();
        cameraPreviewUrl = URL.createObjectURL(file);
        cameraPreview.src = cameraPreviewUrl;
        cameraPreview.hidden = false;
        cameraVideo.hidden = true;
        cameraPlaceholder.hidden = true;
        cameraCaptureButton.hidden = true;
        cameraFallbackButton.hidden = true;
        cameraRetakeButton.hidden = false;
        cameraUploadButton.hidden = false;
        cameraUploadButton.disabled = false;
    }

    async function retakeCameraPhoto() {
        if (uploadInFlight) return;
        cameraFile = null;
        clearCameraPreviewUrl();
        if (cameraMode === 'native' || !window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
            openNativeCameraPicker();
            return;
        }
        await startCameraStream();
    }

    async function uploadCameraPhoto() {
        if (!cameraFile || uploadInFlight) return;
        cameraUploadButton.disabled = true;
        setCameraStatus('Uploading photo…', '');
        try {
            const result = await uploadEntries([{
                file: cameraFile,
                relativePath: cameraFile.name
            }], 'camera');
            pendingUploads.push({
                id: result.batchId,
                batchId: result.batchId,
                kind: 'camera',
                label: cameraFile.name,
                files: result.files,
                totalBytes: cameraFile.size
            });
            renderPendingUploads();
            updateComposerControls();
            setUploadStatus('Photo uploaded and saved.', 'success');
            setCameraStatus('Photo uploaded and saved.', 'success');
            closeCameraModal(false);
        } catch (error) {
            cameraUploadButton.disabled = false;
            setCameraStatus(error.message || 'The photo could not be uploaded.', 'error');
        }
    }

    function chooseFolder() {
        if (requestInFlight || uploadInFlight || pendingUploads.length >= MAX_PENDING_UPLOAD_GROUPS) return;
        if (!('webkitdirectory' in folderInput)) {
            setUploadStatus('Folder upload is not supported by this browser. Try a current desktop or mobile browser.', 'error');
            return;
        }
        folderInput.value = '';
        folderInput.click();
    }

    async function handleFolderSelection() {
        const files = Array.from(folderInput.files || []);
        if (files.length === 0) return;

        try {
            const entries = files.map((file) => {
                const relativePath = normalizeClientUploadPath(file.webkitRelativePath || '');
                if (!relativePath.includes('/')) {
                    throw new Error('This browser did not provide the folder structure. Use a browser that supports folder upload.');
                }
                return { file, relativePath };
            });
            const roots = [...new Set(entries.map((entry) => entry.relativePath.split('/')[0]))];
            const label = roots.length === 1 ? roots[0] : `${roots.length} folders`;
            const totalBytes = entries.reduce((sum, entry) => sum + entry.file.size, 0);
            const result = await uploadEntries(entries, 'folder');
            pendingUploads.push({
                id: result.batchId,
                batchId: result.batchId,
                kind: 'folder',
                label,
                files: result.files,
                totalBytes
            });
            renderPendingUploads();
            updateComposerControls();
            setUploadStatus(`${label} uploaded with its folder structure preserved.`, 'success');
        } catch (error) {
            setUploadStatus(error.message || 'The folder could not be uploaded.', 'error');
        } finally {
            folderInput.value = '';
        }
    }

    async function uploadEntries(entries, source) {
        validateUploadEntries(entries, source);
        const batchId = createUploadBatchId();
        const totalBytes = entries.reduce((sum, entry) => sum + entry.file.size, 0);
        const uploadedFiles = [];
        uploadInFlight = true;
        updateComposerControls();

        try {
            for (let index = 0; index < entries.length; index += 1) {
                const entry = entries[index];
                const progress = entries.length === 1
                    ? `Uploading ${entry.file.name}…`
                    : `Uploading ${index + 1} of ${entries.length}: ${entry.file.name}`;
                setUploadStatus(progress, 'loading', true);
                if (source === 'camera') setCameraStatus(progress, '');
                uploadedFiles.push(await uploadSingleFile({
                    ...entry,
                    batchId,
                    source,
                    expectedFiles: entries.length,
                    expectedBytes: totalBytes
                }));
            }
            return { batchId, files: uploadedFiles };
        } finally {
            uploadInFlight = false;
            updateComposerControls();
        }
    }

    function validateUploadEntries(entries, source) {
        if (!Array.isArray(entries) || entries.length === 0) throw new Error('No files were selected.');
        if (pendingUploads.length >= MAX_PENDING_UPLOAD_GROUPS) {
            throw new Error(`A message can include up to ${MAX_PENDING_UPLOAD_GROUPS} upload groups.`);
        }
        if (entries.length > MAX_UPLOAD_BATCH_FILES) {
            throw new Error(`A folder can contain up to ${MAX_UPLOAD_BATCH_FILES} files per upload.`);
        }
        let totalBytes = 0;
        entries.forEach((entry) => {
            if (!(entry.file instanceof File)) throw new Error('One of the selected files is invalid.');
            entry.relativePath = normalizeClientUploadPath(entry.relativePath || entry.file.name);
            if (entry.file.size > MAX_UPLOAD_FILE_BYTES) {
                throw new Error(`${entry.file.name} is larger than the 25 MB per-file limit.`);
            }
            if (source === 'camera' && !entry.file.type.startsWith('image/')) {
                throw new Error('Camera uploads must be image files.');
            }
            totalBytes += entry.file.size;
        });
        if (totalBytes > MAX_UPLOAD_BATCH_BYTES) {
            throw new Error('The selected upload is larger than the 250 MB batch limit.');
        }
    }

    async function uploadSingleFile({ file, relativePath, batchId, source, expectedFiles, expectedBytes }) {
        const response = await fetch('/api/uploads', {
            method: 'POST',
            credentials: 'same-origin',
            headers: {
                'Content-Type': file.type || 'application/octet-stream',
                'X-Upload-Batch': batchId,
                'X-Upload-Path': encodeURIComponent(relativePath),
                'X-Upload-Source': source,
                'X-Upload-Batch-Files': String(expectedFiles),
                'X-Upload-Batch-Bytes': String(expectedBytes)
            },
            body: file
        });
        const responseText = await response.text();
        let value = {};
        try {
            value = responseText ? JSON.parse(responseText) : {};
        } catch {
            value = { error: responseText || 'The server returned an invalid upload response.' };
        }
        if (!response.ok) throw new Error(value.error || `Upload failed with HTTP ${response.status}.`);
        if (!value.file?.url) throw new Error('The server did not return the saved file location.');
        return value.file;
    }

    function normalizeClientUploadPath(value) {
        const normalized = String(value || '').replace(/\\/g, '/');
        const segments = normalized.split('/').filter((segment) => segment && segment !== '.');
        if (segments.length === 0 || segments.some((segment) => segment === '..')) {
            throw new Error('A selected file has an invalid path.');
        }
        if (segments.some((segment) => /[\u0000-\u001f\u007f]/.test(segment) || new Blob([segment]).size > 255)) {
            throw new Error('A selected file or folder name is invalid or too long.');
        }
        const result = segments.join('/');
        if (new Blob([result]).size > 500) throw new Error('A selected folder path is too long.');
        return result;
    }

    function createUploadBatchId() {
        if (window.crypto?.randomUUID) return window.crypto.randomUUID().replace(/-/g, '');
        const random = new Uint8Array(18);
        window.crypto?.getRandomValues?.(random);
        const suffix = Array.from(random, (value) => value.toString(16).padStart(2, '0')).join('');
        return `${Date.now().toString(36)}${suffix || Math.random().toString(36).slice(2)}`.slice(0, 48);
    }

    function formatFileSize(bytes) {
        if (bytes < 1024) return `${bytes} B`;
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
        return `${(bytes / (1024 * 1024)).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
    }

    function setCameraStatus(message, state = '') {
        cameraStatus.textContent = message;
        if (state) cameraStatus.dataset.state = state;
        else delete cameraStatus.dataset.state;
    }

    function stopCameraStream() {
        if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
        cameraStream = null;
        cameraVideo.srcObject = null;
    }

    function clearCameraPreviewUrl() {
        if (cameraPreviewUrl) URL.revokeObjectURL(cameraPreviewUrl);
        cameraPreviewUrl = '';
        cameraPreview.removeAttribute('src');
    }

    function resetCameraPreview() {
        cameraRequestId += 1;
        stopCameraStream();
        clearCameraPreviewUrl();
        cameraFile = null;
        cameraMode = 'stream';
        cameraVideo.hidden = true;
        cameraPreview.hidden = true;
        cameraPlaceholder.hidden = false;
        cameraPlaceholder.querySelector('span').textContent = 'Waiting for camera permission…';
        cameraCaptureButton.hidden = false;
        cameraCaptureButton.disabled = true;
        cameraRetakeButton.hidden = true;
        cameraUploadButton.hidden = true;
        cameraUploadButton.disabled = true;
        cameraFallbackButton.hidden = true;
        setCameraStatus('', '');
    }

    function closeCameraModal(restoreFocus) {
        if (uploadInFlight || !cameraModal.classList.contains('active')) return;
        resetCameraPreview();
        closeModalElement(cameraModal);
        if (restoreFocus) cameraReturnFocus?.focus({ preventScroll: true });
        cameraReturnFocus = null;
    }

    function renderHistory() {
        updateHistoryCount();
        historyList.replaceChildren();
        if (conversations.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'chat-history-empty';
            empty.innerHTML = '<i class="fa-regular fa-message" aria-hidden="true"></i><span>No saved chats yet</span>';
            historyList.appendChild(empty);
            return;
        }

        conversations.forEach((conversation) => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'chat-history-item';
            button.dataset.chatId = String(conversation.id);
            button.setAttribute('role', 'listitem');
            if (conversation.id === activeConversationId) {
                button.classList.add('active');
                button.setAttribute('aria-current', 'true');
            }

            const icon = document.createElement('i');
            icon.className = 'fa-regular fa-message';
            icon.setAttribute('aria-hidden', 'true');
            const copy = document.createElement('span');
            copy.className = 'chat-history-copy';
            const title = document.createElement('strong');
            title.textContent = conversation.title || 'New chat';
            const preview = document.createElement('small');
            preview.textContent = conversation.lastMessage || 'Empty conversation';
            copy.append(title, preview);
            button.append(icon, copy);
            historyList.appendChild(button);
        });
    }

    function updateHistoryCount() {
        const count = conversations.length;
        recentChatsCount.textContent = count > 99 ? '99+' : String(count);
        recentChatsCount.setAttribute('aria-label', `${count} saved ${count === 1 ? 'chat' : 'chats'}`);
    }

    function renderMessages(messages) {
        messageList.querySelectorAll('.agent-message, .agent-conversation-loading').forEach((node) => node.remove());
        emptyState.hidden = messages.length > 0;
        if (messages.length > 0) dismissWelcomeOrb(false);
        else showWelcomeOrb();
        messages.forEach((message) => appendMessage(message, false));
        messageList.scrollTop = messageList.scrollHeight;
        document.getElementById('workspaceSearch')?.dispatchEvent(new Event('input'));
    }

    function appendMessage(message, pending) {
        dismissWelcomeOrb(true);
        emptyState.hidden = true;
        const article = document.createElement('article');
        article.className = `agent-message ${message.role === 'assistant' ? 'assistant' : 'user'} searchable-item${pending ? ' pending' : ''}${message.transientError ? ' error' : ''}`;
        article.dataset.searchText = message.content;

        const avatar = document.createElement('span');
        avatar.className = 'agent-message-avatar';
        avatar.innerHTML = message.role === 'assistant'
            ? '<i class="fa-solid fa-wand-magic-sparkles" aria-hidden="true"></i>'
            : '<i class="fa-solid fa-user" aria-hidden="true"></i>';
        const body = document.createElement('div');
        body.className = 'agent-message-body';
        const label = document.createElement('strong');
        label.className = 'agent-message-author';
        label.textContent = message.role === 'assistant' ? 'OrexisAI' : 'You';
        const content = document.createElement('div');
        content.className = 'agent-message-content';
        renderAgentMessageContent(content, message.content, message.role === 'assistant');
        const meta = document.createElement('small');
        meta.textContent = pending ? (message.pendingLabel || 'Saving…') : message.transientError ? 'Not saved · check Gemini setup and retry' : formatMessageTime(message.createdAt);
        const footer = document.createElement('div');
        footer.className = 'agent-message-footer';
        footer.appendChild(meta);

        if (message.role === 'assistant' && !pending) {
            const copyButton = document.createElement('button');
            copyButton.type = 'button';
            copyButton.className = 'agent-response-copy-button';
            copyButton.setAttribute('aria-label', 'Copy response');
            copyButton.title = 'Copy response';
            copyButton.innerHTML = '<i class="fa-regular fa-copy" aria-hidden="true"></i><span>Copy</span>';
            copyButton.addEventListener('click', () => copyResponse(copyButton, message.content));
            footer.appendChild(copyButton);
        }

        body.append(label, content, footer);
        article.append(avatar, body);
        messageList.appendChild(article);
        messageList.scrollTop = messageList.scrollHeight;
        return article;
    }

    async function copyResponse(button, responseText) {
        if (button.disabled) return;
        const text = String(responseText || '');
        const originalMarkup = button.innerHTML;
        const originalLabel = button.getAttribute('aria-label');
        button.disabled = true;

        try {
            if (navigator.clipboard?.writeText && window.isSecureContext) {
                await navigator.clipboard.writeText(text);
            } else {
                const textarea = document.createElement('textarea');
                textarea.value = text;
                textarea.setAttribute('readonly', '');
                textarea.style.position = 'fixed';
                textarea.style.top = '-9999px';
                textarea.style.opacity = '0';
                document.body.appendChild(textarea);
                try {
                    textarea.select();
                    textarea.setSelectionRange(0, textarea.value.length);
                    const copied = document.execCommand('copy');
                    if (!copied) throw new Error('Clipboard copy was rejected.');
                } finally {
                    textarea.remove();
                }
            }

            button.classList.add('copied');
            button.setAttribute('aria-label', 'Response copied');
            button.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i><span>Copied</span>';
        } catch (error) {
            console.error('Unable to copy AI response:', error);
            button.classList.add('copy-failed');
            button.setAttribute('aria-label', 'Copy failed');
            button.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span>Failed</span>';
        } finally {
            window.setTimeout(() => {
                if (!button.isConnected) return;
                button.disabled = false;
                button.classList.remove('copied', 'copy-failed');
                button.setAttribute('aria-label', originalLabel || 'Copy response');
                button.innerHTML = originalMarkup;
            }, 1800);
        }
    }

    function updateActiveConversation(conversation) {
        activeConversationId = conversation?.id || null;
        if (activeConversationId) safeStorageSet(STORAGE_KEYS.activeChat, String(activeConversationId));
        else safeStorageRemove(STORAGE_KEYS.activeChat);
        activeTitle.textContent = conversation?.title || 'New chat';
        renameButton.disabled = !activeConversationId;
        deleteButton.disabled = !activeConversationId;
        cancelDeleteConfirmation();
    }

    function clearConversation() {
        activeConversationId = null;
        updateActiveConversation(null);
        renderMessages([]);
        renderHistory();
    }

    function setConversationLoading() {
        dismissWelcomeOrb(false);
        messageList.querySelectorAll('.agent-message, .agent-conversation-loading').forEach((node) => node.remove());
        emptyState.hidden = true;
        const loading = document.createElement('div');
        loading.className = 'agent-conversation-loading';
        loading.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i><span>Loading saved conversation…</span>';
        messageList.appendChild(loading);
    }

    function beginRename() {
        const conversation = conversations.find((item) => item.id === activeConversationId);
        if (!conversation) return;
        activeTitle.hidden = true;
        titleEditor.hidden = false;
        titleInput.value = conversation.title || 'New chat';
        titleInput.focus();
        titleInput.select();
    }

    function cancelRename() {
        titleEditor.hidden = true;
        activeTitle.hidden = false;
    }

    async function saveRename(event) {
        event.preventDefault();
        const title = titleInput.value.replace(/\s+/g, ' ').trim();
        if (!activeConversationId || !title) return;
        try {
            const result = await requestJson(`/api/chats/${activeConversationId}`, {
                method: 'PATCH',
                body: { title }
            });
            conversations = conversations.map((item) => item.id === result.conversation.id
                ? { ...item, ...result.conversation }
                : item);
            updateActiveConversation(result.conversation);
            renderHistory();
            cancelRename();
            setSyncStatus('Renamed', 'success');
        } catch (error) {
            setSyncStatus(error.message, 'error');
        }
    }

    async function requestDelete() {
        if (!activeConversationId) return;
        if (deleteButton.dataset.confirming !== 'true') {
            deleteButton.dataset.confirming = 'true';
            deleteButton.classList.add('confirming');
            deleteButton.setAttribute('aria-label', 'Click again to permanently delete this chat');
            setSyncStatus('Click delete again to confirm', 'warning');
            deleteConfirmationTimer = window.setTimeout(cancelDeleteConfirmation, 3500);
            return;
        }

        const deletingId = activeConversationId;
        cancelDeleteConfirmation();
        setBusy(true);
        try {
            await requestJson(`/api/chats/${deletingId}`, { method: 'DELETE' });
            conversations = conversations.filter((item) => item.id !== deletingId);
            clearConversation();
            setSyncStatus('Chat deleted', 'success');
        } catch (error) {
            setSyncStatus(error.message, 'error');
        } finally {
            setBusy(false);
        }
    }

    function cancelDeleteConfirmation() {
        window.clearTimeout(deleteConfirmationTimer);
        deleteButton.dataset.confirming = 'false';
        deleteButton.classList.remove('confirming');
        deleteButton.setAttribute('aria-label', 'Delete chat');
    }

    function setBusy(isBusy) {
        requestInFlight = isBusy;
        newChatButton.disabled = isBusy;
        renameButton.disabled = isBusy || !activeConversationId;
        deleteButton.disabled = isBusy || !activeConversationId;
        commandForm.classList.toggle('busy', isBusy);
        updateComposerControls();
    }

    function resizeComposer() {
        commandInput.style.height = 'auto';
        commandInput.style.height = `${Math.min(commandInput.scrollHeight, 180)}px`;
    }

    function setHistoryState(state, message = '') {
        updateHistoryCount();
        historyList.replaceChildren();
        const row = document.createElement('div');
        row.className = state === 'error' ? 'chat-history-error' : 'chat-history-loading';
        const icon = document.createElement('i');
        icon.className = state === 'error' ? 'fa-solid fa-triangle-exclamation' : 'fa-solid fa-circle-notch fa-spin';
        icon.setAttribute('aria-hidden', 'true');
        const text = document.createElement('span');
        text.textContent = message || 'Loading chats…';
        row.append(icon, text);
        historyList.appendChild(row);
    }

    function setSyncStatus(message, type) {
        if (!syncStatus) return;
        window.clearTimeout(syncTimer);
        syncStatus.textContent = message;
        syncStatus.dataset.state = type;
        syncTimer = window.setTimeout(() => {
            syncStatus.textContent = '';
            delete syncStatus.dataset.state;
        }, type === 'error' ? 5000 : 2600);
    }

    function formatMessageTime(value) {
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Saved';
        return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(date);
    }
}

function initializeWorkflows() {
    const runButtons = document.querySelectorAll('.run-btn[data-workflow]');
    const modal = document.getElementById('executionModal');
    const closeModal = document.getElementById('closeModal');
    const closeResultBtn = document.getElementById('closeResultBtn');
    const stepsContainer = document.getElementById('executionSteps');
    const resultContainer = document.getElementById('executionResult');
    const workflowTitle = document.getElementById('workflowTitle');
    const resultTitle = document.getElementById('workflowResultTitle');
    const resultDescription = document.getElementById('workflowResultDescription');
    const spinner = document.querySelector('#executionModal .spinner');

    if (!modal || !closeModal || !closeResultBtn || !stepsContainer || !resultContainer || !workflowTitle || !resultTitle || !resultDescription || !spinner) {
        return;
    }

    const workflows = createWorkflowDefinitions();
    let executionTimeout;
    let stepTimeouts = [];
    let resultView = 'hub';

    runButtons.forEach((button) => {
        button.addEventListener('click', () => startWorkflow(button.dataset.workflow));
    });
    closeModal.addEventListener('click', closeWorkflowModal);
    closeResultBtn.addEventListener('click', () => {
        closeWorkflowModal();
        document.dispatchEvent(new CustomEvent('outcomeai:navigate', { detail: { view: resultView } }));
    });
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeWorkflowModal();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.classList.contains('active')) closeWorkflowModal();
    });

    function startWorkflow(type) {
        const workflow = workflows[type];
        if (!workflow) return;
        clearExecutionTimers();
        resultView = workflow.view;
        workflowTitle.textContent = workflow.title;
        resultTitle.textContent = workflow.resultTitle;
        resultDescription.textContent = workflow.resultDescription;
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
            const delay = totalDelay + 750 + (Math.random() * 350);
            stepTimeouts.push(setTimeout(() => activateStep(index), totalDelay));
            totalDelay = delay;
            stepTimeouts.push(setTimeout(() => completeStep(index), totalDelay));
        });

        executionTimeout = setTimeout(() => {
            stepsContainer.style.display = 'none';
            resultContainer.classList.remove('hidden');
            spinner.style.display = 'none';
            workflowTitle.textContent = 'Workflow complete';
        }, totalDelay + 350);
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
        clearExecutionTimers();
    }

    function clearExecutionTimers() {
        clearTimeout(executionTimeout);
        stepTimeouts.forEach(clearTimeout);
        stepTimeouts = [];
    }
}

function createWorkflowDefinitions() {
    const analysisStep = { title: 'Analyze business context', desc: 'Reviewing the available business data and the goal for this outcome.', model: 'Best-fit analysis route' };
    return {
        marketing: workflow('Running weekly marketing...', 'Weekly marketing pack is ready', 'Your campaign copy, promotional concept, image brief, and competitor snapshot are prepared in Marketing.', 'marketing', [
            { title: 'Review recent sales', desc: 'Finding the strongest products, customer patterns, and promotion opportunity.', model: 'Sales analysis route' },
            { title: 'Create campaign strategy', desc: 'Turning the strongest signal into one clear weekly offer and channel plan.', model: 'Strategy generation route' },
            { title: 'Generate campaign assets', desc: 'Preparing social copy, a flyer concept, and an approval checklist.', model: 'Copy and image route' },
            { title: 'Check competitor offers', desc: 'Comparing nearby offers before finalizing the campaign recommendation.', model: 'Web research route' }
        ]),
        audit: workflow('Running competitor audit...', 'Competitor audit is ready', 'Pricing gaps, notable offers, and recommended responses are now available in Marketing.', 'marketing', [analysisStep, { title: 'Collect competitor offers', desc: 'Checking public menus, listings, and current promotions.', model: 'Web research route' }, { title: 'Compare pricing and positioning', desc: 'Finding important gaps and areas where your offer is stronger.', model: 'Comparison route' }, { title: 'Prepare response plan', desc: 'Producing practical pricing and messaging recommendations.', model: 'Strategy generation route' }]),
        reviews: workflow('Preparing review responses...', 'Review responses are ready', 'New reviews were grouped by sentiment and personalized replies are ready to approve in CRM.', 'crm', [analysisStep, { title: 'Classify customer sentiment', desc: 'Separating praise, questions, and recovery opportunities.', model: 'Language understanding route' }, { title: 'Draft personalized replies', desc: 'Writing brand-safe responses matched to each customer situation.', model: 'Copy generation route' }]),
        inventory: workflow('Forecasting inventory...', 'Inventory forecast is ready', 'Expected demand, recommended stock levels, and risk flags are available in Analytics.', 'analytics', [analysisStep, { title: 'Match historical patterns', desc: 'Comparing similar weeks, holidays, and weather conditions.', model: 'Forecasting route' }, { title: 'Calculate next-week demand', desc: 'Estimating item-level needs and likely stock pressure.', model: 'Predictive route' }, { title: 'Flag operational risks', desc: 'Highlighting shortages, overstock, and supplier timing concerns.', model: 'Decision route' }]),
        'social-pack': workflow('Creating social content pack...', 'Social content pack is ready', 'A week of hooks, captions, hashtags, and visual briefs is prepared in Marketing.', 'marketing', [analysisStep, { title: 'Choose weekly content angles', desc: 'Selecting useful themes from products, customer behavior, and business goals.', model: 'Content strategy route' }, { title: 'Write platform-ready posts', desc: 'Generating concise posts with channel-appropriate hooks and calls to action.', model: 'Copy generation route' }, { title: 'Create visual briefs', desc: 'Preparing image directions that match each post.', model: 'Creative route' }]),
        'competitor-watch': workflow('Checking competitor changes...', 'Competitor watch is complete', 'New offers and a recommended response plan are ready in Marketing.', 'marketing', [analysisStep, { title: 'Scan competitor changes', desc: 'Reviewing public pricing, promotions, and positioning changes.', model: 'Web research route' }, { title: 'Rank material changes', desc: 'Separating important market moves from noise.', model: 'Analysis route' }, { title: 'Build response options', desc: 'Creating practical actions without copying competitor tactics.', model: 'Strategy generation route' }]),
        'win-back': workflow('Building customer win-back...', 'Win-back campaign is ready', 'Inactive customer segments and personalized reactivation messages are ready in Marketing.', 'marketing', [analysisStep, { title: 'Find inactive customer groups', desc: 'Grouping customers by purchase history and likely reason for inactivity.', model: 'Customer analysis route' }, { title: 'Select the right incentive', desc: 'Choosing value-based offers while protecting margin.', model: 'Decision route' }, { title: 'Draft the campaign sequence', desc: 'Preparing messages and follow-up timing for each group.', model: 'Copy generation route' }]),
        'analytics-report': workflow('Generating business report...', 'Weekly business report is ready', 'The key changes, likely causes, and next actions are available in Analytics.', 'analytics', [analysisStep, { title: 'Explain important changes', desc: 'Connecting metric movement to products, customers, and timing.', model: 'Business intelligence route' }, { title: 'Prioritize opportunities', desc: 'Ranking the most useful actions by impact and effort.', model: 'Decision route' }, { title: 'Write the executive summary', desc: 'Producing a concise report for the week ahead.', model: 'Report generation route' }]),
        'demand-forecast': workflow('Forecasting demand...', 'Demand forecast is ready', 'Demand estimates and inventory or staffing risks are available in Analytics.', 'analytics', [analysisStep, { title: 'Match seasonal patterns', desc: 'Reviewing recent momentum and comparable historical periods.', model: 'Forecasting route' }, { title: 'Estimate demand ranges', desc: 'Producing expected, low, and high demand scenarios.', model: 'Predictive route' }, { title: 'Recommend preparation', desc: 'Converting the forecast into stock and staffing actions.', model: 'Decision route' }]),
        'profit-leaks': workflow('Finding profit leaks...', 'Profit leak analysis is ready', 'Margin pressure, avoidable waste, and prioritized fixes are available in Analytics.', 'analytics', [analysisStep, { title: 'Review margin drivers', desc: 'Comparing price, cost, discount, and product mix changes.', model: 'Financial analysis route' }, { title: 'Detect avoidable loss', desc: 'Finding unusual waste, discounting, or low-margin behavior.', model: 'Anomaly route' }, { title: 'Recommend fixes', desc: 'Prioritizing changes by expected impact and difficulty.', model: 'Decision route' }]),
        'crm-followups': workflow('Drafting smart follow-ups...', 'Customer follow-ups are ready', 'Personalized messages and recommended timing are prepared in CRM.', 'crm', [analysisStep, { title: 'Prioritize customer signals', desc: 'Ranking opportunities, unresolved needs, and follow-up urgency.', model: 'Customer intelligence route' }, { title: 'Choose message intent', desc: 'Selecting thank-you, recovery, referral, or sales follow-up.', model: 'Decision route' }, { title: 'Draft personalized messages', desc: 'Writing concise follow-ups grounded in each customer history.', model: 'Copy generation route' }]),
        'retention-watch': workflow('Building retention sequence...', 'Retention sequence is ready', 'At-risk customers and targeted recovery steps are available in CRM.', 'crm', [analysisStep, { title: 'Identify churn signals', desc: 'Finding inactivity, declining frequency, and unresolved friction.', model: 'Retention analysis route' }, { title: 'Choose recovery actions', desc: 'Matching each risk pattern to an appropriate next step.', model: 'Decision route' }, { title: 'Prepare outreach sequence', desc: 'Drafting messages and timing for the highest-priority customers.', model: 'Copy generation route' }]),
        'lead-qualifier': workflow('Qualifying new leads...', 'Lead qualification is ready', 'Lead scores, reasons, and recommended replies are available in CRM.', 'crm', [analysisStep, { title: 'Extract buying signals', desc: 'Reviewing need, timing, budget indicators, and engagement.', model: 'Language understanding route' }, { title: 'Score and segment leads', desc: 'Ranking leads by fit and readiness to buy.', model: 'Scoring route' }, { title: 'Prepare next responses', desc: 'Drafting the best reply for each lead segment.', model: 'Copy generation route' }])
    };
}

function workflow(title, resultTitle, resultDescription, view, steps) {
    return { title, resultTitle, resultDescription, view, steps };
}

function initializeSettings() {
    const form = document.getElementById('workspaceSettingsForm');
    const status = document.getElementById('settingsStatus');
    const resetButton = document.getElementById('resetSettingsButton');
    const clearLocalDataButton = document.getElementById('clearLocalDataButton');
    const integrationButtons = document.querySelectorAll('.integration-connect-btn[data-integration]');
    if (!form || !status) return;

    const defaultSettings = readSettingsForm(form);
    const savedSettings = safeJsonParse(safeStorageGet(STORAGE_KEYS.settings), {});
    writeSettingsForm(form, { ...defaultSettings, ...savedSettings });
    applyCustomization(readSettingsForm(form));

    let integrations = safeJsonParse(safeStorageGet(STORAGE_KEYS.integrations), {});
    integrationButtons.forEach((button) => {
        updateIntegrationButton(button, Boolean(integrations[button.dataset.integration]));
        button.addEventListener('click', () => {
            const id = button.dataset.integration;
            integrations[id] = !integrations[id];
            safeStorageSet(STORAGE_KEYS.integrations, JSON.stringify(integrations));
            updateIntegrationButton(button, integrations[id]);
            showSettingsStatus(integrations[id] ? 'Connection enabled' : 'Connection removed', true);
        });
    });

    form.addEventListener('input', (event) => {
        if (event.target.matches('[name="theme"], [name="accentColor"], [name="density"], [name="textSize"], [name="cardStyle"], [name="cornerStyle"], [name="reduceMotion"], [name="highContrast"], [name="displayName"]')) {
            applyCustomization(readSettingsForm(form));
        }
        form.classList.add('has-unsaved-changes');
        showSettingsStatus('Unsaved changes', false);
    });

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const values = readSettingsForm(form);
        safeStorageSet(STORAGE_KEYS.settings, JSON.stringify(values));
        safeStorageSet(STORAGE_KEYS.sidebarCollapsed, String(Boolean(values.sidebarDefaultCollapsed)));
        applyCustomization(values);
        document.dispatchEvent(new CustomEvent('outcomeai:set-sidebar-collapsed', {
            detail: { collapsed: Boolean(values.sidebarDefaultCollapsed) }
        }));
        form.classList.remove('has-unsaved-changes');
        showSettingsStatus('All settings saved', true);
    });

    resetButton?.addEventListener('click', () => {
        writeSettingsForm(form, defaultSettings);
        applyCustomization(defaultSettings);
        form.classList.add('has-unsaved-changes');
        showSettingsStatus('Defaults restored — save to keep them', false);
    });

    let clearConfirmationTimer;
    clearLocalDataButton?.addEventListener('click', () => {
        if (clearLocalDataButton.dataset.confirming !== 'true') {
            clearLocalDataButton.dataset.confirming = 'true';
            clearLocalDataButton.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i> Click again to confirm';
            clearConfirmationTimer = window.setTimeout(resetClearButton, 4000);
            return;
        }

        window.clearTimeout(clearConfirmationTimer);
        safeStorageRemove(STORAGE_KEYS.settings);
        safeStorageRemove(STORAGE_KEYS.integrations);
        safeStorageRemove(STORAGE_KEYS.sidebarCollapsed);
        writeSettingsForm(form, defaultSettings);
        applyCustomization(defaultSettings);
        integrations = {};
        integrationButtons.forEach((button) => updateIntegrationButton(button, false));
        document.dispatchEvent(new CustomEvent('outcomeai:set-sidebar-collapsed', { detail: { collapsed: false } }));
        form.classList.remove('has-unsaved-changes');
        resetClearButton();
        showSettingsStatus('Local preferences cleared', true);
    });

    function resetClearButton() {
        if (!clearLocalDataButton) return;
        clearLocalDataButton.dataset.confirming = 'false';
        clearLocalDataButton.innerHTML = '<i class="fa-solid fa-trash-can" aria-hidden="true"></i> Clear local preferences';
    }

    function showSettingsStatus(message, saved) {
        status.textContent = message;
        status.classList.toggle('saved', saved);
        status.classList.toggle('pending', !saved);
    }

    function updateIntegrationButton(button, connected) {
        const row = button.closest('.integration-row');
        button.textContent = connected ? 'Connected' : 'Connect';
        button.classList.toggle('connected', connected);
        row?.classList.toggle('connected', connected);
    }
}

function readSettingsForm(form) {
    const values = {};
    new FormData(form).forEach((value, key) => { values[key] = value; });
    form.querySelectorAll('input[type="checkbox"]').forEach((checkbox) => {
        values[checkbox.name] = checkbox.checked;
    });
    return values;
}

function writeSettingsForm(form, values) {
    Object.entries(values).forEach(([name, value]) => {
        const controls = Array.from(form.querySelectorAll(`[name="${CSS.escape(name)}"]`));
        controls.forEach((control) => {
            if (control.type === 'checkbox') control.checked = Boolean(value);
            else if (control.type === 'radio') control.checked = control.value === String(value);
            else control.value = String(value ?? '');
        });
    });
}

function applyCustomization(values) {
    const root = document.documentElement;
    const accent = ACCENT_PRESETS[values.accentColor] || ACCENT_PRESETS.indigo;
    root.dataset.theme = ['dark', 'midnight', 'light'].includes(values.theme) ? values.theme : 'dark';
    root.dataset.density = values.density === 'compact' ? 'compact' : 'comfortable';
    root.dataset.textSize = ['small', 'large'].includes(values.textSize) ? values.textSize : 'standard';
    root.dataset.cardStyle = ['solid', 'minimal'].includes(values.cardStyle) ? values.cardStyle : 'glass';
    root.dataset.cornerStyle = ['soft', 'sharp'].includes(values.cornerStyle) ? values.cornerStyle : 'rounded';
    root.dataset.motion = values.reduceMotion ? 'reduced' : 'full';
    root.dataset.contrast = values.highContrast ? 'high' : 'standard';
    root.style.setProperty('--accent', accent.base);
    root.style.setProperty('--accent-hover', accent.hover);
    root.style.setProperty('--accent-rgb', accent.rgb);
    root.style.setProperty('--grad-1', accent.gradient);

    const displayName = String(values.displayName || document.body.dataset.originalUserDisplayName || '').trim();
    document.querySelectorAll('[data-user-display-name]').forEach((element) => {
        element.textContent = displayName;
    });
}

function initializeBilling() {
    const upgradeButton = document.getElementById('upgradeButton');
    const profileUpgradeButton = document.getElementById('profileUpgradeButton');
    const settingsUpgradeButton = document.getElementById('settingsUpgradeButton');
    const upgradeModal = document.getElementById('upgradeModal');
    const closeUpgradeModal = document.getElementById('closeUpgradeModal');
    const paymentMessage = document.getElementById('paymentMessage');
    const razorpayButtons = document.querySelectorAll('.razorpay-pay-btn');
    const paypalSlots = document.querySelectorAll('.paypal-button-slot[data-plan-id]');

    if (!upgradeButton || !upgradeModal || !closeUpgradeModal || !paymentMessage) {
        return;
    }

    const PLAN_LEVELS = Object.freeze({ free: 0, starter: 1, pro: 2, business: 3 });
    let billingState = normalizeBillingState({
        currentPlanId: document.body.dataset.currentPlanId,
        currentPlanName: document.body.dataset.currentPlanName,
        planExpiresAt: document.body.dataset.planExpiresAt || null
    });
    let paypalLoadingPromise;
    let paypalRendered = false;
    let billingRefreshPromise;
    let lastBillingRefreshAt = 0;

    window.OrexisBilling = {
        get current() {
            return { ...billingState };
        },
        hasAccess(requiredPlanId = 'pro') {
            return (PLAN_LEVELS[billingState.currentPlanId] || 0) >= (PLAN_LEVELS[requiredPlanId] || 0);
        },
        refresh() {
            return refreshBillingState();
        }
    };

    applyBillingState(billingState, { announce: false });

    [upgradeButton, profileUpgradeButton, settingsUpgradeButton].filter(Boolean).forEach((trigger) => {
        trigger.addEventListener('click', openUpgradeModal);
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

    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') refreshBillingState({ quiet: true });
    });
    window.addEventListener('focus', () => refreshBillingState({ quiet: true }));

    razorpayButtons.forEach((button) => {
        button.addEventListener('click', () => startRazorpayCheckout(button));
    });

    async function openUpgradeModal() {
        document.dispatchEvent(new Event('outcomeai:close-profile-menu'));
        openModal(upgradeModal);
        refreshBillingState({ quiet: true });
        if (document.body.dataset.paypalConfigured === 'true' && !paypalRendered) {
            try {
                await renderPayPalButtons();
            } catch (error) {
                showPaymentMessage(error.message, 'error');
            }
        }
    }

    async function startRazorpayCheckout(button) {
        const planId = button.dataset.planId;
        let orderId = '';
        let checkoutHandled = false;
        setButtonBusy(button, true, 'Opening Razorpay…');
        clearPaymentMessage();
        try {
            const order = await postJson('/api/payments/razorpay/order', { planId });
            orderId = order.orderId;
            await loadExternalScript('https://checkout.razorpay.com/v1/checkout.js', 'razorpay-checkout-sdk');
            if (typeof window.Razorpay !== 'function') {
                throw new Error('Razorpay Checkout could not be loaded.');
            }

            const checkout = new window.Razorpay({
                key: order.keyId,
                amount: order.amount,
                currency: order.currency,
                name: 'OrexisAI',
                description: `${order.plan.name} plan - 30 days`,
                order_id: order.orderId,
                prefill: { email: document.body.dataset.userEmail || '' },
                theme: { color: '#6366f1' },
                handler: async (response) => {
                    checkoutHandled = true;
                    showPaymentMessage('Verifying payment and activating your plan…', 'neutral');
                    try {
                        const result = await postJson('/api/payments/razorpay/verify', {
                            planId,
                            razorpay_order_id: response.razorpay_order_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature
                        });
                        paymentSucceeded(result.billing, result.plan);
                    } catch (error) {
                        if (error.code === 'RAZORPAY_PAYMENT_PENDING') {
                            showPaymentMessage(error.message, 'neutral');
                            try {
                                const status = await waitForRazorpayActivation(orderId);
                                paymentSucceeded(status.billing, status.plan);
                            } catch (pendingError) {
                                showPaymentMessage(pendingError.message, pendingError.code === 'PAYMENT_STILL_PENDING' ? 'neutral' : 'error');
                            }
                            return;
                        }
                        showPaymentMessage(error.message, 'error');
                    }
                },
                modal: {
                    ondismiss: () => {
                        if (checkoutHandled) return;
                        showPaymentMessage('Razorpay checkout was closed. No plan changes were made.', 'neutral');
                        if (orderId) {
                            postJson('/api/payments/razorpay/cancel', { orderId }).catch(() => {});
                        }
                    }
                }
            });
            checkout.on('payment.failed', (response) => {
                checkoutHandled = true;
                const message = response?.error?.description || 'Razorpay payment failed.';
                const failedOrderId = response?.error?.metadata?.order_id || orderId;
                const paymentId = response?.error?.metadata?.payment_id || '';
                showPaymentMessage(message, 'error');
                if (failedOrderId) {
                    postJson('/api/payments/razorpay/failure', {
                        orderId: failedOrderId,
                        paymentId
                    }).catch(() => {});
                }
            });
            checkout.open();
        } catch (error) {
            showPaymentMessage(error.message, 'error');
        } finally {
            setButtonBusy(button, false);
        }
    }

    async function waitForRazorpayActivation(orderId) {
        for (let attempt = 0; attempt < 12; attempt += 1) {
            await delay(attempt === 0 ? 1000 : 2000);
            const status = await postJson('/api/payments/razorpay/status', { orderId });
            if (status.billing) applyBillingState(status.billing, { announce: false });
            if (status.paymentStatus === 'completed' || status.paymentStatus === 'partially_refunded') {
                return status;
            }
            if (['failed', 'cancelled', 'refunded'].includes(status.paymentStatus)) {
                const error = new Error(status.paymentStatus === 'refunded'
                    ? 'The payment was refunded and the plan was not activated.'
                    : `The payment is ${status.paymentStatus}. No plan changes were made.`);
                error.code = `PAYMENT_${status.paymentStatus.toUpperCase()}`;
                throw error;
            }
        }
        const error = new Error('The payment is still pending. Your plan will activate automatically after Razorpay confirms capture.');
        error.code = 'PAYMENT_STILL_PENDING';
        throw error;
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
                    paymentSucceeded(result.billing, result.plan);
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

    async function refreshBillingState({ quiet = false } = {}) {
        const now = Date.now();
        if (billingRefreshPromise) return billingRefreshPromise;
        if (quiet && now - lastBillingRefreshAt < 5000) return billingState;
        billingRefreshPromise = requestJson('/api/billing/profile')
            .then((result) => {
                lastBillingRefreshAt = Date.now();
                if (result.billing) applyBillingState(result.billing, { announce: false });
                return billingState;
            })
            .catch((error) => {
                if (!quiet) showPaymentMessage(error.message, 'error');
                return billingState;
            })
            .finally(() => {
                billingRefreshPromise = null;
            });
        return billingRefreshPromise;
    }

    function paymentSucceeded(billing, plan) {
        const nextBilling = normalizeBillingState(billing || {
            currentPlanId: plan?.id,
            currentPlanName: plan?.name,
            planExpiresAt: null
        });
        applyBillingState(nextBilling, { announce: true });
        showPaymentMessage(`${nextBilling.currentPlanName} is now active on your account.`, 'success');
    }

    function applyBillingState(nextBilling, { announce = true } = {}) {
        const normalized = normalizeBillingState(nextBilling);
        const previous = billingState;
        billingState = normalized;

        document.body.dataset.currentPlanId = normalized.currentPlanId;
        document.body.dataset.currentPlanName = normalized.currentPlanName;
        document.body.dataset.planExpiresAt = normalized.planExpiresAt || '';
        document.body.classList.remove('plan-free', 'plan-starter', 'plan-pro', 'plan-business', 'has-paid-plan', 'has-pro-access');
        document.body.classList.add(`plan-${normalized.currentPlanId}`);
        if ((PLAN_LEVELS[normalized.currentPlanId] || 0) > 0) document.body.classList.add('has-paid-plan');
        if ((PLAN_LEVELS[normalized.currentPlanId] || 0) >= PLAN_LEVELS.pro) document.body.classList.add('has-pro-access');

        const currentPlanName = document.getElementById('currentPlanName');
        if (currentPlanName) currentPlanName.textContent = `${normalized.currentPlanName} plan`;
        document.querySelectorAll('[data-current-plan-name]').forEach((element) => {
            if (element !== document.body) {
                element.textContent = normalized.currentPlanName;
            }
        });
        document.querySelectorAll('[data-current-plan-expiry]').forEach((element) => {
            element.textContent = normalized.planExpiresAt
                ? `Active until ${formatBillingDate(normalized.planExpiresAt)}`
                : 'No expiry';
        });

        const pill = upgradeButton.querySelector('.upgrade-pill');
        if (pill) pill.textContent = normalized.currentPlanName;

        document.querySelectorAll('.plan-card').forEach((card) => {
            const isCurrent = card.dataset.planCard === normalized.currentPlanId;
            card.classList.toggle('current', isCurrent);
            card.toggleAttribute('aria-current', isCurrent);
            const cardHead = card.querySelector('.plan-card-head');
            card.querySelector('.current-badge')?.remove();
            if (isCurrent && cardHead) {
                const badge = document.createElement('span');
                badge.className = 'current-badge';
                badge.textContent = 'Current';
                cardHead.appendChild(badge);
            }
            const razorpayButton = card.querySelector('.razorpay-pay-btn');
            if (razorpayButton && document.body.dataset.razorpayConfigured === 'true') {
                razorpayButton.innerHTML = `<i class="fa-solid fa-credit-card" aria-hidden="true"></i>${isCurrent ? 'Extend with Razorpay' : 'Pay with Razorpay'}`;
            }
            const defaultButton = card.querySelector('.plan-disabled-btn');
            if (card.dataset.planCard === 'free' && defaultButton) {
                defaultButton.textContent = isCurrent ? 'Your current plan' : 'Included by default';
            }
        });

        if (announce && (previous.currentPlanId !== normalized.currentPlanId
            || previous.planExpiresAt !== normalized.planExpiresAt)) {
            document.dispatchEvent(new CustomEvent('orexisai:billing-updated', {
                detail: { ...normalized }
            }));
        }
    }

    function normalizeBillingState(value = {}) {
        const currentPlanId = PLAN_LEVELS[value.currentPlanId] === undefined ? 'free' : value.currentPlanId;
        const planCard = document.querySelector(`.plan-card[data-plan-card="${currentPlanId}"] h3`);
        return {
            currentPlanId,
            currentPlanName: String(value.currentPlanName || planCard?.textContent || 'Free').trim(),
            planExpiresAt: value.planExpiresAt || null
        };
    }

    function formatBillingDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? 'the confirmed date'
            : new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
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

function delay(milliseconds) {
    return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

async function requestJson(url, options = {}) {
    const method = options.method || 'GET';
    const requestOptions = {
        method,
        credentials: 'same-origin',
        headers: {}
    };
    if (options.body !== undefined) {
        requestOptions.headers['Content-Type'] = 'application/json';
        requestOptions.body = JSON.stringify(options.body);
    }

    const response = await fetch(url, requestOptions);
    let value = {};
    try {
        value = await response.json();
    } catch {
        throw new Error('The server returned an invalid response.');
    }
    if (!response.ok) {
        const error = new Error(value.error || 'Request failed.');
        error.status = response.status;
        error.code = value.code || 'REQUEST_FAILED';
        error.payload = value;
        throw error;
    }
    return value;
}

async function postJson(url, body) {
    return requestJson(url, { method: 'POST', body });
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

function safeStorageGet(key) {
    try {
        return window.localStorage.getItem(key);
    } catch {
        return null;
    }
}

function safeStorageSet(key, value) {
    try {
        window.localStorage.setItem(key, value);
    } catch {
        // Storage can be unavailable in strict privacy modes; the UI still works for this session.
    }
}

function safeStorageRemove(key) {
    try {
        window.localStorage.removeItem(key);
    } catch {
        // Storage can be unavailable in strict privacy modes; the UI still works for this session.
    }
}

function safeJsonParse(value, fallback) {
    if (!value) return fallback;
    try {
        const parsed = JSON.parse(value);
        return parsed && typeof parsed === 'object' ? parsed : fallback;
    } catch {
        return fallback;
    }
}
