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

const OREXIS_ROBOT_PARTS = Object.freeze([
    'antenna',
    'head',
    'body',
    'arm-left',
    'arm-right',
    'leg-left',
    'leg-right'
]);

document.addEventListener('DOMContentLoaded', () => {
    initializeLoginBrandReveal();
    initializeThemeToggle();
    initializeOrexisIntroduction();
    initializeSidebarNavigation();
    initializeWorkspaceSearch();
    initializeAgentChat();
    initializeWorkflows();
    initializeBusinessData();
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

function initializeThemeToggle() {
    const root = document.documentElement;
    const button = document.getElementById('themeToggleButton');
    const label = button?.querySelector('.theme-toggle-text');
    if (!button || !label) return;

    let transitionTimer = 0;

    const updateToggle = () => {
        const isLight = root.dataset.theme === 'light';
        button.classList.toggle('is-light', isLight);
        button.setAttribute('aria-pressed', String(isLight));
        button.setAttribute('aria-label', isLight ? 'Switch to dark mode' : 'Switch to light mode');
        button.title = isLight ? 'Switch to dark mode' : 'Switch to light mode';
        label.textContent = isLight ? 'Dark' : 'Light';
    };

    const setTheme = (theme, { persist = true } = {}) => {
        const nextTheme = theme === 'light' ? 'light' : 'dark';
        if (persist) {
            const settings = safeJsonParse(safeStorageGet(STORAGE_KEYS.settings), {});
            safeStorageSet(STORAGE_KEYS.settings, JSON.stringify({ ...settings, theme: nextTheme }));
        }

        document.querySelectorAll('[name="theme"]').forEach((control) => {
            control.checked = control.value === nextTheme;
        });

        window.clearTimeout(transitionTimer);
        root.classList.add('theme-is-transitioning');
        root.dataset.theme = nextTheme;
        root.style.colorScheme = nextTheme === 'light' ? 'light' : 'dark';
        updateToggle();
        document.dispatchEvent(new CustomEvent('outcomeai:theme-changed', { detail: { theme: nextTheme } }));
        transitionTimer = window.setTimeout(() => root.classList.remove('theme-is-transitioning'), 420);
    };

    button.addEventListener('click', () => {
        setTheme(root.dataset.theme === 'light' ? 'dark' : 'light');
    });

    document.addEventListener('outcomeai:theme-changed', updateToggle);
    window.addEventListener('storage', (event) => {
        if (event.key !== STORAGE_KEYS.settings) return;
        const settings = safeJsonParse(event.newValue, {});
        setTheme(settings.theme === 'light' ? 'light' : 'dark', { persist: false });
    });

    updateToggle();
}

function initializeOrexisIntroduction() {
    const trigger = document.getElementById('aboutOrexisButton');
    const overlay = document.getElementById('orexisIntro');
    const closeButton = document.getElementById('orexisIntroClose');
    const message = document.getElementById('orexisIntroMessage');
    const appContainer = document.getElementById('appContainer');
    if (!trigger || !overlay || !closeButton || !message || !appContainer) return;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const messages = [
        'Hello, you!',
        'I’m OrexisAI.',
        'Your intelligent AI agent.',
        'Let’s get things done together.'
    ];
    const messageTimes = [520, 2100, 3850, 5750];
    const timers = new Set();
    let isOpen = false;
    let returnFocus = null;

    const schedule = (callback, delay) => {
        const timer = window.setTimeout(() => {
            timers.delete(timer);
            callback();
        }, delay);
        timers.add(timer);
    };

    const clearSchedule = () => {
        timers.forEach((timer) => window.clearTimeout(timer));
        timers.clear();
        message.getAnimations?.().forEach((animation) => animation.cancel());
        message.querySelectorAll('span').forEach((character) => {
            character.getAnimations?.().forEach((animation) => animation.cancel());
        });
    };

    const renderMessage = (text, index) => {
        message.replaceChildren();
        message.dataset.messageIndex = String(index);
        const fragment = document.createDocumentFragment();
        const characters = [];

        for (const value of Array.from(text)) {
            const character = document.createElement('span');
            character.textContent = value;
            character.setAttribute('aria-hidden', 'true');
            characters.push(character);
            fragment.appendChild(character);
        }

        message.setAttribute('aria-label', text);
        message.appendChild(fragment);

        if (reducedMotion.matches || rootMotionIsReduced()) return;

        message.animate([
            { opacity: 0, transform: 'translate3d(0, 14px, 0) scale(0.985)' },
            { opacity: 1, transform: 'translate3d(0, 0, 0) scale(1)' }
        ], {
            duration: 620,
            easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
            fill: 'both'
        });

        characters.forEach((character, characterIndex) => {
            character.animate([
                { opacity: 0, transform: 'translate3d(0, 8px, 0)' },
                { opacity: 1, transform: 'translate3d(0, 0, 0)' }
            ], {
                duration: 440,
                delay: characterIndex * 28,
                easing: 'cubic-bezier(0.16, 1, 0.3, 1)',
                fill: 'both'
            });
        });
    };

    const finishClose = () => {
        overlay.hidden = true;
        overlay.setAttribute('aria-hidden', 'true');
        overlay.classList.remove('is-open', 'is-closing', 'is-returning');
        document.body.classList.remove('orexis-intro-open');
        appContainer.removeAttribute('inert');
        appContainer.removeAttribute('aria-hidden');
        returnFocus?.focus?.({ preventScroll: true });
        returnFocus = null;
    };

    const closeIntro = () => {
        if (!isOpen) return;
        isOpen = false;
        clearSchedule();
        overlay.classList.remove('is-open', 'is-returning');
        overlay.classList.add('is-closing');
        schedule(finishClose, reducedMotion.matches || rootMotionIsReduced() ? 40 : 520);
    };

    const openIntro = () => {
        if (isOpen) return;
        isOpen = true;
        returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : trigger;
        clearSchedule();
        message.replaceChildren();
        overlay.hidden = false;
        overlay.setAttribute('aria-hidden', 'false');
        overlay.classList.remove('is-closing', 'is-returning');
        document.body.classList.add('orexis-intro-open');
        appContainer.setAttribute('inert', '');
        appContainer.setAttribute('aria-hidden', 'true');

        window.requestAnimationFrame(() => {
            window.requestAnimationFrame(() => overlay.classList.add('is-open'));
        });

        closeButton.focus({ preventScroll: true });
        messages.forEach((text, index) => schedule(() => renderMessage(text, index), messageTimes[index]));
        schedule(() => overlay.classList.add('is-returning'), 7900);
        schedule(closeIntro, 8500);
    };

    const handleKeydown = (event) => {
        if (!isOpen) return;
        if (event.key === 'Escape') {
            event.preventDefault();
            closeIntro();
            return;
        }
        if (event.key === 'Tab') {
            event.preventDefault();
            closeButton.focus({ preventScroll: true });
        }
    };

    trigger.addEventListener('click', openIntro);
    closeButton.addEventListener('click', closeIntro);
    document.addEventListener('keydown', handleKeydown);
}

function rootMotionIsReduced() {
    return document.documentElement.dataset.motion === 'reduced';
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
    const aboutOrexisButton = document.getElementById('aboutOrexisButton');
    const views = Array.from(document.querySelectorAll('.dashboard-view[data-view]'));
    const viewTriggers = Array.from(document.querySelectorAll('[data-view-target]'));
    const primaryNavItems = Array.from(document.querySelectorAll('.nav-menu [data-view-target]'));
    const navMenu = sidebar?.querySelector('.nav-menu');
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const navMotionTimers = new Map();
    let navMotionFrame = 0;
    let navImmediateCleanupFrame = 0;

    if (!sidebar || !sidebarToggle || !profileButton || !profileMenu || !pageKicker || !pageTitle || !pageSubtitle || !searchInput || !navMenu || views.length === 0) {
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
        trigger.addEventListener('click', () => {
            if (primaryNavItems.includes(trigger)) {
                replayNavItemMotion(trigger, 'is-activating');
            }
            activateView(trigger.dataset.viewTarget, true);
        });
    });

    primaryNavItems.forEach((item) => {
        item.addEventListener('pointerenter', (event) => {
            if (event.pointerType !== 'touch') replayNavItemMotion(item, 'is-icon-animating');
        }, { passive: true });
        item.addEventListener('focus', () => replayNavItemMotion(item, 'is-icon-animating'));
    });

    if (typeof ResizeObserver === 'function') {
        const navResizeObserver = new ResizeObserver(() => scheduleActiveNavSync(true));
        navResizeObserver.observe(navMenu);
        primaryNavItems.forEach((item) => navResizeObserver.observe(item));
    }
    window.addEventListener('resize', () => scheduleActiveNavSync(true), { passive: true });

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
        scheduleActiveNavSync(!shouldFocus);

        pageKicker.textContent = metadata.kicker;
        pageTitle.textContent = metadata.title;
        pageSubtitle.textContent = metadata.subtitle;
        searchInput.placeholder = metadata.search;
        aboutOrexisButton?.toggleAttribute('hidden', viewName !== 'agent');
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
        scheduleActiveNavSync(true);
        if (isCollapsed) setProfileMenuOpen(false);
    }

    function replayNavItemMotion(item, className) {
        if (!item || reducedMotionQuery.matches || document.documentElement.dataset.motion === 'reduced') return;

        const key = `${item.dataset.viewTarget || 'nav'}:${className}`;
        window.clearTimeout(navMotionTimers.get(key));
        item.classList.remove(className);
        if (className === 'is-activating') navMenu.classList.remove('nav-is-activating');

        window.requestAnimationFrame(() => {
            if (!item.isConnected) return;
            item.classList.add(className);
            if (className === 'is-activating') navMenu.classList.add('nav-is-activating');
            navMotionTimers.set(key, window.setTimeout(() => {
                item.classList.remove(className);
                if (className === 'is-activating') navMenu.classList.remove('nav-is-activating');
                navMotionTimers.delete(key);
            }, 940));
        });
    }

    function scheduleActiveNavSync(immediate = false) {
        if (navMotionFrame) window.cancelAnimationFrame(navMotionFrame);
        navMotionFrame = window.requestAnimationFrame(() => {
            navMotionFrame = 0;
            syncActiveNavMotion(immediate);
        });
    }

    function syncActiveNavMotion(immediate = false) {
        const activeItem = primaryNavItems.find((item) => item.classList.contains('active'));
        navMenu.classList.add('nav-motion-ready');

        if (!activeItem) {
            navMenu.classList.remove('nav-motion-has-active');
            return;
        }

        const menuRect = navMenu.getBoundingClientRect();
        const itemRect = activeItem.getBoundingClientRect();
        const x = itemRect.left - menuRect.left;
        const y = itemRect.top - menuRect.top;
        const indicatorHeight = Math.min(20, Math.max(12, itemRect.height - 16));
        const indicatorY = y + ((itemRect.height - indicatorHeight) / 2);

        if (immediate) navMenu.classList.add('nav-motion-immediate');
        navMenu.style.setProperty('--nav-active-x', `${x.toFixed(2)}px`);
        navMenu.style.setProperty('--nav-active-y', `${y.toFixed(2)}px`);
        navMenu.style.setProperty('--nav-active-width', `${itemRect.width.toFixed(2)}px`);
        navMenu.style.setProperty('--nav-active-height', `${itemRect.height.toFixed(2)}px`);
        navMenu.style.setProperty('--nav-indicator-x', `${x.toFixed(2)}px`);
        navMenu.style.setProperty('--nav-indicator-y', `${indicatorY.toFixed(2)}px`);
        navMenu.style.setProperty('--nav-indicator-height', `${indicatorHeight.toFixed(2)}px`);
        navMenu.classList.add('nav-motion-has-active');

        if (immediate) {
            if (navImmediateCleanupFrame) window.cancelAnimationFrame(navImmediateCleanupFrame);
            navImmediateCleanupFrame = window.requestAnimationFrame(() => {
                navImmediateCleanupFrame = window.requestAnimationFrame(() => {
                    navImmediateCleanupFrame = 0;
                    navMenu.classList.remove('nav-motion-immediate');
                });
            });
        }
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
    const promptLimitStatus = document.getElementById('agentPromptLimitStatus');
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
        || !sendButton || !promptLimitStatus || !activeTitle || !renameButton || !deleteButton || !titleEditor || !titleInput
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
    let promptUsage = normalizeAgentPromptUsage({
        planId: document.body.dataset.agentPromptPlanId,
        planName: document.body.dataset.agentPromptPlanName,
        used: document.body.dataset.agentPromptsUsed,
        limit: document.body.dataset.agentPromptsLimit,
        periodKind: document.body.dataset.agentPromptPeriodKind,
        periodStart: document.body.dataset.agentPromptPeriodStart,
        periodEnd: document.body.dataset.agentPromptPeriodEnd
    });
    let conversations = [];
    let activeConversationId = null;
    let requestInFlight = false;
    let commandSubmissionInFlight = false;
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
    let activeShareMenu = null;
    let activeShareTrigger = null;
    let inputComposing = false;
    const reducedRobotMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const robotLifecycleTimers = new WeakMap();
    const robotArrivalTimers = new WeakMap();

    preloadAssistantRobotAssets();

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
    commandInput.addEventListener('compositionstart', () => { inputComposing = true; });
    commandInput.addEventListener('compositionend', () => {
        inputComposing = false;
        updateComposerControls();
    });
    commandInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && !inputComposing && event.keyCode !== 229) {
            event.preventDefault();
            if (!requestInFlight && !commandSubmissionInFlight && !uploadInFlight
                && (commandInput.value.trim() || pendingUploads.length > 0)) {
                commandForm.requestSubmit(sendButton);
            }
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
        if (event.key === 'Escape' && activeShareMenu) {
            event.preventDefault();
            closeResponseShareMenu(true);
        }
    });
    document.addEventListener('pointerdown', (event) => {
        if (!activeShareMenu) return;
        if (activeShareMenu.contains(event.target) || activeShareTrigger?.contains(event.target)) return;
        closeResponseShareMenu(false);
    });
    window.addEventListener('resize', () => closeResponseShareMenu(false));
    messageList.addEventListener('scroll', () => closeResponseShareMenu(false), { passive: true });

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
    document.addEventListener('orexisai:agent-usage-updated', (event) => {
        if (event.detail) applyAgentPromptUsage(event.detail);
    });
    updatePromptUsageStatus();
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
        if (!Number.isInteger(conversationId) || conversationId < 1 || requestInFlight) return false;
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
            return true;
        } catch (error) {
            if (activeConversationId === conversationId) clearConversation();
            setSyncStatus(error.message, 'error');
            await loadConversations();
            return false;
        }
    }

    async function sendCommand(event) {
        event.preventDefault();
        const draft = commandInput.value;
        if ((!draft.trim() && pendingUploads.length === 0) || requestInFlight
            || commandSubmissionInFlight || uploadInFlight) return;
        commandSubmissionInFlight = true;
        updateComposerControls();
        const uploadsForCommand = pendingUploads.map((item) => ({ ...item, files: [...item.files] }));
        const content = buildCommandContent(draft, uploadsForCommand);

        let conversationId = activeConversationId;
        if (!conversationId) {
            const conversation = await createConversation(false);
            conversationId = conversation?.id;
        }
        if (!conversationId) {
            commandSubmissionInFlight = false;
            updateComposerControls();
            return;
        }

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
        try {
            const result = await requestJson(`/api/chats/${conversationId}/messages`, {
                method: 'POST',
                body: { content }
            });
            if (result.promptUsage) applyAgentPromptUsage(result.promptUsage);
            if (commandInput.value === draft) commandInput.value = '';
            pendingUploads = [];
            renderPendingUploads();
            commandInput.dispatchEvent(new Event('input'));
            finalizeMessageArticle(pendingMessage, result.userMessage);
            finalizeMessageArticle(pendingReply, result.assistantMessage, { animateAssistantResponse: true });

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
            if (error.payload?.promptUsage) applyAgentPromptUsage(error.payload.promptUsage);
            if (error.payload?.commandSaved && error.payload.userMessage) {
                finalizeMessageArticle(pendingMessage, error.payload.userMessage);
                const technicalDetail = error.payload?.details && error.payload.details !== error.message
                    ? `\n\nDevelopment detail: ${error.payload.details}`
                    : '';
                finalizeMessageArticle(pendingReply, {
                    role: 'assistant',
                    content: `${error.message}${technicalDetail}`,
                    createdAt: new Date().toISOString(),
                    transientError: true
                });
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
                pendingMessage?.remove();
                pendingReply?.remove();
                if (!messageList.querySelector('.agent-message')) emptyState.hidden = false;
                setSyncStatus(error.message, 'error');
                if (error.code === 'AI_AGENT_PROMPT_LIMIT_REACHED') {
                    setUploadStatus(error.message, 'error', true);
                }
            }
        } finally {
            commandSubmissionInFlight = false;
            setBusy(false);
            commandInput.focus();
        }
    }

    function updateComposerControls() {
        const isBusy = requestInFlight || commandSubmissionInFlight || uploadInFlight;
        const hasContent = commandInput.value.trim().length > 0 || pendingUploads.length > 0;
        sendButton.disabled = isBusy || !hasContent;
        cameraButton.disabled = isBusy || pendingUploads.length >= MAX_PENDING_UPLOAD_GROUPS;
        folderButton.disabled = isBusy || pendingUploads.length >= MAX_PENDING_UPLOAD_GROUPS;
        attachmentList.querySelectorAll('[data-remove-upload]').forEach((button) => { button.disabled = isBusy; });
        updatePromptUsageStatus();
    }

    function updatePromptUsageStatus() {
        promptLimitStatus.textContent = `${promptUsage.used.toLocaleString()} / ${promptUsage.limit.toLocaleString()} prompts used`;
        promptLimitStatus.title = promptUsage.periodKind === 'calendar_month'
            ? `Free monthly AI Agent usage${promptUsage.periodEnd ? ` · resets ${formatAgentUsageDate(promptUsage.periodEnd)}` : ''}`
            : `${promptUsage.planName} 30-day AI Agent usage${promptUsage.periodEnd ? ` · resets ${formatAgentUsageDate(promptUsage.periodEnd)}` : ''}`;
        delete promptLimitStatus.dataset.state;
        commandForm.classList.remove('prompt-limit-warning', 'prompt-limit-reached');
        if (promptUsage.exhausted) {
            promptLimitStatus.dataset.state = 'limit';
            commandForm.classList.add('prompt-limit-reached');
            promptLimitStatus.textContent += promptUsage.periodKind === 'calendar_month'
                ? ' · Free monthly limit reached'
                : ` · ${promptUsage.planName} 30-day limit reached`;
        } else if (promptUsage.remaining <= Math.max(1, Math.ceil(promptUsage.limit * 0.1))) {
            promptLimitStatus.dataset.state = 'warning';
            commandForm.classList.add('prompt-limit-warning');
            promptLimitStatus.textContent += ` · ${promptUsage.remaining.toLocaleString()} remaining`;
        }
    }

    function applyAgentPromptUsage(value) {
        promptUsage = normalizeAgentPromptUsage(value);
        document.body.dataset.agentPromptPlanId = promptUsage.planId;
        document.body.dataset.agentPromptPlanName = promptUsage.planName;
        document.body.dataset.agentPromptsUsed = String(promptUsage.used);
        document.body.dataset.agentPromptsLimit = String(promptUsage.limit);
        document.body.dataset.agentPromptPeriodKind = promptUsage.periodKind;
        document.body.dataset.agentPromptPeriodStart = promptUsage.periodStart || '';
        document.body.dataset.agentPromptPeriodEnd = promptUsage.periodEnd || '';
        updateComposerControls();
    }

    function normalizeAgentPromptUsage(value = {}) {
        const limit = Math.max(1, Number.parseInt(String(value.limit || '5'), 10) || 5);
        const used = Math.max(0, Math.min(limit, Number.parseInt(String(value.used || '0'), 10) || 0));
        return {
            planId: String(value.planId || 'free'),
            planName: String(value.planName || 'Free'),
            limit,
            used,
            remaining: Math.max(0, limit - used),
            exhausted: value.exhausted === true || used >= limit,
            periodKind: value.periodKind === 'subscription' ? 'subscription' : 'calendar_month',
            periodStart: value.periodStart || '',
            periodEnd: value.periodEnd || ''
        };
    }

    function promptQuotaMessage(usage) {
        const resetText = usage.periodEnd ? ` It resets ${formatAgentUsageDate(usage.periodEnd)}.` : '';
        return usage.periodKind === 'calendar_month'
            ? `Your Free monthly AI Agent prompt limit has been reached.${resetText}`
            : `Your ${usage.planName} 30-day AI Agent prompt limit has been reached.${resetText}`;
    }

    function formatAgentUsageDate(value) {
        const date = new Date(value);
        return Number.isNaN(date.getTime())
            ? 'at the start of the next usage period'
            : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date);
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
        if (lines.length === 0) return draft;
        const base = draft.trim() ? draft : 'Use the uploaded files for this request.';
        return `${base}\n\nUploaded files:\n${lines.join('\n')}`;
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

    function preloadAssistantRobotAssets() {
        const sources = [
            '/orexis-robot/robot.png',
            ...OREXIS_ROBOT_PARTS.map((part) => `/orexis-robot/${part}.png`)
        ];
        sources.forEach((source) => {
            const image = new Image();
            image.decoding = 'async';
            image.src = source;
        });
    }

    function createAssistantRobot(initialState = 'idle', animateArrival = false) {
        const dock = document.createElement('div');
        dock.className = 'orexis-assistant-robot';
        dock.dataset.robotState = initialState;
        dock.setAttribute('role', 'img');
        updateAssistantRobotLabel(dock, initialState);

        const shadow = document.createElement('span');
        shadow.className = 'orexis-robot-shadow';
        shadow.setAttribute('aria-hidden', 'true');

        const stage = document.createElement('span');
        stage.className = 'orexis-robot-stage';
        stage.setAttribute('aria-hidden', 'true');

        const fallback = document.createElement('img');
        fallback.className = 'orexis-robot-fallback';
        fallback.src = '/orexis-robot/robot.png';
        fallback.alt = '';
        fallback.decoding = 'async';
        fallback.draggable = false;
        stage.appendChild(fallback);

        OREXIS_ROBOT_PARTS.forEach((part) => {
            const layer = document.createElement('span');
            layer.className = `orexis-robot-part orexis-robot-part-${part}`;
            const image = document.createElement('img');
            image.src = `/orexis-robot/${part}.png`;
            image.alt = '';
            image.decoding = 'async';
            image.draggable = false;
            layer.appendChild(image);
            stage.appendChild(layer);
        });

        const faceMotion = document.createElement('span');
        faceMotion.className = 'orexis-robot-face-motion';
        faceMotion.innerHTML = `
            <span class="orexis-robot-eyelid orexis-robot-eyelid-left"></span>
            <span class="orexis-robot-eyelid orexis-robot-eyelid-right"></span>
            <span class="orexis-robot-mouth-motion"></span>
        `;
        stage.appendChild(faceMotion);

        const thought = document.createElement('span');
        thought.className = 'orexis-robot-thought';
        thought.setAttribute('aria-hidden', 'true');
        thought.innerHTML = '<span></span><span></span><span></span>';

        dock.append(shadow, stage, thought);

        if (animateArrival && !reducedRobotMotion.matches && document.documentElement.dataset.motion !== 'reduced') {
            dock.dataset.robotArrival = 'true';
            const arrivalTimer = window.setTimeout(() => {
                if (dock.isConnected) delete dock.dataset.robotArrival;
                robotArrivalTimers.delete(dock);
            }, 1120);
            robotArrivalTimers.set(dock, arrivalTimer);
        }

        return dock;
    }

    function updateAssistantRobotLabel(dock, state) {
        const labels = {
            thinking: 'OrexisAI mascot is thinking',
            speaking: 'OrexisAI mascot is responding',
            celebrating: 'OrexisAI mascot is celebrating the completed response',
            error: 'OrexisAI mascot indicates a response error',
            idle: 'OrexisAI mascot is calmly sitting above the response'
        };
        dock.setAttribute('aria-label', labels[state] || labels.idle);
    }

    function applyAssistantRobotState(dock, state) {
        if (!dock) return;
        dock.dataset.robotState = state;
        updateAssistantRobotLabel(dock, state);
    }

    function setAssistantRobotState(article, state, { responseText = '', runCompletionSequence = false } = {}) {
        const dock = article?.querySelector('.orexis-assistant-robot');
        if (!dock) return;

        const activeTimer = robotLifecycleTimers.get(dock);
        if (activeTimer) window.clearTimeout(activeTimer);
        robotLifecycleTimers.delete(dock);
        applyAssistantRobotState(dock, state);

        if (!runCompletionSequence || state !== 'speaking' || reducedRobotMotion.matches
            || document.documentElement.dataset.motion === 'reduced') {
            return;
        }

        const speakingDuration = Math.min(2600, Math.max(1100, 720 + String(responseText).length * 3.5));
        const speakingTimer = window.setTimeout(() => {
            if (!dock.isConnected) return;
            applyAssistantRobotState(dock, 'celebrating');
            const celebrationTimer = window.setTimeout(() => {
                if (dock.isConnected) applyAssistantRobotState(dock, 'idle');
                robotLifecycleTimers.delete(dock);
            }, 1080);
            robotLifecycleTimers.set(dock, celebrationTimer);
        }, speakingDuration);
        robotLifecycleTimers.set(dock, speakingTimer);
    }

    function populateMessageBody(body, message, pending) {
        const label = document.createElement('strong');
        label.className = 'agent-message-author';
        label.textContent = message.role === 'assistant' ? 'OrexisAI' : 'You';

        const content = document.createElement('div');
        content.className = 'agent-message-content';
        renderAgentMessageContent(content, message.content, message.role === 'assistant');

        const meta = document.createElement('small');
        meta.textContent = pending
            ? (message.pendingLabel || 'Saving…')
            : message.transientError
                ? 'Not saved · check Gemini setup and retry'
                : formatMessageTime(message.createdAt);

        const footer = document.createElement('div');
        footer.className = 'agent-message-footer';
        footer.appendChild(meta);

        if (message.role === 'assistant' && !pending) {
            const actions = document.createElement('div');
            actions.className = 'agent-response-actions';
            actions.setAttribute('aria-label', 'AI response actions');

            const copyButton = createResponseActionButton({
                label: 'Copy',
                title: 'Copy response',
                icon: 'fa-regular fa-copy',
                className: 'agent-response-copy-button',
                onClick: (button) => copyResponse(button, message.content)
            });
            actions.appendChild(copyButton);

            if (Number.isSafeInteger(Number(message.id)) && Number(message.id) > 0 && !message.transientError) {
                const branchButton = createResponseActionButton({
                    label: 'Branch',
                    title: 'Branch into new chat',
                    icon: 'fa-solid fa-code-branch',
                    onClick: (button) => branchResponse(button, message)
                });
                actions.appendChild(branchButton);
            }

            const downloadButton = createResponseActionButton({
                label: 'Download',
                title: 'Download response as Markdown',
                icon: 'fa-solid fa-download',
                onClick: (button) => downloadResponse(button, message)
            });
            const shareButton = createResponseActionButton({
                label: 'Share',
                title: 'Share response',
                icon: 'fa-solid fa-share-nodes',
                onClick: (button) => shareResponse(button, message)
            });
            actions.append(downloadButton, shareButton);
            footer.appendChild(actions);
        }

        body.replaceChildren(label, content, footer);
    }

    function finalizeMessageArticle(article, message, { animateAssistantResponse = false } = {}) {
        if (!article?.isConnected) {
            return appendMessage(message, false);
        }

        article.classList.remove('pending', 'error');
        if (message.transientError) article.classList.add('error');
        article.dataset.searchText = String(message.content || '');
        if (message.id != null) article.dataset.messageId = String(message.id);

        const body = article.querySelector('.agent-message-body');
        if (body) populateMessageBody(body, message, false);

        if (message.role === 'assistant') {
            setAssistantRobotState(
                article,
                message.transientError ? 'error' : animateAssistantResponse ? 'speaking' : 'idle',
                {
                    responseText: message.content,
                    runCompletionSequence: animateAssistantResponse && !message.transientError
                }
            );
        }

        messageList.scrollTop = messageList.scrollHeight;
        return article;
    }

    function appendMessage(message, pending) {
        dismissWelcomeOrb(true);
        emptyState.hidden = true;
        const isAssistant = message.role === 'assistant';
        const article = document.createElement('article');
        article.className = `agent-message ${isAssistant ? 'assistant' : 'user'} searchable-item${pending ? ' pending' : ''}${message.transientError ? ' error' : ''}`;
        article.dataset.searchText = String(message.content || '');
        if (message.id != null) article.dataset.messageId = String(message.id);

        const body = document.createElement('div');
        body.className = 'agent-message-body';
        populateMessageBody(body, message, pending);

        if (isAssistant) {
            const robotState = message.transientError ? 'error' : pending ? 'thinking' : 'idle';
            article.append(createAssistantRobot(robotState, pending), body);
        } else {
            const avatar = document.createElement('span');
            avatar.className = 'agent-message-avatar';
            avatar.innerHTML = '<i class="fa-solid fa-user" aria-hidden="true"></i>';
            article.append(avatar, body);
        }

        messageList.appendChild(article);
        messageList.scrollTop = messageList.scrollHeight;
        return article;
    }

    function createResponseActionButton({ label, title, icon, className = '', onClick }) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `agent-response-action-button${className ? ` ${className}` : ''}`;
        button.setAttribute('aria-label', title);
        button.title = title;
        button.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${label}</span>`;
        button.addEventListener('click', () => onClick(button));
        return button;
    }

    async function copyResponse(button, responseText) {
        if (button.disabled) return;
        const snapshot = captureResponseAction(button);
        button.disabled = true;

        try {
            await writeTextToClipboard(String(responseText || ''));
            showResponseActionState(button, 'success', 'fa-solid fa-check', 'Copied', 'Response copied');
        } catch (error) {
            console.error('Unable to copy AI response:', error);
            showResponseActionState(button, 'error', 'fa-solid fa-triangle-exclamation', 'Failed', 'Copy failed');
        } finally {
            restoreResponseAction(button, snapshot);
        }
    }

    async function branchResponse(button, message) {
        if (button.disabled || requestInFlight) return;
        const sourceConversationId = activeConversationId;
        const sourceMessageId = Number(message.id);
        const snapshot = captureResponseAction(button);

        if (!Number.isSafeInteger(sourceConversationId) || sourceConversationId < 1
            || !Number.isSafeInteger(sourceMessageId) || sourceMessageId < 1) {
            showResponseActionState(button, 'error', 'fa-solid fa-triangle-exclamation', 'Unavailable', 'Branch unavailable');
            restoreResponseAction(button, snapshot);
            return;
        }

        closeResponseShareMenu(false);
        button.disabled = true;
        showResponseActionState(button, 'pending', 'fa-solid fa-circle-notch fa-spin', 'Branching…', 'Creating branched chat');
        setBusy(true);

        try {
            const result = await requestJson(`/api/chats/${sourceConversationId}/branch`, {
                method: 'POST',
                body: { messageId: sourceMessageId }
            });
            const conversation = result.conversation;
            if (!conversation?.id) throw new Error('The server did not return the branched chat.');

            conversations = [
                conversation,
                ...conversations.filter((item) => item.id !== conversation.id)
            ];
            renderHistory();
            setBusy(false);
            const opened = await openConversation(conversation.id, true);
            if (!opened) throw new Error('The branched chat was created but could not be opened.');
            setSyncStatus('Branched into a new saved chat', 'success');
            showResponseActionState(button, 'success', 'fa-solid fa-check', 'Branched', 'Chat branched');
        } catch (error) {
            setSyncStatus(error.message || 'The response could not be branched.', 'error');
            showResponseActionState(button, 'error', 'fa-solid fa-triangle-exclamation', 'Failed', 'Branch failed');
        } finally {
            if (requestInFlight) setBusy(false);
            restoreResponseAction(button, snapshot);
        }
    }

    function downloadResponse(button, message) {
        if (button.disabled) return;
        const snapshot = captureResponseAction(button);
        button.disabled = true;
        let objectUrl = '';

        try {
            const responseDocument = buildResponseDocument(message, false);
            const blob = new Blob([responseDocument.markdown], { type: 'text/markdown;charset=utf-8' });
            objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = responseDocument.filename;
            link.rel = 'noopener';
            document.body.appendChild(link);
            link.click();
            link.remove();
            showResponseActionState(button, 'success', 'fa-solid fa-check', 'Downloaded', 'Response downloaded');
        } catch (error) {
            console.error('Unable to download AI response:', error);
            showResponseActionState(button, 'error', 'fa-solid fa-triangle-exclamation', 'Failed', 'Download failed');
        } finally {
            if (objectUrl) window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
            restoreResponseAction(button, snapshot);
        }
    }

    async function shareResponse(button, message) {
        if (button.disabled) return;
        const responseDocument = buildResponseDocument(message, true);

        if (typeof navigator.share !== 'function') {
            openResponseShareMenu(button, responseDocument);
            return;
        }

        const snapshot = captureResponseAction(button);
        button.disabled = true;
        showResponseActionState(button, 'pending', 'fa-solid fa-circle-notch fa-spin', 'Sharing…', 'Opening share menu');

        try {
            const payload = {
                title: responseDocument.title,
                text: responseDocument.plainText
            };
            if (typeof File === 'function' && typeof navigator.canShare === 'function') {
                const file = new File(
                    [responseDocument.markdown],
                    responseDocument.filename,
                    { type: 'text/markdown' }
                );
                try {
                    if (navigator.canShare({ files: [file] })) {
                        payload.files = [file];
                        payload.text = responseDocument.redacted
                            ? 'Sensitive-looking values were redacted from the attached OrexisAI response.'
                            : 'Shared from OrexisAI.';
                    }
                } catch {
                    // Some browsers expose canShare but reject file capability checks.
                }
            }

            await navigator.share(payload);
            showResponseActionState(button, 'success', 'fa-solid fa-check', 'Shared', 'Response shared');
            setSyncStatus(responseDocument.redacted
                ? 'Shared · sensitive-looking values were redacted'
                : 'Response shared', 'success');
        } catch (error) {
            if (error?.name === 'AbortError') {
                restoreResponseAction(button, snapshot, 0);
                return;
            }
            console.error('Native response sharing failed:', error);
            restoreResponseAction(button, snapshot, 0);
            openResponseShareMenu(button, responseDocument);
            setSyncStatus('Native sharing was unavailable. Choose a fallback option.', 'error');
            return;
        }

        restoreResponseAction(button, snapshot);
    }

    function openResponseShareMenu(trigger, responseDocument) {
        closeResponseShareMenu(false);
        const menu = document.createElement('div');
        menu.className = 'agent-response-share-menu';
        menu.setAttribute('role', 'dialog');
        menu.setAttribute('aria-label', 'Share AI response');

        const header = document.createElement('div');
        header.className = 'agent-response-share-header';
        const heading = document.createElement('strong');
        heading.textContent = 'Share response';
        const closeButton = document.createElement('button');
        closeButton.type = 'button';
        closeButton.className = 'agent-response-share-close';
        closeButton.setAttribute('aria-label', 'Close share options');
        closeButton.innerHTML = '<i class="fa-solid fa-xmark" aria-hidden="true"></i>';
        closeButton.addEventListener('click', () => closeResponseShareMenu(true));
        header.append(heading, closeButton);

        const note = document.createElement('p');
        note.textContent = responseDocument.redacted
            ? 'Sensitive-looking values were redacted. Choose an app or copy the cleaned response.'
            : 'Choose an app, or copy the response for Instagram, Snapchat, Chrome, and other apps.';

        const shareText = encodeURIComponent(responseDocument.plainText);
        const subject = encodeURIComponent(responseDocument.title);
        const publicUrl = encodeURIComponent(window.location.origin);
        const options = document.createElement('div');
        options.className = 'agent-response-share-grid';
        options.append(
            createExternalShareLink('WhatsApp', 'fa-brands fa-whatsapp', `https://wa.me/?text=${shareText}`),
            createExternalShareLink('Gmail', 'fa-solid fa-envelope', `https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${shareText}`),
            createExternalShareLink('Messages', 'fa-solid fa-comment-sms', `sms:?&body=${shareText}`),
            createExternalShareLink('Facebook', 'fa-brands fa-facebook-f', `https://www.facebook.com/sharer/sharer.php?u=${publicUrl}&quote=${shareText}`),
            createExternalShareLink('LinkedIn', 'fa-brands fa-linkedin-in', `https://www.linkedin.com/feed/?shareActive=true&text=${shareText}`)
        );

        const copyForAppsButton = document.createElement('button');
        copyForAppsButton.type = 'button';
        copyForAppsButton.className = 'agent-response-share-option agent-response-share-copy';
        copyForAppsButton.innerHTML = '<i class="fa-regular fa-copy" aria-hidden="true"></i><span><strong>Copy for other apps</strong><small>Instagram, Snapchat, Chrome and more</small></span>';
        copyForAppsButton.addEventListener('click', async () => {
            try {
                await writeTextToClipboard(responseDocument.plainText);
                copyForAppsButton.classList.add('success');
                copyForAppsButton.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i><span><strong>Copied</strong><small>Paste it into any app</small></span>';
                setSyncStatus(responseDocument.redacted
                    ? 'Copied for sharing · sensitive-looking values were redacted'
                    : 'Response copied for sharing', 'success');
                window.setTimeout(() => closeResponseShareMenu(false), 900);
            } catch (error) {
                console.error('Unable to copy response for sharing:', error);
                copyForAppsButton.classList.add('error');
                copyForAppsButton.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i><span><strong>Copy failed</strong><small>Try the main Copy action</small></span>';
            }
        });

        const downloadButton = document.createElement('button');
        downloadButton.type = 'button';
        downloadButton.className = 'agent-response-share-option';
        downloadButton.innerHTML = '<i class="fa-solid fa-file-arrow-down" aria-hidden="true"></i><span><strong>Download Markdown</strong><small>Share the complete .md file</small></span>';
        downloadButton.addEventListener('click', () => {
            const blob = new Blob([responseDocument.markdown], { type: 'text/markdown;charset=utf-8' });
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = responseDocument.filename;
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
            closeResponseShareMenu(false);
            setSyncStatus('Response downloaded for sharing', 'success');
        });

        menu.append(header, note, options, copyForAppsButton, downloadButton);
        document.body.appendChild(menu);
        activeShareMenu = menu;
        activeShareTrigger = trigger;
        trigger.setAttribute('aria-expanded', 'true');

        if (!window.matchMedia('(max-width: 640px)').matches) {
            const triggerRect = trigger.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();
            const edge = 12;
            const left = Math.min(
                window.innerWidth - menuRect.width - edge,
                Math.max(edge, triggerRect.right - menuRect.width)
            );
            const above = triggerRect.top - menuRect.height - 8;
            const top = above >= edge
                ? above
                : Math.min(window.innerHeight - menuRect.height - edge, triggerRect.bottom + 8);
            menu.style.left = `${left}px`;
            menu.style.top = `${Math.max(edge, top)}px`;
        }

        window.setTimeout(() => menu.querySelector('a, button')?.focus({ preventScroll: true }), 0);
    }

    function createExternalShareLink(label, icon, href) {
        const link = document.createElement('a');
        link.className = 'agent-response-share-option';
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span><strong>${label}</strong><small>Open ${label}</small></span>`;
        link.addEventListener('click', () => {
            setSyncStatus(`Opening ${label} sharing`, 'success');
            closeResponseShareMenu(false);
        });
        return link;
    }

    function closeResponseShareMenu(restoreFocus) {
        const trigger = activeShareTrigger;
        activeShareMenu?.remove();
        activeShareMenu = null;
        activeShareTrigger = null;
        trigger?.setAttribute('aria-expanded', 'false');
        if (restoreFocus && trigger?.isConnected) trigger.focus({ preventScroll: true });
    }

    function buildResponseDocument(message, redactSensitiveValues) {
        const title = 'OrexisAI response';
        const responseText = String(message.content || '').trim();
        const sanitized = redactSensitiveValues
            ? sanitizeSharedResponse(responseText)
            : { text: responseText, redacted: false };
        const createdAt = message.createdAt ? new Date(message.createdAt) : new Date();
        const validDate = Number.isNaN(createdAt.getTime()) ? new Date() : createdAt;
        const dateLabel = validDate.toLocaleString();
        const safeTitle = sanitizeDownloadFilename(title) || 'orexisai-response';
        const datePart = validDate.toISOString().slice(0, 10);
        const messagePart = Number.isSafeInteger(Number(message.id)) && Number(message.id) > 0
            ? `-${Number(message.id)}`
            : '';
        const markdown = `# ${title}\n\n_OrexisAI response · ${dateLabel}_\n\n${sanitized.text}\n`;
        return {
            title,
            filename: `${safeTitle}-${datePart}${messagePart}.md`,
            markdown,
            plainText: `${title}\n\n${sanitized.text}`,
            redacted: sanitized.redacted
        };
    }

    function sanitizeSharedResponse(value) {
        let text = String(value || '');
        const original = text;
        const replacements = [
            [/-----BEGIN(?: [A-Z]+)* PRIVATE KEY-----[\s\S]*?-----END(?: [A-Z]+)* PRIVATE KEY-----/gi, '[REDACTED PRIVATE KEY]'],
            [/\b(?:sk|rk|pk)-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g, '[REDACTED API KEY]'],
            [/\bAIza[0-9A-Za-z_-]{30,}\b/g, '[REDACTED API KEY]'],
            [/\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/g, '[REDACTED ACCESS TOKEN]'],
            [/\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g, '[REDACTED ACCESS TOKEN]'],
            [/\bAKIA[0-9A-Z]{16}\b/g, '[REDACTED ACCESS KEY]'],
            [/\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, '[REDACTED TOKEN]'],
            [/^(\s*(?:api[_ -]?key|secret|access[_ -]?token|authorization|password)\s*[:=]\s*)(["']?)[^\s"'`]+/gim, '$1[REDACTED]']
        ];
        replacements.forEach(([pattern, replacement]) => {
            text = text.replace(pattern, replacement);
        });
        return { text, redacted: text !== original };
    }

    function sanitizeDownloadFilename(value) {
        return String(value || '')
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
            .replace(/\s+/g, '-')
            .replace(/-+/g, '-')
            .replace(/^-+|-+$/g, '')
            .slice(0, 72)
            .toLowerCase();
    }

    async function writeTextToClipboard(text) {
        if (navigator.clipboard?.writeText && window.isSecureContext) {
            await navigator.clipboard.writeText(text);
            return;
        }

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

    function captureResponseAction(button) {
        return {
            markup: button.innerHTML,
            label: button.getAttribute('aria-label') || '',
            title: button.title || ''
        };
    }

    function showResponseActionState(button, state, icon, label, ariaLabel) {
        if (!button?.isConnected && state !== 'pending') return;
        button.classList.remove('success', 'error', 'pending');
        button.classList.add(state);
        button.setAttribute('aria-label', ariaLabel);
        button.innerHTML = `<i class="${icon}" aria-hidden="true"></i><span>${label}</span>`;
    }

    function restoreResponseAction(button, snapshot, delay = 1800) {
        window.setTimeout(() => {
            if (!button?.isConnected) return;
            button.disabled = false;
            button.classList.remove('success', 'error', 'pending');
            button.setAttribute('aria-label', snapshot.label);
            button.title = snapshot.title;
            button.innerHTML = snapshot.markup;
        }, delay);
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
    const runButtons = Array.from(document.querySelectorAll('.run-btn[data-workflow]'));
    const modal = document.getElementById('executionModal');
    const closeModal = document.getElementById('closeModal');
    const closeResultBtn = document.getElementById('closeResultBtn');
    const runAgainButton = document.getElementById('workflowRunAgainBtn');
    const previousRunsButton = document.getElementById('workflowPreviousRunsBtn');
    const stepsContainer = document.getElementById('executionSteps');
    const resultContainer = document.getElementById('executionResult');
    const workflowTitle = document.getElementById('workflowTitle');
    const resultTitle = document.getElementById('workflowResultTitle');
    const resultDescription = document.getElementById('workflowResultDescription');
    const resultMeta = document.getElementById('workflowResultMeta');
    const resultBody = document.getElementById('workflowResultBody');
    const resultIcon = document.getElementById('workflowResultIcon');
    const progressContainer = document.getElementById('workflowLiveProgress');
    const progressBar = document.getElementById('workflowProgressBar');
    const progressText = document.getElementById('workflowProgressText');
    const etaText = document.getElementById('workflowEtaText');
    const liveLogs = document.getElementById('workflowLiveLogs');
    const spinner = document.querySelector('#executionModal .spinner');

    if (!modal || !closeModal || !closeResultBtn || !runAgainButton || !previousRunsButton
        || !stepsContainer || !resultContainer || !workflowTitle || !resultTitle
        || !resultDescription || !resultMeta || !resultBody || !resultIcon || !spinner
        || !progressContainer || !progressBar || !progressText || !etaText || !liveLogs) return;

    const workflowViews = Object.freeze({
        'weekly-marketing': 'marketing',
        'competitor-audit': 'marketing',
        'review-responder': 'crm',
        'inventory-predictor': 'analytics'
    });
    let activeWorkflow = '';
    let resultView = 'hub';
    let activeController = null;
    let activeRunId = null;

    runButtons.forEach((button) => {
        button.addEventListener('click', () => startWorkflow(button.dataset.workflow));
    });
    closeModal.addEventListener('click', closeWorkflowModal);
    closeResultBtn.addEventListener('click', () => {
        closeWorkflowModal();
        document.dispatchEvent(new CustomEvent('outcomeai:navigate', { detail: { view: resultView } }));
        document.dispatchEvent(new CustomEvent('orexisai:business-data-refresh', { detail: { view: resultView } }));
    });
    runAgainButton.addEventListener('click', () => activeWorkflow && startWorkflow(activeWorkflow));
    previousRunsButton.addEventListener('click', () => activeWorkflow && showPreviousRuns(activeWorkflow));
    resultBody.addEventListener('click', handleReviewDraftAction);
    resultBody.addEventListener('click', handleMarketingResultAction);
    modal.addEventListener('click', (event) => {
        if (event.target === modal) closeWorkflowModal();
    });
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape' && modal.classList.contains('active')) closeWorkflowModal();
    });

    async function startWorkflow(slug) {
        if (!slug) return;
        activeController?.abort();
        activeController = new AbortController();
        activeWorkflow = slug;
        resultView = workflowViews[slug] || 'hub';
        setButtonsBusy(slug, true);
        resetModal(slug);
        openModal(modal);

        try {
            const dateRange = readSelectedDateRange(slug);
            const response = await fetch(`/api/workflows/${encodeURIComponent(slug)}/runs`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/x-ndjson' },
                body: JSON.stringify(dateRange),
                signal: activeController.signal
            });
            if (!response.ok || !response.body) {
                const payload = await readApiPayload(response);
                throw new Error(payload.error || 'The workflow could not be started.');
            }
            await readNdjsonResponse(response, handleWorkflowEvent);
        } catch (error) {
            if (error.name !== 'AbortError') showWorkflowFailure(error.message || 'The workflow could not be completed.');
        } finally {
            setButtonsBusy(slug, false);
            activeController = null;
        }
    }

    function resetModal(slug) {
        workflowTitle.textContent = workflowDisplayName(slug);
        resultTitle.textContent = '';
        resultDescription.textContent = '';
        resultMeta.replaceChildren();
        resultBody.replaceChildren();
        stepsContainer.replaceChildren();
        stepsContainer.style.display = 'flex';
        resultContainer.classList.add('hidden');
        resultContainer.classList.remove('workflow-failed');
        spinner.style.display = 'block';
        activeRunId = null;
        progressContainer.hidden = false;
        progressBar.value = 0;
        progressText.textContent = 'Preparing execution…';
        etaText.textContent = 'Estimating completion time…';
        liveLogs.replaceChildren();
        resultIcon.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>';
        runAgainButton.hidden = true;
        previousRunsButton.hidden = true;
    }

    function handleWorkflowEvent(event) {
        if (!event || typeof event !== 'object') return;
        if (event.type === 'run' && event.run) {
            activeRunId = event.run.id || null;
            activeWorkflow = event.run.workflowSlug || activeWorkflow;
            resultView = workflowViews[activeWorkflow] || resultView;
            workflowTitle.textContent = event.run.workflowName || workflowDisplayName(activeWorkflow);
            renderExecutionSteps(event.run.steps || []);
            return;
        }
        if (event.type === 'progress') {
            updateWorkflowProgress(event);
            return;
        }
        if (event.type === 'log') {
            appendWorkflowLog(event);
            return;
        }
        if (event.type === 'step') {
            updateExecutionStep(event.stepKey, event.status, event.error);
            return;
        }
        if (event.type === 'completed') {
            showWorkflowResult(event.run, event.output);
            return;
        }
        if (event.type === 'failed') showWorkflowFailure(event.error || 'The workflow could not produce a trustworthy result.');
    }

    function updateWorkflowProgress(event) {
        const percentage = Math.max(0, Math.min(100, Number(event.percentage) || 0));
        progressBar.value = percentage;
        progressBar.textContent = `${percentage}%`;
        progressText.textContent = `${percentage}% · ${workflowStepDisplayName(event.currentStep)}`;
        const eta = new Date(event.estimatedCompletionAt || '');
        etaText.textContent = Number.isNaN(eta.getTime()) ? 'Completion time is being recalculated…' : `Estimated completion ${formatDateTime(eta.toISOString())}`;
    }

    function appendWorkflowLog(event) {
        const line = document.createElement('div');
        line.className = `workflow-log-line ${event.level || 'info'}`;
        const timestamp = new Date(event.createdAt || event.timestamp || Date.now());
        line.innerHTML = `<time>${escapeWorkflowHtml(Number.isNaN(timestamp.getTime()) ? '' : timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }))}</time><span>${escapeWorkflowHtml(event.message || '')}</span>`;
        liveLogs.appendChild(line);
        while (liveLogs.children.length > 100) liveLogs.firstElementChild?.remove();
        liveLogs.scrollTop = liveLogs.scrollHeight;
    }

    function workflowStepDisplayName(value) {
        return String(value || 'Running workflow').replace(/[-_]+/g, ' ').replace(/^./, (character) => character.toUpperCase());
    }

    function renderExecutionSteps(steps) {
        stepsContainer.replaceChildren();
        steps.forEach((step) => {
            const element = document.createElement('div');
            element.className = 'step';
            element.dataset.stepKey = step.key;
            element.innerHTML = `
                <div class="step-icon"><i class="fa-solid fa-hourglass" aria-hidden="true"></i></div>
                <div class="step-content">
                    <div class="step-title"></div>
                    <div class="step-desc">Waiting for the backend to begin this real execution step.</div>
                </div>`;
            element.querySelector('.step-title').textContent = step.title;
            stepsContainer.appendChild(element);
        });
    }

    function updateExecutionStep(stepKey, status, error) {
        const stepElement = Array.from(stepsContainer.children).find((item) => item.dataset.stepKey === stepKey);
        if (!stepElement) return;
        stepElement.classList.toggle('active', status === 'running');
        stepElement.classList.toggle('completed', status === 'completed');
        stepElement.classList.toggle('failed', status === 'failed');
        const icon = stepElement.querySelector('.step-icon');
        const description = stepElement.querySelector('.step-desc');
        if (status === 'running') {
            icon.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i>';
            description.textContent = 'Running against the authenticated business account…';
        } else if (status === 'completed') {
            icon.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i>';
            description.textContent = 'Completed using the backend and saved workflow state.';
        } else if (status === 'failed') {
            icon.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>';
            description.textContent = error || 'This step could not be completed.';
        }
    }

    function showWorkflowResult(run, output) {
        stepsContainer.style.display = 'none';
        progressContainer.hidden = true;
        resultContainer.classList.remove('hidden', 'workflow-failed');
        spinner.style.display = 'none';
        workflowTitle.textContent = 'Workflow complete';
        resultTitle.textContent = run?.workflowName || workflowDisplayName(activeWorkflow);
        resultDescription.textContent = 'The result below is separated into verified facts, calculated metrics, and AI-generated analysis.';
        resultIcon.innerHTML = '<i class="fa-solid fa-circle-check" aria-hidden="true"></i>';
        renderResultMeta(run, output);
        renderWorkflowOutput(output);
        runAgainButton.hidden = false;
        previousRunsButton.hidden = false;
        document.dispatchEvent(new CustomEvent('orexisai:business-data-refresh', { detail: { view: resultView } }));
    }

    function showWorkflowFailure(message) {
        stepsContainer.style.display = 'none';
        progressContainer.hidden = true;
        resultContainer.classList.remove('hidden');
        resultContainer.classList.add('workflow-failed');
        spinner.style.display = 'none';
        workflowTitle.textContent = 'Workflow stopped';
        resultTitle.textContent = 'A trustworthy result could not be produced';
        resultDescription.textContent = message;
        resultIcon.innerHTML = '<i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>';
        resultMeta.replaceChildren();
        resultBody.innerHTML = '<div class="business-empty-state"><strong>No fabricated output was created.</strong><span>Fix the missing data or integration described above, then run the workflow again.</span></div>';
        runAgainButton.hidden = false;
        previousRunsButton.hidden = false;
    }

    function renderResultMeta(run, output) {
        const items = [
            ['Status', run?.status || 'completed'],
            ['Records', String(output?.recordsAnalyzed ?? run?.recordsAnalyzed ?? 0)],
            ['Retrieved', formatDateTime(run?.dataRetrievedAt || new Date().toISOString())],
            ['Duration', formatDuration(run?.durationMs)]
        ];
        if (output?.dataPeriod) items.push(['Data period', formatPeriod(output.dataPeriod)]);
        resultMeta.replaceChildren(...items.map(([label, value]) => {
            const element = document.createElement('span');
            element.innerHTML = `<small>${escapeWorkflowHtml(label)}</small><strong>${escapeWorkflowHtml(value)}</strong>`;
            return element;
        }));
    }

    function renderWorkflowOutput(output) {
        resultBody.replaceChildren();
        if (!output || typeof output !== 'object') {
            resultBody.innerHTML = '<div class="business-empty-state">The saved workflow did not contain a result payload.</div>';
            return;
        }
        if (output.workflow === 'weekly-marketing') renderMarketingWorkflowOutput(output);
        else if (output.workflow === 'competitor-audit') renderCompetitorWorkflowOutput(output);
        else if (output.workflow === 'review-responder') renderReviewWorkflowOutput(output);
        else if (output.workflow === 'inventory-predictor') renderInventoryWorkflowOutput(output);
        else resultBody.textContent = JSON.stringify(output, null, 2);
    }

    function renderMarketingWorkflowOutput(output) {
        const performance = output.internalPerformance || {};
        const facts = performance.factualResults || output.factualResults || {};
        const metrics = performance.calculatedMetrics || output.calculatedMetrics || {};
        const performanceSection = document.createElement('section');
        performanceSection.className = 'workflow-output-section';
        performanceSection.innerHTML = `
            <div class="workflow-section-heading"><h4>Verified business performance</h4><span>${output.partial ? 'Completed with source limitations' : 'All configured sources completed'}</span></div>
            <div class="workflow-output-metrics">
                ${resultMetric('Revenue', formatMoneyMinor(facts.totalRevenueMinor, facts.currency || output.business?.currency))}
                ${resultMetric('Orders', formatNumber(facts.totalOrders || 0))}
                ${resultMetric('Average order', nullableMoney(metrics.averageOrderValueMinor, facts.currency || output.business?.currency))}
                ${resultMetric('Revenue change', nullablePercentage(metrics.revenueGrowthPercentage))}
            </div>`;
        resultBody.appendChild(performanceSection);

        appendStructuredResultSection(resultBody, 'Executive summary', output.analysis?.summary);
        appendStructuredResultSection(resultBody, 'SWOT analysis', output.analysis?.swotAnalysis, 'swotAnalysis');
        appendStructuredResultSection(resultBody, 'Competitor analysis', output.analysis?.competitorAnalysis, 'competitorAnalysis');
        appendStructuredResultSection(resultBody, 'Market opportunities', output.analysis?.marketOpportunities, 'marketOpportunities');
        appendStructuredResultSection(resultBody, 'Marketing insights', output.analysis?.marketingInsights, 'marketingInsights');
        appendStructuredResultSection(resultBody, 'Customer pain points', output.analysis?.customerPainPoints, 'customerPainPoints');
        appendStructuredResultSection(resultBody, 'Product positioning', output.analysis?.productPositioning, 'productPositioning');
        appendStructuredResultSection(resultBody, 'Recommended strategy', output.analysis?.recommendedMarketingStrategy, 'recommendedMarketingStrategy');

        const assets = output.marketingAssets || {};
        const assetLabels = {
            facebookPosts: 'Facebook posts', instagramPosts: 'Instagram posts', linkedinPosts: 'LinkedIn posts',
            xPosts: 'X posts', blogArticles: 'Blog articles', emailCampaigns: 'Email campaigns',
            promotionalFlyers: 'Promotional flyer copy', marketingBanners: 'Marketing banner copy',
            adHeadlines: 'Ad headlines', adDescriptions: 'Ad descriptions', ctaSuggestions: 'CTA suggestions',
            hashtags: 'Hashtags', seoKeywords: 'SEO keywords', metaTitles: 'Meta titles', metaDescriptions: 'Meta descriptions'
        };
        for (const [key, label] of Object.entries(assetLabels)) appendStructuredResultSection(resultBody, label, assets[key], key, true);

        if (Array.isArray(output.generatedImages) && output.generatedImages.length) {
            const imagesSection = document.createElement('section');
            imagesSection.className = 'workflow-output-section';
            imagesSection.innerHTML = '<h4>Generated images</h4>';
            const grid = document.createElement('div');
            grid.className = 'workflow-image-grid';
            for (const image of output.generatedImages) {
                const card = document.createElement('article');
                if (image.status === 'generated' && image.downloadUrl) {
                    card.innerHTML = `<img src="${escapeWorkflowHtml(image.downloadUrl)}" alt="${escapeWorkflowHtml(image.title || 'Generated marketing image')}" loading="lazy"><strong>${escapeWorkflowHtml(image.title || 'Generated image')}</strong><a class="secondary-action" href="${escapeWorkflowHtml(image.downloadUrl)}" download>Download image</a>`;
                } else card.innerHTML = `<strong>${escapeWorkflowHtml(image.title || 'Generated image')}</strong><span>${escapeWorkflowHtml(image.error || 'Image generation was unavailable.')}</span>`;
                grid.appendChild(card);
            }
            imagesSection.appendChild(grid);
            resultBody.appendChild(imagesSection);
        }

        if (Array.isArray(output.reports) && output.reports.length) {
            const reportsSection = document.createElement('section');
            reportsSection.className = 'workflow-output-section';
            reportsSection.innerHTML = '<h4>Weekly Marketing Report</h4>';
            const actions = document.createElement('div');
            actions.className = 'workflow-download-grid';
            for (const report of output.reports) {
                const link = document.createElement('a');
                link.className = 'secondary-action';
                link.href = report.downloadUrl;
                link.download = report.filename || '';
                link.innerHTML = `<i class="fa-solid fa-download" aria-hidden="true"></i> ${escapeWorkflowHtml(report.title)}`;
                actions.appendChild(link);
            }
            reportsSection.appendChild(actions);
            resultBody.appendChild(reportsSection);
        }

        appendSourceSummary(resultBody, output.sourceSummary || [], output.dataLimitations || []);
    }

    function appendStructuredResultSection(parent, title, value, sectionKey = '', copyable = false) {
        const hasContent = Array.isArray(value) ? value.length : value && (typeof value !== 'object' || Object.keys(value).length);
        if (!hasContent) return;
        const section = document.createElement('section');
        section.className = 'workflow-output-section';
        const heading = document.createElement('div');
        heading.className = 'workflow-section-heading';
        heading.innerHTML = `<h4>${escapeWorkflowHtml(title)}</h4>`;
        const actions = document.createElement('div');
        actions.className = 'workflow-inline-actions';
        if (copyable) actions.innerHTML += `<button type="button" class="secondary-action" data-marketing-copy="${escapeWorkflowHtml(sectionKey)}"><i class="fa-regular fa-copy" aria-hidden="true"></i> Copy</button>`;
        if (sectionKey) actions.innerHTML += `<button type="button" class="secondary-action" data-marketing-regenerate="${escapeWorkflowHtml(sectionKey)}"><i class="fa-solid fa-rotate" aria-hidden="true"></i> Regenerate</button>`;
        heading.appendChild(actions);
        const content = document.createElement('pre');
        content.className = 'workflow-structured-content';
        content.dataset.sectionKey = sectionKey;
        content.textContent = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        section.append(heading, content);
        parent.appendChild(section);
    }

    function appendSourceSummary(parent, sources, limitations) {
        const section = document.createElement('section');
        section.className = 'workflow-output-section';
        section.innerHTML = '<h4>Live data sources and limitations</h4>';
        const list = document.createElement('div');
        list.className = 'workflow-source-status-grid';
        for (const source of sources) {
            const item = document.createElement('article');
            item.className = source.status === 'available' ? 'available' : 'unavailable';
            item.innerHTML = `<strong>${escapeWorkflowHtml(workflowStepDisplayName(source.sourceType))}</strong><span>${escapeWorkflowHtml(source.provider || '')}</span><small>${escapeWorkflowHtml(source.status === 'available' ? `Retrieved ${formatDateTime(source.retrievedAt)}` : source.error || 'Unavailable')}</small>`;
            if (source.sourceUrl) {
                const link = document.createElement('a'); link.href = source.sourceUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = 'Open source'; item.appendChild(link);
            }
            list.appendChild(item);
        }
        section.appendChild(list);
        if (limitations.length) {
            const limitationList = document.createElement('ul');
            for (const limitation of limitations) { const li = document.createElement('li'); li.textContent = limitation; limitationList.appendChild(li); }
            section.appendChild(limitationList);
        }
        parent.appendChild(section);
    }

    async function handleMarketingResultAction(event) {
        const copyButton = event.target.closest('[data-marketing-copy]');
        const regenerateButton = event.target.closest('[data-marketing-regenerate]');
        if (!copyButton && !regenerateButton) return;
        const sectionKey = (copyButton || regenerateButton).dataset.marketingCopy || (copyButton || regenerateButton).dataset.marketingRegenerate;
        const content = resultBody.querySelector(`[data-section-key="${CSS.escape(sectionKey)}"]`);
        if (copyButton) {
            try {
                await navigator.clipboard.writeText(content?.textContent || '');
                const original = copyButton.innerHTML; copyButton.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Copied';
                setTimeout(() => { copyButton.innerHTML = original; }, 1400);
            } catch { copyButton.textContent = 'Copy failed'; }
            return;
        }
        if (!activeRunId) return;
        regenerateButton.disabled = true;
        const original = regenerateButton.innerHTML;
        regenerateButton.innerHTML = '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Regenerating…';
        try {
            const response = await fetch(`/api/workflow-runs/${encodeURIComponent(activeRunId)}/sections/${encodeURIComponent(sectionKey)}/regenerate`, { method: 'POST', headers: { Accept: 'application/json' } });
            const payload = await readApiPayload(response);
            if (!response.ok) throw new Error(payload.error || 'This section could not be regenerated.');
            if (content) content.textContent = typeof payload.regeneration.value === 'string' ? payload.regeneration.value : JSON.stringify(payload.regeneration.value, null, 2);
            regenerateButton.innerHTML = '<i class="fa-solid fa-check" aria-hidden="true"></i> Updated';
        } catch (error) {
            regenerateButton.textContent = error.message || 'Regeneration failed';
        } finally {
            setTimeout(() => { regenerateButton.disabled = false; regenerateButton.innerHTML = original; }, 1800);
        }
    }

    function renderCompetitorWorkflowOutput(output) {
        const section = document.createElement('section');
        section.className = 'workflow-output-section';
        section.innerHTML = '<h4>Verified competitor sources</h4>';
        const list = document.createElement('div');
        list.className = 'workflow-source-list';
        for (const competitor of output.factualResults || []) {
            const item = document.createElement('article');
            item.innerHTML = `<strong>${escapeWorkflowHtml(competitor.competitorName)}</strong>
                <span>${escapeWorkflowHtml(competitor.sourceName || 'Source name unavailable')}</span>
                <small>Retrieved ${escapeWorkflowHtml(formatDateTime(competitor.retrievedAt))}</small>`;
            if (competitor.sourceUrl) {
                const link = document.createElement('a');
                link.href = competitor.sourceUrl;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                link.textContent = 'Open source';
                item.appendChild(link);
            }
            list.appendChild(item);
        }
        section.appendChild(list);
        resultBody.appendChild(section);
        appendAiInsight(resultBody, output.aiInsights);
    }

    function renderReviewWorkflowOutput(output) {
        const factsById = new Map((output.factualResults || []).map((review) => [Number(review.id), review]));
        const analysesById = new Map((output.calculatedMetrics || []).map((analysis) => [Number(analysis.reviewId), analysis]));
        const section = document.createElement('section');
        section.className = 'workflow-output-section';
        section.innerHTML = '<h4>Editable response drafts</h4>';
        const drafts = document.createElement('div');
        drafts.className = 'review-draft-list';
        for (const draft of output.responseDrafts || []) {
            const review = factsById.get(Number(draft.id));
            const analysis = analysesById.get(Number(draft.id));
            if (!review) continue;
            const card = document.createElement('article');
            card.className = 'review-draft-card';
            card.dataset.reviewId = String(review.id);
            card.innerHTML = `
                <div class="review-draft-heading">
                    <strong>${escapeWorkflowHtml(review.provider)} review${review.rating === null ? '' : ` · ${escapeWorkflowHtml(String(review.rating))}/5`}</strong>
                    <span>${escapeWorkflowHtml(analysis?.sentiment || 'unclassified')}</span>
                </div>
                <blockquote>${escapeWorkflowHtml(review.reviewText)}</blockquote>
                <label>Response draft<textarea rows="5" class="review-response-input" maxlength="5000" placeholder="AI draft unavailable — write a response for review.">${escapeWorkflowHtml(draft.response || '')}</textarea></label>
                <div class="review-draft-actions">
                    <button type="button" class="secondary-action" data-review-action="save">Save Draft</button>
                    <button type="button" class="secondary-action" data-review-action="approve">Approve</button>
                    <button type="button" class="primary-action" data-review-action="send">Send through integration</button>
                </div>
                <span class="review-draft-status" role="status" aria-live="polite"></span>`;
            drafts.appendChild(card);
        }
        section.appendChild(drafts);
        resultBody.appendChild(section);
        appendAiInsight(resultBody, output.aiInsights);
    }

    function renderInventoryWorkflowOutput(output) {
        const section = document.createElement('section');
        section.className = 'workflow-output-section';
        section.innerHTML = '<h4>Inventory forecast</h4>';
        const table = document.createElement('div');
        table.className = 'inventory-forecast-table';
        table.innerHTML = '<div class="inventory-forecast-row inventory-forecast-head"><span>Product</span><span>Stock</span><span>Daily demand</span><span>Days left</span><span>Recommendation</span></div>';
        for (const forecast of output.calculatedMetrics || []) {
            const row = document.createElement('div');
            row.className = 'inventory-forecast-row';
            row.innerHTML = `
                <span><strong>${escapeWorkflowHtml(forecast.productName)}</strong><small>${escapeWorkflowHtml(forecast.confidence)} confidence</small></span>
                <span>${formatNullableNumber(forecast.currentStock)}</span>
                <span>${formatNullableDecimal(forecast.averageDailyDemand)}</span>
                <span>${formatNullableDecimal(forecast.estimatedDaysOfStock)}</span>
                <span>${escapeWorkflowHtml(formatRecommendation(forecast.reorderRecommendation))}</span>`;
            table.appendChild(row);
        }
        section.appendChild(table);
        resultBody.appendChild(section);
        appendAiInsight(resultBody, output.aiInsights);
    }

    async function handleReviewDraftAction(event) {
        const button = event.target.closest('[data-review-action]');
        if (!button) return;
        const card = button.closest('[data-review-id]');
        const input = card?.querySelector('.review-response-input');
        const status = card?.querySelector('.review-draft-status');
        if (!card || !input || !status) return;
        const responseText = input.value.trim();
        if (!responseText) {
            status.textContent = 'Enter a response before continuing.';
            status.className = 'review-draft-status error';
            return;
        }
        button.disabled = true;
        status.textContent = 'Saving…';
        status.className = 'review-draft-status';
        try {
            const response = await fetch(`/api/reviews/${encodeURIComponent(card.dataset.reviewId)}/response`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ response: responseText, action: button.dataset.reviewAction })
            });
            const payload = await readApiPayload(response);
            if (!response.ok) throw new Error(payload.error || 'The response could not be updated.');
            status.textContent = button.dataset.reviewAction === 'send' ? 'Sent successfully.'
                : button.dataset.reviewAction === 'approve' ? 'Approved and ready to send.' : 'Draft saved.';
            status.className = 'review-draft-status success';
        } catch (error) {
            status.textContent = error.message;
            status.className = 'review-draft-status error';
        } finally {
            button.disabled = false;
        }
    }

    async function showPreviousRuns(slug) {
        resultBody.innerHTML = '<div class="business-loading-state"><i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Loading previous runs…</div>';
        try {
            const response = await fetch(`/api/workflow-runs?workflow=${encodeURIComponent(slug)}&limit=20`, { headers: { Accept: 'application/json' } });
            const payload = await readApiPayload(response);
            if (!response.ok) throw new Error(payload.error || 'Previous runs could not be loaded.');
            const list = document.createElement('div');
            list.className = 'previous-run-list';
            if (!payload.runs?.length) list.innerHTML = '<div class="business-empty-state">No previous runs are available.</div>';
            for (const run of payload.runs || []) {
                const item = document.createElement('button');
                item.type = 'button';
                item.className = 'previous-run-item';
                item.innerHTML = `<span><strong>${escapeWorkflowHtml(run.workflowName)}</strong><small>${escapeWorkflowHtml(formatDateTime(run.createdAt))}</small></span><span class="status-dot ${escapeWorkflowHtml(run.status)}">${escapeWorkflowHtml(run.status)}</span>`;
                item.addEventListener('click', () => {
                    if (run.output) {
                        activeRunId = run.id;
                        renderResultMeta(run, run.output);
                        renderWorkflowOutput(run.output);
                        resultTitle.textContent = `${run.workflowName} · previous run`;
                    } else {
                        resultBody.innerHTML = `<div class="business-empty-state">${escapeWorkflowHtml(run.error || 'This run has no saved output.')}</div>`;
                    }
                });
                list.appendChild(item);
            }
            resultBody.replaceChildren(list);
        } catch (error) {
            resultBody.innerHTML = `<div class="business-empty-state">${escapeWorkflowHtml(error.message)}</div>`;
        }
    }

    function closeWorkflowModal() {
        activeController?.abort();
        activeController = null;
        closeModalElement(modal);
    }

    function setButtonsBusy(slug, busy) {
        runButtons.filter((button) => button.dataset.workflow === slug).forEach((button) => {
            button.disabled = busy;
            if (busy) button.dataset.originalHtml = button.innerHTML;
            button.innerHTML = busy ? '<i class="fa-solid fa-spinner fa-spin" aria-hidden="true"></i> Running…' : (button.dataset.originalHtml || button.innerHTML);
        });
    }
}

