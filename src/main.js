const icon = (name, size = 18) => {
  const paths = {
    home: '<path d="M3 10.8 12 3l9 7.8"/><path d="M5 9.5V21h14V9.5M9 21v-6h6v6"/>',
    inbox: '<path d="M4 4h16v13H4z"/><path d="m4 13 4 4h8l4-4"/>',
    check: '<path d="m4 12 5 5L20 6"/>',
    bolt: '<path d="m13 2-9 12h8l-1 8 9-12h-8z"/>',
    task: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M9 8h6M8 13h8M8 17h5"/>',
    chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.8 1.8 0 0 0 .4 2l.1.1-2.8 2.8-.1-.1a1.8 1.8 0 0 0-2-.4 1.8 1.8 0 0 0-1 1.7V21h-4v-.1a1.8 1.8 0 0 0-1-1.7 1.8 1.8 0 0 0-2 .4l-.1.1-2.8-2.8.1-.1a1.8 1.8 0 0 0 .4-2 1.8 1.8 0 0 0-1.7-1H3v-4h.1a1.8 1.8 0 0 0 1.7-1 1.8 1.8 0 0 0-.4-2l-.1-.1 2.8-2.8.1.1a1.8 1.8 0 0 0 2 .4 1.8 1.8 0 0 0 1-1.7V3h4v.1a1.8 1.8 0 0 0 1 1.7 1.8 1.8 0 0 0 2-.4l.1-.1 2.8 2.8-.1.1a1.8 1.8 0 0 0-.4 2 1.8 1.8 0 0 0 1.7 1h.1v4h-.1a1.8 1.8 0 0 0-1.7 1Z"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    arrow: '<path d="m9 18 6-6-6-6"/>',
    sparkle: '<path d="m12 3 .8 3.2A4 4 0 0 0 15.8 9l3.2.8-3.2.8a4 4 0 0 0-3 3L12 17l-.8-3.2a4 4 0 0 0-3-3L5 10l3.2-.8a4 4 0 0 0 3-3Z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    more: '<circle cx="5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none"/>'
  };
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]}</svg>`;
};

const messages = [
  { initials:'LS', color:'violet', name:'Lena Schröder', company:'Nordlicht GmbH', subject:'Freigabe zur Projektplanung Q4', preview:'Hallo Felix, danke für die Unterlagen. Wir können mit Variante zwei starten …', tag:'Kundenanfrage', meta:'Wichtiger Kunde · Frage erkannt', time:'09:42', priority:true },
  { initials:'TM', color:'green', name:'Thomas Müller', company:'Müller & Partner', subject:'Rückfrage zur Rechnung RE-2026-1842', preview:'Guten Morgen, uns ist bei der aktuellen Rechnung eine Abweichung aufgefallen …', tag:'Rechnung', meta:'Zahlungsfrage · Buchhaltung', time:'08:18', priority:true },
  { initials:'AW', color:'blue', name:'Anna Weber', company:'Weber Digital', subject:'Terminverschiebung für Donnerstag', preview:'Könnten wir unseren Termin am Donnerstag auf 15:30 Uhr verschieben?', tag:'Termin', meta:'Antwort erforderlich', time:'Gestern', priority:false }
];

document.querySelector('#app').innerHTML = `
  <div class="shell">
    <aside class="sidebar">
      <div class="brand"><span class="brand-mark"><i></i><i></i><i></i></span><div><b>MAILWIN</b><small>POWERED BY OKUN</small></div></div>
      <button class="company-switch"><span class="company-logo">OS</span><span><b>OKUN Software</b><small>Arbeitsbereich</small></span>${icon('arrow',15)}</button>
      <nav>
        <p>ARBEITSBEREICH</p>
        <a class="active" href="#">${icon('home')}<span>Übersicht</span></a>
        <a href="#">${icon('inbox')}<span>Inbox</span><em>12</em></a>
        <a href="#">${icon('check')}<span>Freigaben</span><em class="accent-count">3</em></a>
        <a href="#">${icon('task')}<span>Aufgaben</span><em>2</em></a>
        <p>MAILWIN</p>
        <a href="#">${icon('bolt')}<span>Automationen</span></a>
        <a href="#">${icon('chart')}<span>Auswertung</span></a>
        <a href="#">${icon('history')}<span>Aktivitäten</span></a>
      </nav>
      <div class="system-card"><span class="pulse"></span><div><b>System aktiv</b><small>Alle Automationen laufen</small></div><button aria-label="Optionen">${icon('more')}</button></div>
      <div class="sidebar-bottom"><a href="#">${icon('settings')} Einstellungen</a><div class="profile"><span>FE</span><div><b>Felix Erdmann</b><small>Administrator</small></div><button>${icon('more')}</button></div></div>
    </aside>

    <main>
      <header><div><button class="mobile-menu">☰</button><span class="crumb">Übersicht</span></div><div class="header-actions"><label class="search">${icon('search')}<input placeholder="Suchen"/><kbd>⌘ K</kbd></label><button class="round" aria-label="Benachrichtigungen">${icon('bell')}<i></i></button></div></header>
      <div class="content">
        <section class="welcome"><div><span class="eyebrow">DIENSTAG, 22. SEPTEMBER</span><h1>Guten Morgen, Felix.</h1><p>MAILWIN hat bereits vorgearbeitet. Hier ist, was heute deine Aufmerksamkeit benötigt.</p></div><button class="primary" id="inboxBtn">Zur Inbox ${icon('arrow',16)}</button></section>

        <section class="summary-grid">
          <article class="summary attention"><div class="summary-icon">${icon('sparkle',20)}</div><div><strong>4</strong><span>Benötigen Aufmerksamkeit</span><small>2 davon mit hoher Priorität</small></div><button>${icon('arrow')}</button></article>
          <article class="summary approvals"><div class="summary-icon">${icon('check',20)}</div><div><strong>3</strong><span>Warten auf Freigabe</span><small>Antworten sind vorbereitet</small></div><button>${icon('arrow')}</button></article>
          <article class="summary done"><div class="summary-icon">${icon('bolt',20)}</div><div><strong>12</strong><span>Automatisch bearbeitet</span><small>Heute, seit 00:00 Uhr</small></div><button>${icon('arrow')}</button></article>
          <article class="summary tasks"><div class="summary-icon">${icon('task',20)}</div><div><strong>2</strong><span>Offene Aufgaben</span><small>Eine ist heute fällig</small></div><button>${icon('arrow')}</button></article>
        </section>

        <div class="dashboard-grid">
          <section class="panel attention-panel">
            <div class="panel-head"><div><h2>Aufmerksamkeit erforderlich</h2><p>Nachrichten, bei denen du gebraucht wirst.</p></div><button class="text-btn">Alle anzeigen ${icon('arrow',15)}</button></div>
            <div class="message-list">${messages.map((m,i)=>`<article class="message" data-index="${i}" tabindex="0"><span class="priority-dot ${m.priority?'high':''}"></span><span class="avatar ${m.color}">${m.initials}</span><div class="message-copy"><div class="sender"><b>${m.name}</b><span>${m.company}</span></div><h3>${m.subject}</h3><p>${m.preview}</p><div class="tags"><span>${m.tag}</span><small>${m.meta}</small></div></div><time>${m.time}</time><button class="message-arrow" aria-label="Nachricht öffnen">${icon('arrow',17)}</button></article>`).join('')}</div>
          </section>

          <aside class="right-column">
            <section class="panel approval-card"><div class="panel-head"><div><h2>Freigaben</h2><p>Antworten, die auf dich warten.</p></div><span class="number-pill">3</span></div>
              <article><div class="approval-person"><span class="avatar coral">JS</span><div><b>Julia Stein</b><small>Stein Architektur</small></div><time>vor 18 Min.</time></div><h3>Anfrage zu unseren Leistungen</h3><p>„Vielen Dank für Ihre Anfrage. Gerne sende ich Ihnen einen Überblick …“</p><div class="reason">${icon('sparkle',15)} Antwort durch „Neue Kundenanfrage“ vorbereitet</div><div class="approval-actions"><button class="secondary reject">Ablehnen</button><button class="primary approve">Prüfen & freigeben</button></div></article>
              <button class="full-link">Alle 3 Freigaben anzeigen ${icon('arrow',15)}</button>
            </section>
            <section class="panel automation-card"><div class="automation-title"><span>${icon('bolt')}</span><div><h2>Automationen</h2><p>Heute bereits erledigt</p></div><b>12</b></div><div class="auto-row"><span class="status-dot"></span><div><b>Newsletter organisiert</b><small>8 Nachrichten archiviert</small></div><time>zuletzt 09:51</time></div><div class="auto-row"><span class="status-dot"></span><div><b>Rechnungen zugewiesen</b><small>3 an Buchhaltung</small></div><time>zuletzt 08:18</time></div><div class="auto-row"><span class="status-dot"></span><div><b>Bewerbung erfasst</b><small>1 an Recruiting</small></div><time>gestern</time></div></section>
          </aside>
        </div>

        <section class="bottom-grid">
          <article class="panel next-card"><div class="panel-head"><div><h2>Als Nächstes</h2><p>Aufgaben und anstehende Follow-ups.</p></div><button class="text-btn">Alle Aufgaben ${icon('arrow',15)}</button></div><div class="next-items"><div><span class="check-circle"></span><div><b>Aktualisiertes Angebot senden</b><small>Aus E-Mail von Lena Schröder</small></div><span class="due today">Heute</span></div><div><span class="check-circle"></span><div><b>Bei Bergmann Logistik nachfassen</b><small>Keine Antwort seit 5 Tagen</small></div><span class="due">Morgen</span></div></div></article>
          <article class="panel insight"><span class="insight-icon">${icon('sparkle',21)}</span><div><span class="eyebrow">MAILWIN EINBLICK</span><h3>Dein Postfach arbeitet mit.</h3><p>Von 28 eingegangenen Nachrichten heute hat MAILWIN 12 selbstständig organisiert. Du musstest nur bei 4 aktiv werden.</p><button class="text-btn">Aktivität ansehen ${icon('arrow',15)}</button></div></article>
        </section>
      </div>
    </main>
  </div>
  <div class="toast" role="status"><span>${icon('check',18)}</span><span>Antwort wurde freigegeben.</span></div>
`;

document.querySelector('.approve').addEventListener('click', (e) => {
  e.currentTarget.textContent = 'Freigegeben';
  e.currentTarget.disabled = true;
  const toast = document.querySelector('.toast');
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
});

document.querySelector('.reject').addEventListener('click', () => {
  document.querySelector('.approval-card article').classList.add('dismissed');
});

document.querySelectorAll('nav a').forEach(link => link.addEventListener('click', e => {
  e.preventDefault();
  document.querySelectorAll('nav a').forEach(item => item.classList.remove('active'));
  link.classList.add('active');
  document.querySelector('.crumb').textContent = link.querySelector('span').textContent;
}));

document.querySelector('.mobile-menu').addEventListener('click', () => document.querySelector('.sidebar').classList.toggle('open'));
