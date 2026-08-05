'use strict';

(() => {
    const root = document.documentElement;
    let theme = 'dark';

    try {
        const stored = JSON.parse(window.localStorage.getItem('outcomeai.workspaceSettings') || '{}');
        if (stored.theme === 'light' || stored.theme === 'midnight' || stored.theme === 'dark') {
            theme = stored.theme;
        }
    } catch {
        theme = 'dark';
    }

    root.dataset.theme = theme;
    root.style.colorScheme = theme === 'light' ? 'light' : 'dark';
})();