function initializeBusinessData() {
    const fromInput = document.getElementById('analyticsFromDate');
    const toInput = document.getElementById('analyticsToDate');
    const form = document.getElementById('analyticsDateForm');
    const refreshButtons = Array.from(document.querySelectorAll('[data-refresh-view]'));
    if (!document.getElementById('crmMetricsGrid') && !document.getElementById('marketingMetricsGrid')) return;

    const today = new Date();
    const monday = new Date(today);
    const day = monday.getDay() || 7;
    monday.setDate(monday.getDate() - day + 1);
    if (fromInput && !fromInput.value) fromInput.value = formatDateInput(monday);
    if (toInput && !toInput.value) toInput.value = formatDateInput(today);

    let controller = null;
    let lastLoadedAt = 0;

    form?.addEventListener('submit', (event) => {
        event.preventDefault();
        loadOverview(true);
    });
    refreshButtons.forEach((button) => button.addEventListener('click', () => loadOverview(true)));
    document.addEventListener('outcomeai:view-changed', (event) => {
        if (event.detail?.view === 'crm' && Date.now() - lastLoadedAt > 30_000) loadOverview(false);
    });
    document.addEventListener('orexisai:business-data-refresh', () => loadOverview(true));

    loadOverview(false);

    async function loadOverview(force) {
        if (controller && !force) return;
        controller?.abort();
        controller = new AbortController();
        setBusinessDataLoading();
        const params = new URLSearchParams();
        if (fromInput?.value) params.set('from', fromInput.value);
        if (toInput?.value) params.set('to', toInput.value);
        try {
            const response = await fetch(`/api/business/overview?${params.toString()}`, {
                headers: { Accept: 'application/json' },
                signal: controller.signal,
                cache: 'no-store'
            });
            const payload = await readApiPayload(response);
            if (!response.ok) throw new Error(payload.error || 'Business data could not be loaded.');
            renderBusinessOverview(payload.overview);
            lastLoadedAt = Date.now();
        } catch (error) {
            if (error.name !== 'AbortError') setBusinessDataError(error.message);
        } finally {
            controller = null;
        }
    }
}

