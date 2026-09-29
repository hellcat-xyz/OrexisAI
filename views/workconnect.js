'use strict';

function renderWorkConnectPage({ user, cspNonce = '' }) {
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<script nonce="${esc(cspNonce)}">(()=>{try{const s=JSON.parse(localStorage.getItem('outcomeai.workspaceSettings')||'{}');document.documentElement.dataset.theme=['dark','midnight','light'].includes(s.theme)?s.theme:'dark'}catch{document.documentElement.dataset.theme='dark'}})()</script>
<title>WorkConnect · OrexisAI</title><link rel="stylesheet" href="/style.css"><link rel="stylesheet" href="/workconnect.css"><link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700&display=swap" rel="stylesheet"><link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css"></head>
<body class="wc-body" data-user-id="${Number(user.id)}" data-user-name="${esc(user.displayName)}"><div class="wc-shell">
<aside class="wc-sidebar"><a class="wc-brand" href="/dashboard"><span class="wc-brand-o">O</span><span>rexis<span>AI</span></span></a><div class="wc-product"><span>WorkConnect</span><small>Discover Talent. Showcase Work.</small></div>
<nav id="wcNav"><button class="active" data-tab="feed"><i class="fa-regular fa-newspaper"></i> Professional Feed</button><button data-tab="discover"><i class="fa-solid fa-location-dot"></i> Find Workers</button><button data-tab="jobs"><i class="fa-solid fa-briefcase"></i> Find Jobs</button><button data-tab="profile"><i class="fa-regular fa-user"></i> My Profile</button><button data-tab="messages"><i class="fa-regular fa-message"></i> Messages <b id="messageBadge"></b></button><button data-tab="dashboard"><i class="fa-solid fa-chart-line"></i> My Dashboard</button></nav>
<div class="wc-sidebar-bottom"><a href="/dashboard"><i class="fa-solid fa-arrow-left"></i> OrexisAI Dashboard</a><form action="/logout" method="post"><button><i class="fa-solid fa-right-from-bracket"></i> Sign out</button></form></div></aside>
<main class="wc-main"><header class="wc-topbar"><button id="mobileMenu" class="wc-icon-btn"><i class="fa-solid fa-bars"></i></button><div class="wc-global-search"><i class="fa-solid fa-magnifying-glass"></i><input id="globalSearch" placeholder="Search professionals, jobs, posts, projects"><div id="globalResults" class="wc-search-popover hidden"></div></div><button id="notificationButton" class="wc-icon-btn" aria-label="Notifications"><i class="fa-regular fa-bell"></i><span id="notificationBadge"></span></button><div class="wc-user-chip"><span>${esc(initials(user.displayName))}</span><div>${esc(user.displayName)}<small>WorkConnect</small></div></div></header>
<div id="toast" class="wc-toast hidden"></div><section id="wcContent" class="wc-content"><div class="wc-loading"><div class="wc-spinner"></div><p>Loading WorkConnect…</p></div></section></main></div>
<div id="modal" class="wc-modal hidden"><div class="wc-modal-card"><button id="modalClose" class="wc-modal-close">×</button><div id="modalBody"></div></div></div>
<script src="/workconnect.js" defer></script></body></html>`;
}
function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function initials(v){return String(v||'U').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();}
module.exports={renderWorkConnectPage};
