/* Freeify: inline SVG icon set (original artwork, MIT licensed with the rest of the app). */
(function (F) {
  'use strict';

  const line = (d) => `<g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</g>`;
  const solid = (d) => `<g fill="currentColor">${d}</g>`;
  const heartPath = '<path d="M12 20.2s-7.4-4.5-9.4-9C1.2 8 3 4.3 6.6 4.3c2.2 0 3.6 1.3 5.4 3.3 1.8-2 3.2-3.3 5.4-3.3 3.6 0 5.4 3.7 4 6.9-2 4.5-9.4 9-9.4 9z"/>';

  const ICONS = {
    play: solid('<path d="M7.5 5.2v13.6a1 1 0 0 0 1.5.86l11.2-6.8a1 1 0 0 0 0-1.72L9 4.34a1 1 0 0 0-1.5.86z"/>'),
    pause: solid('<rect x="6" y="4.5" width="4.2" height="15" rx="1.2"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.2"/>'),
    next: solid('<path d="M4.5 5.6a1 1 0 0 1 1.58-.82l8.9 6.4a1 1 0 0 1 0 1.63l-8.9 6.4a1 1 0 0 1-1.58-.82z"/><rect x="16.5" y="4.8" width="2.6" height="14.4" rx="1.1"/>'),
    prev: solid('<path d="M19.5 5.6a1 1 0 0 0-1.58-.82l-8.9 6.4a1 1 0 0 0 0 1.63l8.9 6.4a1 1 0 0 0 1.58-.82z"/><rect x="4.9" y="4.8" width="2.6" height="14.4" rx="1.1"/>'),
    shuffle: line('<path d="M16.5 3.5H20.5V7.5"/><path d="M3.5 19.5 20.5 3.5"/><path d="M20.5 16.5v4h-4"/><path d="M14.5 14.5l6 6"/><path d="M3.5 4.5l5.5 5.2"/>'),
    repeat: line('<path d="M17 2.5l3.5 3.5L17 9.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/>'),
    'repeat-one': line('<path d="M17 2.5l3.5 3.5L17 9.5"/><path d="M3.5 11.5V10a4 4 0 0 1 4-4h13"/><path d="M7 21.5 3.5 18 7 14.5"/><path d="M20.5 12.5V14a4 4 0 0 1-4 4h-13"/><path d="M11 10.5l1.5-1v5"/>'),
    heart: line(heartPath),
    'heart-fill': solid(heartPath),
    'volume-high': line('<path d="M11 5 6.5 9H3v6h3.5l4.5 4z"/><path d="M15.5 8.6a4.8 4.8 0 0 1 0 6.8"/><path d="M18.6 5.5a9.2 9.2 0 0 1 0 13"/>'),
    'volume-low': line('<path d="M11 5 6.5 9H3v6h3.5l4.5 4z"/><path d="M15.5 8.6a4.8 4.8 0 0 1 0 6.8"/>'),
    'volume-mute': line('<path d="M11 5 6.5 9H3v6h3.5l4.5 4z"/><path d="m22 9-6 6"/><path d="m16 9 6 6"/>'),
    queue: line('<path d="M3.5 6h13"/><path d="M3.5 12h9"/><path d="M3.5 18h9"/><path d="M16.5 11.5v8l4.5-4z"/>'),
    home: line('<path d="M3.5 10.4 12 3.5l8.5 6.9v9.1a1 1 0 0 1-1 1H15v-6.2H9v6.2H4.5a1 1 0 0 1-1-1z"/>'),
    search: line('<circle cx="10.8" cy="10.8" r="6.8"/><path d="m20.5 20.5-4.8-4.8"/>'),
    library: line('<path d="M4.5 3.5v17"/><path d="M9.5 3.5v17"/><path d="m14 4.2 5.6 16"/>'),
    plus: line('<path d="M12 5v14"/><path d="M5 12h14"/>'),
    more: solid('<circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/>'),
    close: line('<path d="M18 6 6 18"/><path d="m6 6 12 12"/>'),
    note: line('<path d="M9 18V5.5l11-2V16"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="17.5" cy="16" r="2.5"/>'),
    upload: line('<path d="M12 15.5V3.5"/><path d="m7 8.5 5-5 5 5"/><path d="M4.5 15v3.5a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V15"/>'),
    folder: line('<path d="M3.5 6.5a2 2 0 0 1 2-2h4l2 2.2h7a2 2 0 0 1 2 2v8.8a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z"/>'),
    'chevron-left': line('<path d="m14.5 18-6-6 6-6"/>'),
    'chevron-right': line('<path d="m9.5 6 6 6-6 6"/>'),
    'chevron-down': line('<path d="m6 9.5 6 6 6-6"/>'),
    clock: line('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
    trash: line('<path d="M4 6.5h16"/><path d="M9 6.5V4.5h6v2"/><path d="m18.5 6.5-.9 13a1.5 1.5 0 0 1-1.5 1.4H7.9a1.5 1.5 0 0 1-1.5-1.4l-.9-13"/>'),
    edit: line('<path d="M12.5 20.5h8"/><path d="M16.3 3.8a2.1 2.1 0 0 1 3 3L7.5 18.6l-4 1 1-4z"/>'),
    expand: line('<path d="M14.5 3.5h6v6"/><path d="M9.5 20.5h-6v-6"/><path d="m20.5 3.5-7 7"/><path d="m3.5 20.5 7-7"/>'),
    mic: line('<rect x="9" y="2.5" width="6" height="11.5" rx="3"/><path d="M5.5 10.5a6.5 6.5 0 0 0 13 0"/><path d="M12 17v4.5"/>'),
    disc: line('<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="2.2"/>'),
    user: line('<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5a7.5 7.5 0 0 1 15 0"/>'),
    check: line('<path d="M20 6.5 9.5 17 4 11.5"/>'),
    settings: line('<path d="M4 21v-6.5"/><path d="M4 10.5V3"/><path d="M12 21v-8.5"/><path d="M12 8.5V3"/><path d="M20 21v-4.5"/><path d="M20 12.5V3"/><path d="M1.5 14.5h5"/><path d="M9.5 8.5h5"/><path d="M17.5 16.5h5"/>'),
    moon: line('<path d="M20.5 13.2A8.5 8.5 0 1 1 10.8 3.5a6.6 6.6 0 0 0 9.7 9.7z"/>'),
    playlist: line('<path d="M3.5 6h12"/><path d="M3.5 11h12"/><path d="M3.5 16h7"/><path d="M18.5 19.5V9l3-1"/><circle cx="16.5" cy="19.5" r="2"/>'),
    'queue-add': line('<path d="M3.5 6h13"/><path d="M3.5 12h9"/><path d="M3.5 18h7"/><path d="M18 13.5v7"/><path d="M14.5 17h7"/>'),
    'play-next': line('<path d="M3.5 6h9"/><path d="M3.5 12h9"/><path d="M3.5 18h9"/><path d="M16 5.5v9l5.5-4.5z"/>'),
    grip: solid('<circle cx="9" cy="6" r="1.5"/><circle cx="15" cy="6" r="1.5"/><circle cx="9" cy="12" r="1.5"/><circle cx="15" cy="12" r="1.5"/><circle cx="9" cy="18" r="1.5"/><circle cx="15" cy="18" r="1.5"/>'),
    shield: line('<path d="M12 21s7.5-3.2 7.5-9.5V5.2L12 2.5 4.5 5.2v6.3C4.5 17.8 12 21 12 21z"/><path d="m8.8 11.8 2.2 2.2 4.4-4.5"/>'),
    wifi_off: line('<path d="M2 2l20 20"/><path d="M8.5 16.4a5 5 0 0 1 7 0"/><path d="M5 12.9a10 10 0 0 1 5.2-2.7"/><path d="M15.5 10.5A10 10 0 0 1 19 12.9"/><path d="M2 8.8a15 15 0 0 1 4.2-2.6"/><path d="M10.7 5A15 15 0 0 1 22 8.8"/><circle cx="12" cy="19.5" r=".6"/>'),
    gift: line('<rect x="3.5" y="8" width="17" height="4.5" rx="1"/><path d="M5 12.5v7a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7"/><path d="M12 8v12.5"/><path d="M12 8S10.5 3.5 7.9 3.5a2.2 2.2 0 0 0 0 4.5H12z"/><path d="M12 8s1.5-4.5 4.1-4.5a2.2 2.2 0 0 1 0 4.5H12z"/>'),
    sort: line('<path d="M7 4v16"/><path d="m3.5 16.5 3.5 3.5 3.5-3.5"/><path d="M17 20V4"/><path d="m13.5 7.5 3.5-3.5 3.5 3.5"/>'),
    'arrow-up': line('<path d="M12 19V5"/><path d="m6 11 6-6 6 6"/>'),
    'arrow-down': line('<path d="M12 5v14"/><path d="m18 13-6 6-6-6"/>'),
    logo: '<circle cx="12" cy="12" r="11" fill="var(--accent, #3ddc97)"/>' +
      '<path fill="#0b0b0b" transform="translate(-1.5 -1.1) scale(.0469)" d="M286 136h28v58l64 22v44l-64-22v126a58 58 0 1 1-28-49.6z"/>',
  };

  function icon(name, cls) {
    const body = ICONS[name] || ICONS.note;
    return `<svg class="icon${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${body}</svg>`;
  }

  /** Replace every <span data-icon="name"> inside root with its SVG. */
  function hydrateIcons(root) {
    (root || document).querySelectorAll('[data-icon]').forEach((el) => {
      el.outerHTML = icon(el.getAttribute('data-icon'), el.className || '');
    });
  }

  F.icon = icon;
  F.hydrateIcons = hydrateIcons;
})(window.Freeify = window.Freeify || {});