function renderBusinessOverview(overview) {
    if (!overview) return;
    const currency = overview.business?.currency || 'USD';
    const marketing = overview.marketing || {};
    const analytics = overview.analytics || {};
    const crm = overview.crm || {};
    const availability = overview.dataAvailability || {};
    const ordersAvailable = Number(availability.orderRecords || 0) > 0;
    const customersAvailable = Number(availability.customerRecords || 0) > 0;
    const dataLabel = `${formatPeriod(overview.dataPeriod)} · ${formatNumber(overview.recordsAnalyzed)} records · updated ${formatDateTime(overview.dataRetrievedAt)}`;
    if (document.getElementById('marketingMetricsGrid')) setStatusText('marketingDataStatus', dataLabel, 'success');
    setStatusText('analyticsDataStatus', dataLabel, 'success');
    setStatusText('crmDataStatus', dataLabel, 'success');

    if (document.getElementById('marketingMetricsGrid')) renderMetricGrid('marketingMetricsGrid', [
        ['Revenue', ordersAvailable ? formatMoneyMinor(marketing.totalRevenueMinor, currency) : 'Insufficient data', ordersAvailable ? nullablePercentage(analytics.revenueGrowthPercentage) : 'Connect or import valid orders'],
        ['Orders', ordersAvailable ? formatNumber(marketing.totalOrders) : 'Insufficient data', ordersAvailable ? nullablePercentage(analytics.orderGrowthPercentage) : 'Connect or import valid orders'],
        ['Customers', ordersAvailable ? formatNumber(marketing.uniqueCustomers) : 'Insufficient data', ordersAvailable ? nullablePercentage(analytics.customerGrowthPercentage) : 'Requires customer-linked orders'],
        ['Average order', ordersAvailable ? nullableMoney(analytics.averageOrderValueMinor, currency) : 'Insufficient data', 'Calculated from valid orders']
    ]);
    renderMetricGrid('analyticsMetricsGrid', [
        ['Revenue', ordersAvailable ? formatMoneyMinor(marketing.totalRevenueMinor, currency) : 'Insufficient data', ordersAvailable ? nullablePercentage(analytics.revenueGrowthPercentage) : 'No valid order records'],
        ['Orders', ordersAvailable ? formatNumber(marketing.totalOrders) : 'Insufficient data', ordersAvailable ? nullablePercentage(analytics.orderGrowthPercentage) : 'No valid order records'],
        ['Average order value', ordersAvailable ? nullableMoney(analytics.averageOrderValueMinor, currency) : 'Insufficient data', 'Revenue ÷ orders'],
        ['Revenue per customer', ordersAvailable ? nullableMoney(analytics.revenuePerCustomerMinor, currency) : 'Insufficient data', 'Revenue ÷ unique customers']
    ]);
    renderMetricGrid('crmMetricsGrid', [
        ['Total customers', customersAvailable ? formatNumber(crm.totalCustomers) : 'Insufficient data', 'Actual customer records'],
        ['Active customers', customersAvailable && ordersAvailable ? formatNumber(crm.activeCustomers) : 'Insufficient data', 'Ordered in selected period'],
        ['Follow-ups due', customersAvailable ? formatNumber(crm.followupsDue) : 'Insufficient data', 'Unanswered or draft reviews'],
        ['Repeat purchase rate', customersAvailable && ordersAvailable ? nullablePercentage(crm.repeatPurchaseRatePercentage) : 'Insufficient data', 'Customers with 2+ valid orders']
    ]);
    renderRevenueTrend('marketingTrendChart', marketing.dailyTrend || [], currency);
    renderRevenueTrend('analyticsTrendChart', marketing.dailyTrend || [], currency);
    setText('marketingTrendTitle', formatPeriod(overview.dataPeriod));
    setText('analyticsTrendTitle', formatPeriod(overview.dataPeriod));
    setText('analyticsRecordsBadge', `${formatNumber(overview.recordsAnalyzed)} records`);
    renderMarketingTopProducts(marketing.topProducts || [], currency);
    renderCampaignPanel(marketing, analytics, currency);
    renderAnalyticsAvailability(marketing, analytics);
    renderCrmCustomers(crm.customers || [], currency);
}

function renderMetricGrid(id, metrics) {
    const container = document.getElementById(id);
    if (!container) return;
    container.replaceChildren(...metrics.map(([label, value, detail]) => {
        const article = document.createElement('article');
        article.className = 'metric-card';
        article.innerHTML = `<span>${escapeWorkflowHtml(label)}</span><strong>${escapeWorkflowHtml(value)}</strong><small>${escapeWorkflowHtml(detail || '')}</small>`;
        return article;
    }));
}

function renderRevenueTrend(id, rows, currency) {
    const container = document.getElementById(id);
    if (!container) return;
    container.replaceChildren();
    if (!rows.length) {
        container.innerHTML = '<div class="business-empty-state">No valid order records exist in this period.</div>';
        return;
    }
    const maximum = Math.max(...rows.map((row) => Number(row.revenueMinor || 0)), 1);
    for (const row of rows) {
        const date = new Date(row.date);
        const label = Number.isNaN(date.getTime()) ? String(row.date) : date.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' });
        const height = Math.max(4, Math.round((Number(row.revenueMinor || 0) / maximum) * 100));
        const column = document.createElement('div');
        column.className = 'bar-column';
        column.innerHTML = `<span class="bar-value">${escapeWorkflowHtml(formatMoneyMinor(row.revenueMinor, currency, true))}</span><div class="bar-track"><div class="bar-fill" style="height:${height}%"></div></div><span class="bar-label">${escapeWorkflowHtml(label)}</span>`;
        container.appendChild(column);
    }
}

function renderMarketingTopProducts(products, currency) {
    const container = document.getElementById('marketingTopProducts');
    if (!container) return;
    container.replaceChildren();
    if (!products.length) {
        container.innerHTML = '<div class="business-empty-state">No product-linked order items are available for this period.</div>';
        return;
    }
    for (const product of products) {
        const row = document.createElement('div');
        row.className = 'activity-row';
        row.innerHTML = `<span class="activity-icon"><i class="fa-solid fa-box" aria-hidden="true"></i></span><div><strong>${escapeWorkflowHtml(product.productName)}</strong><small>${escapeWorkflowHtml(formatNullableDecimal(product.unitsSold))} units · ${escapeWorkflowHtml(formatNumber(product.orderCount))} orders</small></div><span class="status-dot ready">${escapeWorkflowHtml(formatMoneyMinor(product.revenueMinor, currency, true))}</span>`;
        container.appendChild(row);
    }
}

function renderCampaignPanel(marketing, analytics, currency) {
    const container = document.getElementById('marketingCampaignPanel');
    if (!container) return;
    if (!marketing.campaignDataAvailable || !marketing.campaign) {
        container.innerHTML = '<div class="business-empty-state"><strong>Campaign data unavailable</strong><span>Import campaign daily metrics from a legitimate marketing integration to calculate conversion and return on spend.</span></div>';
        return;
    }
    const campaign = marketing.campaign;
    container.innerHTML = `<div class="workflow-output-metrics">
        ${resultMetric('Spend', formatMoneyMinor(campaign.spendMinor, currency))}
        ${resultMetric('Attributed revenue', formatMoneyMinor(campaign.attributedRevenueMinor, currency))}
        ${resultMetric('Visitors', formatNumber(campaign.visitors))}
        ${resultMetric('Conversions', formatNumber(campaign.conversions))}
        ${resultMetric('Conversion rate', nullablePercentage(analytics.conversionRatePercentage))}
        ${resultMetric('Return on spend', analytics.campaignReturnOnSpend === null ? 'Insufficient data' : `${formatNullableDecimal(analytics.campaignReturnOnSpend)}×`)}
    </div>`;
}

function renderAnalyticsAvailability(marketing, analytics) {
    const container = document.getElementById('analyticsAvailabilityPanel');
    if (!container) return;
    const unavailable = [];
    if (analytics.revenueGrowthPercentage === null) unavailable.push('Revenue growth requires a non-zero previous comparable period.');
    if (analytics.orderGrowthPercentage === null) unavailable.push('Order growth requires a non-zero previous comparable period.');
    if (analytics.averageOrderValueMinor === null) unavailable.push('Average order value requires at least one valid order.');
    if (!marketing.campaignDataAvailable) unavailable.push('Conversion, acquisition, and campaign performance require connected campaign metrics.');
    container.innerHTML = unavailable.length
        ? `<ul class="data-availability-list">${unavailable.map((item) => `<li><i class="fa-solid fa-circle-info" aria-hidden="true"></i>${escapeWorkflowHtml(item)}</li>`).join('')}</ul>`
        : '<div class="business-empty-state success"><strong>Required inputs are available.</strong><span>All displayed metrics were recalculated from the selected period.</span></div>';
}

function renderCrmCustomers(customers, currency) {
    const container = document.getElementById('crmCustomerTable');
    if (!container) return;
    container.innerHTML = '<div class="customer-row customer-head" role="row"><span role="columnheader">Customer</span><span role="columnheader">Activity</span><span role="columnheader">Value</span></div>';
    if (!customers.length) {
        container.insertAdjacentHTML('beforeend', '<div class="business-empty-state">No customer records have been imported.</div>');
        return;
    }
    for (const customer of customers.slice(0, 20)) {
        const row = document.createElement('div');
        row.className = 'customer-row';
        row.setAttribute('role', 'row');
        const name = customer.name || customer.email || customer.externalId;
        const initials = String(name || '?').split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
        const activity = customer.needsReviewFollowup ? 'Review follow-up due'
            : customer.lastActivityAt ? `Last active ${formatDateTime(customer.lastActivityAt)}` : 'No activity date';
        row.innerHTML = `<span class="customer-name" role="cell"><span class="mini-avatar">${escapeWorkflowHtml(initials)}</span><strong>${escapeWorkflowHtml(name)}</strong></span><span role="cell"><span class="customer-signal ${customer.needsReviewFollowup ? 'attention' : 'loyal'}">${escapeWorkflowHtml(activity)}</span></span><span role="cell">${escapeWorkflowHtml(formatMoneyMinor(customer.lifetimeValueMinor, currency))} · ${escapeWorkflowHtml(formatNumber(customer.orderCount))} orders</span>`;
        container.appendChild(row);
    }
}

function setBusinessDataLoading() {
    for (const id of ['marketingDataStatus', 'analyticsDataStatus', 'crmDataStatus']) setStatusText(id, 'Fetching fresh data from the authenticated business account…', 'loading');
}

function setBusinessDataError(message) {
    for (const id of ['marketingDataStatus', 'analyticsDataStatus', 'crmDataStatus']) setStatusText(id, message, 'error');
}

function setStatusText(id, text, state) {
    const element = document.getElementById(id);
    if (!element) return;
    element.textContent = text;
    element.dataset.state = state;
}

function setText(id, text) {
    const element = document.getElementById(id);
    if (element) element.textContent = text;
}

function appendTopProducts(container, products, currency) {
    const section = document.createElement('section');
    section.className = 'workflow-output-section';
    section.innerHTML = '<h4>Top products</h4>';
    if (!products.length) {
        section.insertAdjacentHTML('beforeend', '<div class="business-empty-state">No product-linked sales records were available.</div>');
    } else {
        const list = document.createElement('div');
        list.className = 'workflow-source-list';
        products.forEach((product) => {
            const item = document.createElement('article');
            item.innerHTML = `<strong>${escapeWorkflowHtml(product.productName)}</strong><span>${escapeWorkflowHtml(formatNullableDecimal(product.unitsSold))} units · ${escapeWorkflowHtml(formatNumber(product.orderCount))} orders</span><small>${escapeWorkflowHtml(formatMoneyMinor(product.revenueMinor, currency))}</small>`;
            list.appendChild(item);
        });
        section.appendChild(list);
    }
    container.appendChild(section);
}

function appendAiInsight(container, ai) {
    const section = document.createElement('section');
    section.className = 'workflow-output-section ai-output';
    section.innerHTML = '<h4>AI-generated insights</h4>';
    const content = document.createElement('div');
    content.className = 'ai-output-content';
    if (ai?.status === 'generated' && ai.content) content.textContent = ai.content;
    else if (ai?.status === 'generated' && ai.data) content.textContent = 'Structured response drafts were generated and saved for review.';
    else content.textContent = ai?.reason || 'AI analysis is unavailable. Factual and calculated results remain unchanged.';
    section.appendChild(content);
    container.appendChild(section);
}

function readSelectedDateRange(slug) {
    if (!['weekly-marketing', 'inventory-predictor'].includes(slug)) return {};
    return {
        from: document.getElementById('analyticsFromDate')?.value || undefined,
        to: document.getElementById('analyticsToDate')?.value || undefined
    };
}

async function readNdjsonResponse(response, onEvent) {
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
            const line = buffer.slice(0, newline).trim();
            buffer = buffer.slice(newline + 1);
            if (!line) continue;
            try { onEvent(JSON.parse(line)); } catch { /* Ignore malformed progress lines. */ }
        }
        if (done) break;
    }
    const finalLine = buffer.trim();
    if (finalLine) {
        try { onEvent(JSON.parse(finalLine)); } catch { /* Ignore malformed final lines. */ }
    }
}

async function readApiPayload(response) {
    const text = await response.text();
    if (!text) return {};
    try { return JSON.parse(text); } catch { return { error: text }; }
}

function workflowDisplayName(slug) {
    return ({
        'weekly-marketing': 'Weekly Marketing',
        'competitor-audit': 'Competitor Audit',
        'review-responder': 'Review Responder',
        'inventory-predictor': 'Inventory Predictor'
    })[slug] || 'Business workflow';
}

function resultMetric(label, value) {
    return `<span><small>${escapeWorkflowHtml(label)}</small><strong>${escapeWorkflowHtml(value)}</strong></span>`;
}

function formatMoneyMinor(value, currency = 'USD', compact = false) {
    const amount = Number(value);
    if (!Number.isFinite(amount)) return 'Insufficient data';
    try {
        return new Intl.NumberFormat(undefined, {
            style: 'currency',
            currency,
            notation: compact ? 'compact' : 'standard',
            maximumFractionDigits: compact ? 1 : 2
        }).format(amount / 100);
    } catch {
        return `${currency} ${(amount / 100).toFixed(2)}`;
    }
}

function nullableMoney(value, currency) {
    return value === null || value === undefined ? 'Insufficient data' : formatMoneyMinor(value, currency);
}

function nullablePercentage(value) {
    const number = Number(value);
    return value === null || value === undefined || !Number.isFinite(number) ? 'Insufficient data' : `${number >= 0 ? '+' : ''}${number.toFixed(1)}%`;
}

function formatNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? new Intl.NumberFormat().format(number) : '0';
}

function formatNullableNumber(value) {
    return value === null || value === undefined ? 'Unavailable' : formatNumber(value);
}

function formatNullableDecimal(value) {
    const number = Number(value);
    return value === null || value === undefined || !Number.isFinite(number) ? 'Unavailable' : number.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatRecommendation(value) {
    return ({ reorder: 'Reorder', monitor: 'Monitor', no_recent_demand: 'No recent demand', insufficient_data: 'Insufficient data' })[value] || 'Insufficient data';
}

function formatDateTime(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? 'Unavailable' : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function formatDuration(value) {
    const milliseconds = Number(value);
    if (!Number.isFinite(milliseconds)) return 'Unavailable';
    return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

function formatPeriod(period) {
    if (!period?.from || !period?.to) return 'Period unavailable';
    const from = new Date(period.from);
    const to = new Date(period.to);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return 'Period unavailable';
    return `${from.toLocaleDateString()} – ${to.toLocaleDateString()}`;
}

function formatDateInput(date) {
    const local = new Date(date.getTime() - (date.getTimezoneOffset() * 60_000));
    return local.toISOString().slice(0, 10);
}

function escapeWorkflowHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
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
    const previousTheme = root.dataset.theme;
    const nextTheme = ['dark', 'midnight', 'light'].includes(values.theme) ? values.theme : 'dark';
    root.dataset.theme = nextTheme;
    root.style.colorScheme = nextTheme === 'light' ? 'light' : 'dark';
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
    if (previousTheme !== nextTheme) {
        document.dispatchEvent(new CustomEvent('outcomeai:theme-changed', { detail: { theme: nextTheme } }));
    }

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
                        paymentSucceeded(result.billing, result.plan, result.promptUsage);
                    } catch (error) {
                        if (error.code === 'RAZORPAY_PAYMENT_PENDING') {
                            showPaymentMessage(error.message, 'neutral');
                            try {
                                const status = await waitForRazorpayActivation(orderId);
                                paymentSucceeded(status.billing, status.plan, status.promptUsage);
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
                    paymentSucceeded(result.billing, result.plan, result.promptUsage);
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
                publishAgentPromptUsage(result.promptUsage);
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

    function paymentSucceeded(billing, plan, promptUsage = null) {
        const nextBilling = normalizeBillingState(billing || {
            currentPlanId: plan?.id,
            currentPlanName: plan?.name,
            planExpiresAt: null
        });
        applyBillingState(nextBilling, { announce: true });
        publishAgentPromptUsage(promptUsage);
        showPaymentMessage(`${nextBilling.currentPlanName} is now active on your account.`, 'success');
    }

    function publishAgentPromptUsage(promptUsage) {
        if (!promptUsage) return;
        document.dispatchEvent(new CustomEvent('orexisai:agent-usage-updated', { detail: promptUsage }));
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
